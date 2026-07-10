// 地图手绘图形的 canvas 2D 渲染工具。
//
// 约定：所有绘制都在“已应用 zoomTransform（translate+scale(k)）”的 context 中进行，
// 传入的 proj 为各控制点经 d3 projection 投影后的像素坐标 [x, y]（未乘 zoomTransform）。
// 为使线宽/符号在屏幕上保持恒定大小，凡涉及尺寸处一律除以 k。
//
// 曲线平滑采用 Catmull-Rom 样条，α=1（弦长参数化），与参考实现 GeoMap.vue 中
// d3.curveCatmullRom.alpha(1) 一致，此处为无依赖的等价实现。

const EPS = 1e-6

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

// Barry–Goldman 递归插值的一层：在 [ta, tb] 上按 t 对 a、b 做线性混合。
function lerpT(a, b, ta, tb, t) {
  const denom = tb - ta || EPS
  const f = (tb - t) / denom
  const g = (t - ta) / denom
  return [a[0] * f + b[0] * g, a[1] * f + b[1] * g]
}

// Catmull-Rom 样条：输入控制点数组，返回加密后的折线点数组。
// alpha=1 为弦长参数化；samples 为每段采样数。
export function catmullRom(points, alpha = 1, samples = 18) {
  if (!points || points.length < 3) return points ? points.slice() : []
  const p = points
  const pad = [p[0], ...p, p[p.length - 1]]
  const out = []
  for (let i = 1; i < pad.length - 2; i++) {
    const p0 = pad[i - 1]
    const p1 = pad[i]
    const p2 = pad[i + 1]
    const p3 = pad[i + 2]
    const t0 = 0
    const t1 = t0 + (Math.pow(dist(p0, p1), alpha) || EPS)
    const t2 = t1 + (Math.pow(dist(p1, p2), alpha) || EPS)
    const t3 = t2 + (Math.pow(dist(p2, p3), alpha) || EPS)
    for (let j = 0; j < samples; j++) {
      const t = t1 + (t2 - t1) * (j / samples)
      const a1 = lerpT(p0, p1, t0, t1, t)
      const a2 = lerpT(p1, p2, t1, t2, t)
      const a3 = lerpT(p2, p3, t2, t3, t)
      const b1 = lerpT(a1, a2, t0, t2, t)
      const b2 = lerpT(a2, a3, t1, t3, t)
      out.push(lerpT(b1, b2, t1, t2, t))
    }
  }
  out.push(p[p.length - 1])
  return out
}

// 沿折线按固定间隔取样，对每个取样点回调 (point, tangentAngle)。
function placeAlong(pts, spacing, startOffset, cb) {
  let acc = startOffset
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const segLen = Math.hypot(dx, dy)
    if (segLen < EPS) continue
    const ux = dx / segLen
    const uy = dy / segLen
    while (acc <= segLen) {
      if (acc >= 0) cb([a[0] + ux * acc, a[1] + uy * acc], Math.atan2(uy, ux))
      acc += spacing
    }
    acc -= segLen
  }
}

function strokeSmooth(ctx, pts, color, width, dash) {
  if (pts.length < 2) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash(dash || [])
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.stroke()
  ctx.restore()
}

// 切变线：红色双横线（两条平行红曲线）。
function drawShear(ctx, smooth, color, k) {
  const off = 2.6 / k
  const width = 1.6 / k
  const left = []
  const right = []
  for (let i = 0; i < smooth.length; i++) {
    const prev = smooth[Math.max(0, i - 1)]
    const next = smooth[Math.min(smooth.length - 1, i + 1)]
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || EPS
    const nx = -dy / len
    const ny = dx / len
    const c = smooth[i]
    left.push([c[0] + nx * off, c[1] + ny * off])
    right.push([c[0] - nx * off, c[1] - ny * off])
  }
  strokeSmooth(ctx, left, color, width)
  strokeSmooth(ctx, right, color, width)
}

// 辐合线：黑色点画线（-*-*-*- 样式），短划线 + 其间的小星号。
function drawConvergence(ctx, smooth, color, k) {
  strokeSmooth(ctx, smooth, color, 1.7 / k, [13 / k, 9 / k])
  const r = 3 / k
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.3 / k
  ctx.lineCap = 'round'
  placeAlong(smooth, 22 / k, 11 / k, (pt) => {
    // 三条交叉短线组成星号 *
    for (let a = 0; a < 3; a++) {
      const ang = (Math.PI / 3) * a
      const dx = Math.cos(ang) * r
      const dy = Math.sin(ang) * r
      ctx.beginPath()
      ctx.moveTo(pt[0] - dx, pt[1] - dy)
      ctx.lineTo(pt[0] + dx, pt[1] + dy)
      ctx.stroke()
    }
  })
  ctx.restore()
}

