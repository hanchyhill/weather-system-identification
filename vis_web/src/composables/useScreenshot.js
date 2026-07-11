import { computed, onUnmounted, ref } from 'vue'

// 地图截图：地图内容全部绘制在单个 canvas 上，直接读取 canvas 像素即可获得无损截图，
// 既避免 DOM 栅格化库的兼容问题，也天然排除叠加在地图上的 UI 控件面板。
// 截取范围支持「整个可视区域」与「框选指定区域」两种；截取结果优先写入剪贴板，
// 浏览器不支持或用户拒绝时回退为下载到本地。
export function useScreenshot({ canvasRef, shellRef, getMeta } = {}) {
  const selecting = ref(false)
  const selRect = ref(null)
  const toast = ref('')

  let dragStart = null
  let toastTimer = null

  const marqueeStyle = computed(() => {
    const rect = selRect.value
    if (!rect) return { display: 'none' }
    return {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.w}px`,
      height: `${rect.h}px`
    }
  })

  function showToast(message) {
    toast.value = message
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toast.value = ''
      toastTimer = null
    }, 2600)
  }

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function buildFileName(suffix = '') {
    const meta = typeof getMeta === 'function' ? getMeta() || {} : {}
    const now = new Date()
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

    const parts = ['weather-map']
    if (meta.initTime) parts.push(String(meta.initTime))
    if (meta.fcHour != null && meta.fcHour !== '') parts.push(`+${meta.fcHour}h`)
    if (meta.level) parts.push(meta.level === 'surface' ? 'surface' : `${meta.level}hPa`)
    if (suffix) parts.push(suffix)
    parts.push(stamp)
    return `${parts.join('_')}.png`
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('生成图片失败'))
      }, 'image/png')
    })
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 优先复制到剪贴板；浏览器不支持图片剪贴板或用户拒绝授权时回退为下载。
  // 关键：把 canvasToBlob 产生的 Promise<Blob> 直接交给 ClipboardItem，而不是先 await 出 blob
  // 再调用 write —— 后者会在 await 期间“消耗”用户手势的瞬时激活（transient activation），
  // 导致 clipboard.write 抛错而回退到下载。传入 Promise 让浏览器把写入与本次手势绑定，稳定复制。
  async function copyOrDownload(canvas, fileName) {
    const clipboardSupported = typeof navigator !== 'undefined'
      && navigator.clipboard
      && typeof navigator.clipboard.write === 'function'
      && typeof window !== 'undefined'
      && typeof window.ClipboardItem !== 'undefined'

    if (clipboardSupported) {
      try {
        const item = new window.ClipboardItem({ 'image/png': canvasToBlob(canvas) })
        await navigator.clipboard.write([item])
        showToast('截图已复制到剪贴板')
        return
      } catch (error) {
        // 拒绝授权 / 非安全上下文 / 失焦 / 不支持图片类型：记录原因后回退到下载。
        console.warn('[screenshot] 复制到剪贴板失败，回退为下载：', error)
      }
    } else if (typeof navigator !== 'undefined' && !navigator.clipboard) {
      // navigator.clipboard 仅在安全上下文（https 或 localhost）可用；用 LAN IP 访问会缺失。
      console.warn('[screenshot] 当前非安全上下文，剪贴板不可用（请用 https 或 localhost 访问），回退为下载。')
    }

    const blob = await canvasToBlob(canvas)
    downloadBlob(blob, fileName)
    showToast('截图已下载到本地')
  }

  async function outputCanvas(canvas, suffix = '') {
    try {
      await copyOrDownload(canvas, buildFileName(suffix))
    } catch {
      showToast('截图失败：画布可能包含跨域内容')
    }
  }

  // 截取整个地图可视区域：直接导出主画布，画质无损。
  async function captureFull() {
    const canvas = canvasRef?.value
    if (!canvas) return
    await outputCanvas(canvas)
  }

  // 供多图等场景复用：导出一张外部已绘制好的 canvas（复制到剪贴板或下载）。
  async function exportCanvas(canvas, suffix = '') {
    if (!canvas) return
    await outputCanvas(canvas, suffix)
  }

  function clampToShell(clientX, clientY) {
    const rect = shellRef.value.getBoundingClientRect()
    return {
      x: Math.min(Math.max(clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(clientY - rect.top, 0), rect.height)
    }
  }

  // 将框选区域（相对 shell 的 CSS 像素）映射到 canvas backing store 像素并裁剪导出。
  async function captureRegion(rect) {
    const canvas = canvasRef?.value
    if (!canvas) return

    const canvasRect = canvas.getBoundingClientRect()
    if (!canvasRect.width || !canvasRect.height) return
    const scaleX = canvas.width / canvasRect.width
    const scaleY = canvas.height / canvasRect.height

    const sx = Math.round(rect.x * scaleX)
    const sy = Math.round(rect.y * scaleY)
    const sw = Math.round(rect.w * scaleX)
    const sh = Math.round(rect.h * scaleY)
    if (sw < 2 || sh < 2) {
      showToast('框选区域太小，已取消')
      return
    }

    const cropped = document.createElement('canvas')
    cropped.width = sw
    cropped.height = sh
    const context = cropped.getContext('2d')
    context.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    await outputCanvas(cropped, 'region')
  }

  function onPointerMove(event) {
    if (!dragStart) return
    const point = clampToShell(event.clientX, event.clientY)
    selRect.value = {
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      w: Math.abs(point.x - dragStart.x),
      h: Math.abs(point.y - dragStart.y)
    }
  }

  async function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    const rect = selRect.value
    const hadDrag = Boolean(dragStart)
    dragStart = null
    exitRegionMode()
    if (hadDrag && rect && rect.w >= 2 && rect.h >= 2) {
      await captureRegion(rect)
    }
  }

  function onOverlayPointerDown(event) {
    if (event.button !== 0 || !shellRef?.value) return
    event.preventDefault()
    dragStart = clampToShell(event.clientX, event.clientY)
    selRect.value = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      dragStart = null
      exitRegionMode()
    }
  }

  function exitRegionMode() {
    selecting.value = false
    selRect.value = null
    window.removeEventListener('keydown', onKeydown)
  }

  // 进入框选模式：显示遮罩层，监听 Esc 取消。
  function startRegion() {
    if (selecting.value) return
    selecting.value = true
    selRect.value = null
    dragStart = null
    window.addEventListener('keydown', onKeydown)
  }

  onUnmounted(() => {
    if (toastTimer) clearTimeout(toastTimer)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('keydown', onKeydown)
  })

  return {
    selecting,
    selRect,
    toast,
    marqueeStyle,
    captureFull,
    exportCanvas,
    startRegion,
    cancelRegion: exitRegionMode,
    onOverlayPointerDown
  }
}
