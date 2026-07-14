// 手绘图元：工具状态、指针/键盘事件、图形提交与删除、以及在地图坐标系中的绘制 drawDrawings。
// drawDrawings 与 findShapeIndexNear 会挂到 store 供渲染/命中检测模块调用。
import { computed } from 'vue'

import { drawShape, catmullRom } from '../../utils/mapDrawing'
import {
  getDrawTool,
  geoAlmostEqual,
  pointSegmentDistance,
  rectBorderDistance
} from './helpers'

export function useMapDrawings(store) {
  const {
    drawMode,
    activeDrawTool,
    drawings,
    draftPoints,
    draftCursor,
    hoverDeleteIndex,
    zoomTransform,
    canvasRef,
    buildProjection,
    transformedPoint,
    screenToGeo,
    requestDraw
  } = store

  // 运行期非响应式的框选/序号状态（原文件中的模块级 let，仅本模块内部使用）。
  const local = {
    boxStartGeo: null,
    boxDragging: false,
    drawSeq: 0
  }

  function setDrawTool(key) {
    if (activeDrawTool.value === key) {
      exitDrawMode()
      return
    }
    finishCurrentLine()
    activeDrawTool.value = key
    drawMode.value = true
    draftPoints.value = []
    draftCursor.value = null
    hoverDeleteIndex.value = -1
  }

  function exitDrawMode() {
    finishCurrentLine()
    drawMode.value = false
    activeDrawTool.value = null
    draftPoints.value = []
    draftCursor.value = null
    hoverDeleteIndex.value = -1
    local.boxStartGeo = null
    local.boxDragging = false
    requestDraw()
  }

  function commitShape(tool, points) {
    drawings.value.push({
      id: `${tool.key}-${local.drawSeq++}`,
      tool: tool.key,
      kind: tool.kind,
      render: tool.render,
      text: tool.text,
      color: tool.color,
      points
    })
    requestDraw()
  }

  // 提交当前正在绘制的线（点数≥2 时）。
  function finishCurrentLine() {
    const tool = getDrawTool(activeDrawTool.value)
    if (tool && tool.kind === 'line') {
      const pts = draftPoints.value.map((point) => point.slice())
      // 去除尾部因双击/回车产生的重复折点。
      while (pts.length >= 2 && geoAlmostEqual(pts[pts.length - 1], pts[pts.length - 2])) pts.pop()
      if (pts.length >= 2) commitShape(tool, pts)
    }
    draftPoints.value = []
    draftCursor.value = null
  }

  function undoDrawing() {
    if (draftPoints.value.length) {
      draftPoints.value.pop()
    } else {
      drawings.value.pop()
    }
    requestDraw()
  }

  function clearDrawings() {
    drawings.value = []
    draftPoints.value = []
    draftCursor.value = null
    requestDraw()
  }

  // —— 绘图：图形删除（屏幕坐标下的就近命中）——
  function shapeScreenDistance(shape, scr, px, py) {
    const pts = scr.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    if (shape.kind === 'point') {
      return pts[0] ? Math.hypot(pts[0][0] - px, pts[0][1] - py) : null
    }
    if (shape.kind === 'box') {
      return pts.length >= 2 ? rectBorderDistance(pts[0], pts[1], px, py) : null
    }
    if (pts.length < 2) return null
    const smooth = catmullRom(pts, 1, 12)
    let min = Infinity
    for (let i = 0; i < smooth.length - 1; i++) {
      min = Math.min(min, pointSegmentDistance(px, py, smooth[i], smooth[i + 1]))
    }
    return min
  }

  function findShapeIndexNear(event) {
    const canvas = canvasRef.value
    if (!canvas) return -1
    const rect = canvas.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const projection = buildProjection()
    const threshold = 12
    let bestIdx = -1
    let bestDist = threshold
    drawings.value.forEach((shape, idx) => {
      const scr = shape.points.map((point) => transformedPoint(projection, point))
      const dist = shapeScreenDistance(shape, scr, px, py)
      if (dist != null && dist < bestDist) {
        bestDist = dist
        bestIdx = idx
      }
    })
    return bestIdx
  }

  function deleteShapeNear(event) {
    const idx = findShapeIndexNear(event)
    if (idx >= 0) {
      drawings.value.splice(idx, 1)
      hoverDeleteIndex.value = -1
      requestDraw()
    }
  }

  // —— 绘图：画布鼠标事件 ——
  function handleCanvasPointerDown(event) {
    if (!drawMode.value) return
    const tool = getDrawTool(activeDrawTool.value)
    if (!tool || tool.kind !== 'box') return
    const geo = screenToGeo(event)
    if (!geo) return
    local.boxStartGeo = geo
    local.boxDragging = true
    draftCursor.value = geo
    requestDraw()
  }

  function handleCanvasPointerUp(event) {
    if (!drawMode.value || !local.boxDragging) return
    const tool = getDrawTool(activeDrawTool.value)
    local.boxDragging = false
    const geo = screenToGeo(event) || draftCursor.value
    if (tool && tool.kind === 'box' && local.boxStartGeo && geo &&
      (Math.abs(geo.lon - local.boxStartGeo.lon) > 1e-4 || Math.abs(geo.lat - local.boxStartGeo.lat) > 1e-4)) {
      commitShape(tool, [[local.boxStartGeo.lon, local.boxStartGeo.lat], [geo.lon, geo.lat]])
    }
    local.boxStartGeo = null
    draftCursor.value = null
    requestDraw()
  }

  function handleCanvasClick(event) {
    if (!drawMode.value) return
    const tool = getDrawTool(activeDrawTool.value)
    if (!tool) return
    if (tool.kind === 'erase') {
      deleteShapeNear(event)
      return
    }
    const geo = screenToGeo(event)
    if (!geo) return
    if (tool.kind === 'point') {
      commitShape(tool, [[geo.lon, geo.lat]])
    } else if (tool.kind === 'line') {
      draftPoints.value.push([geo.lon, geo.lat])
      requestDraw()
    }
  }

  // 双击左键：结束当前线绘制。
  function handleCanvasDblClick(event) {
    if (!drawMode.value) return
    const tool = getDrawTool(activeDrawTool.value)
    if (tool && tool.kind === 'line') {
      event.preventDefault()
      finishCurrentLine()
      requestDraw()
    }
  }

  // 右键：结束当前线（点数≥2 则提交，否则取消）。
  function handleCanvasContextMenu(event) {
    if (!drawMode.value) return
    event.preventDefault()
    const tool = getDrawTool(activeDrawTool.value)
    if (tool && tool.kind === 'line') {
      finishCurrentLine()
      requestDraw()
    }
  }

  // 键盘：回车结束当前线，Esc 退出绘图模式。
  function handleDrawKeydown(event) {
    if (!drawMode.value) return
    if (event.key === 'Enter') {
      finishCurrentLine()
      requestDraw()
    } else if (event.key === 'Escape') {
      exitDrawMode()
    }
  }

  // —— 绘图：渲染（在已应用 zoomTransform 的 context 中）——
  function drawDrawings(context, projection) {
    const k = zoomTransform.value.k
    try {
      const eraseActive = drawMode.value && activeDrawTool.value === 'erase'
      drawings.value.forEach((shape, idx) => {
        const proj = shape.points.map((point) => projection(point))
        drawShape(context, shape, proj, k, false, eraseActive && idx === hoverDeleteIndex.value)
      })
      if (!drawMode.value) return
      const tool = getDrawTool(activeDrawTool.value)
      if (!tool) return
      if (tool.kind === 'line' && draftPoints.value.length) {
        const pts = draftPoints.value.slice()
        if (draftCursor.value) pts.push([draftCursor.value.lon, draftCursor.value.lat])
        const proj = pts.map((point) => projection(point))
        drawShape(context, { kind: 'line', render: tool.render, color: tool.color }, proj, k, true)
      } else if (tool.kind === 'box' && local.boxDragging && local.boxStartGeo && draftCursor.value) {
        const proj = [
          projection([local.boxStartGeo.lon, local.boxStartGeo.lat]),
          projection([draftCursor.value.lon, draftCursor.value.lat])
        ]
        drawShape(context, { kind: 'box', render: tool.render, color: tool.color }, proj, k, false)
      }
    } catch (error) {
      // 绘图渲染异常不应影响整幅地图的绘制与交互。
      console.warn('绘制手绘图形失败：', error)
    }
  }

  const hasDrawings = computed(() => drawings.value.length > 0 || draftPoints.value.length > 0)
  const draftPointCount = computed(() => draftPoints.value.length)

  return {
    setDrawTool,
    exitDrawMode,
    finishCurrentLine,
    undoDrawing,
    clearDrawings,
    findShapeIndexNear,
    handleCanvasPointerDown,
    handleCanvasPointerUp,
    handleCanvasClick,
    handleCanvasDblClick,
    handleCanvasContextMenu,
    handleDrawKeydown,
    drawDrawings,
    hasDrawings,
    draftPointCount
  }
}