// 曲线尾端箭头。
function drawArrowHead(ctx, smooth, color, k) {
  if (smooth.length < 2) return
  const tip = smooth[smooth.length - 1]
  const prev = smooth[smooth.length - 2]
  const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0])
  const size = 12 / k
  const spread = Math.PI / 7
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(tip[0], tip[1])
  ctx.lineTo(tip[0] - size * Math.cos(ang - spread), tip[1] - size * Math.sin(ang - spread))
  ctx.lineTo(tip[0] - size * Math.cos(ang + spread), tip[1] - size * Math.sin(ang + spread))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

// 折线总弧长。
function polylineLength(pts) {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += dist(pts[i], pts[i - 1])
  return total
}

// 从折线末端沿弧长回退 distFromEnd，返回该处的点、所在段较靠末端的顶点索引 i
// （落点位于 pts[i-1] 与 pts[i] 之间）以及朝向末端的单位切向。
function pointBackFromEnd(pts, distFromEnd) {
  let remaining = distFromEnd
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i]
    const b = pts[i - 1]
    const seg = dist(a, b)
    if (seg < EPS) continue
    if (remaining <= seg) {
      const t = remaining / seg
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        index: i,
        tangent: [(a[0] - b[0]) / seg, (a[1] - b[1]) / seg]
      }
    }
    remaining -= seg
  }
  const a = pts[0]
  const b = pts[1] || pts[0]
  const seg = dist(b, a) || EPS
  return { point: a.slice(), index: 1, tangent: [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] }
}

// 将折线沿左法向偏移 off（off 可正可负），逐顶点用相邻方向估计法向。
function offsetPolyline(pts, off) {
  const n = pts.length
  const out = []
  for (let i = 0; i < n; i++) {
    let tx
    let ty
    if (i === 0) {
      tx = pts[1][0] - pts[0][0]
      ty = pts[1][1] - pts[0][1]
    } else if (i === n - 1) {
      tx = pts[n - 1][0] - pts[n - 2][0]
      ty = pts[n - 1][1] - pts[n - 2][1]
    } else {
      tx = pts[i + 1][0] - pts[i - 1][0]
      ty = pts[i + 1][1] - pts[i - 1][1]
    }
    const len = Math.hypot(tx, ty) || EPS
    const nx = -ty / len
    const ny = tx / len
    out.push([pts[i][0] + nx * off, pts[i][1] + ny * off])
  }
  return out
}

// 空心块状箭头：线身为无填充的细长矩形轮廓，箭头亦为中空三角，整体仅描边、更粗。
function drawBlockArrow(ctx, smooth, color, k) {
  const shaftHalf = 4 / k // 线身半宽
  const headHalf = 9.5 / k // 箭头半宽（比线身宽）
  const lineWidth = 2 / k

  const total = polylineLength(smooth)
  let headLen = 17 / k
  if (total < headLen * 1.25) headLen = total * 0.5

  const back = pointBackFromEnd(smooth, headLen)
  const tip = smooth[smooth.length - 1]

  // 线身中心线：起点直到回退点。
  const shaftCenter = [...smooth.slice(0, back.index), back.point]
  if (shaftCenter.length < 2) shaftCenter.unshift(smooth[0])

  const leftShaft = offsetPolyline(shaftCenter, shaftHalf)
  const rightShaft = offsetPolyline(shaftCenter, -shaftHalf)

  // 回退点处的法向，用于箭头两翼底角。
  const ux = back.tangent[0]
  const uy = back.tangent[1]
  const nx = -uy
  const ny = ux
  const headBaseLeft = [back.point[0] + nx * headHalf, back.point[1] + ny * headHalf]
  const headBaseRight = [back.point[0] - nx * headHalf, back.point[1] - ny * headHalf]

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  // 左侧线身（尾 -> 回退点）
  ctx.moveTo(leftShaft[0][0], leftShaft[0][1])
  for (let i = 1; i < leftShaft.length; i++) ctx.lineTo(leftShaft[i][0], leftShaft[i][1])
  // 左翼 -> 尖 -> 右翼
  ctx.lineTo(headBaseLeft[0], headBaseLeft[1])
  ctx.lineTo(tip[0], tip[1])
  ctx.lineTo(headBaseRight[0], headBaseRight[1])
  // 右侧线身（回退点 -> 尾）
  for (let i = rightShaft.length - 1; i >= 0; i--) ctx.lineTo(rightShaft[i][0], rightShaft[i][1])
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

// 冷锋：蓝线 + 一侧等距实心三角。标记朝行进方向的左侧（自左向右画时在线上方）。
function drawColdFront(ctx, smooth, color, k) {
  const half = 5.5 / k
  const height = 9.5 / k
  ctx.save()
  ctx.fillStyle = color
  placeAlong(smooth, 26 / k, 14 / k, (pt, ang) => {
    const ux = Math.cos(ang)
    const uy = Math.sin(ang)
    const nx = uy
    const ny = -ux
    ctx.beginPath()
    ctx.moveTo(pt[0] - ux * half, pt[1] - uy * half)
    ctx.lineTo(pt[0] + ux * half, pt[1] + uy * half)
    ctx.lineTo(pt[0] + nx * height, pt[1] + ny * height)
    ctx.closePath()
    ctx.fill()
  })
  ctx.restore()
}

// 暖锋：红线 + 一侧等距实心半圆（参考 GeoMap.vue 暖锋 marker 半圆样式）。
// 标记朝行进方向的左侧（自左向右画时在线上方），与冷锋同侧约定。
function drawWarmFront(ctx, smooth, color, k) {
  const r = 5.5 / k
  ctx.save()
  ctx.fillStyle = color
  placeAlong(smooth, 24 / k, 12 / k, (pt, ang) => {
    ctx.beginPath()
    ctx.arc(pt[0], pt[1], r, ang, ang + Math.PI, true)
    ctx.closePath()
    ctx.fill()
  })
  ctx.restore()
}

// 椭圆 / 矩形：由拖拽出的两个对角点定义外接框。
function drawBox(ctx, render, a, b, color, k) {
  const x = Math.min(a[0], b[0])
  const y = Math.min(a[1], b[1])
  const w = Math.abs(a[0] - b[0])
  const h = Math.abs(a[1] - b[1])
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2 / k
  if (render === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.strokeRect(x, y, w, h)
  }
  ctx.restore()
}

// 文字标注（L / D / H / G / ☈ / 🌀 等字形），加白色描边以便在各种底图上清晰。
function drawTextLabel(ctx, p, text, color, k) {
  const size = 22 / k
  ctx.save()
  ctx.font = `bold ${size}px "Segoe UI", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4 / k
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.strokeText(text || '', p[0], p[1])
  ctx.fillStyle = color
  ctx.fillText(text || '', p[0], p[1])
  ctx.restore()
}

// 绘制在制的线的控制点小圆点，辅助定位。
function drawVertices(ctx, pts, color, k) {
  ctx.save()
  ctx.fillStyle = color
  for (const pt of pts) {
    ctx.beginPath()
    ctx.arc(pt[0], pt[1], 2.4 / k, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// 统一分发：根据 shape.kind / shape.render 绘制单个图形。
// proj：各控制点投影后的像素坐标数组；isDraft：是否为在制预览；
// highlight：删除模式下鼠标悬停命中，用醒目色高亮提示将被删除。
export function drawShape(ctx, shape, proj, k, isDraft = false, highlight = false) {
  const pts = (proj || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  const color = highlight ? '#f59e0b' : shape.color

  if (shape.kind === 'point') {
    if (!pts[0]) return
    drawTextLabel(ctx, pts[0], shape.text, color, k)
    return
  }

  if (shape.kind === 'box') {
    if (pts.length < 2) return
    drawBox(ctx, shape.render, pts[0], pts[1], color, k)
    return
  }

  // 线类型
  if (pts.length < 2) {
    if (isDraft && pts.length) drawVertices(ctx, pts, color, k)
    return
  }
  const smooth = catmullRom(pts, 1, 18)
  switch (shape.render) {
    case 'trough':
      strokeSmooth(ctx, smooth, color, 2.4 / k)
      break
    case 'shear':
      drawShear(ctx, smooth, color, k)
      break
    case 'convergence':
      drawConvergence(ctx, smooth, color, k)
      break
    case 'arrow':
      strokeSmooth(ctx, smooth, color, 2.2 / k)
      drawArrowHead(ctx, smooth, color, k)
      break
    case 'block-arrow':
      drawBlockArrow(ctx, smooth, color, k)
      break
    case 'cold':
      strokeSmooth(ctx, smooth, color, 2.2 / k)
      drawColdFront(ctx, smooth, color, k)
      break
    case 'warm':
      strokeSmooth(ctx, smooth, color, 2.2 / k)
      drawWarmFront(ctx, smooth, color, k)
      break
    default:
      strokeSmooth(ctx, smooth, color, 2.2 / k)
  }
  if (isDraft) drawVertices(ctx, pts, color, k)
}
