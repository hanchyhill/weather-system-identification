// 地图渲染：主绘制入口 drawMap 与全部 draw* 图元绘制，以及 hover 命中检测与鼠标事件。
// drawMap 通过 store.drawDrawings 调用手绘模块的绘制；handleMouseMove 通过 store 引用手绘/投影模块。
import * as d3 from 'd3'

import { drawShape } from '../../utils/mapDrawing'
import { CONTOUR_DILATION_OFFSETS, SHEAR_COLORS } from './constants'
import {
  getTileZoom,
  graticuleStep,
  formatLonTick,
  formatLatTick,
  layerDrawPriority,
  isUsableLayerStatus,
  contourDilationRadius,
  lineArrowGeometry,
  getDrawTool
} from './helpers'

export function useMapRenderer(store) {
  const {
    canvasRef,
    canvasSize,
    zoomTransform,
    compactView,
    worldFeatures,
    chinaFeatures,
    activeSvgLayers,
    showSvgLayer,
    fillLayerCount,
    showTileDebug,
    syncState,
    syncId,
    drawMode,
    activeDrawTool,
    hoverDeleteIndex,
    draftCursor,
    mouseGeo,
    hoverLine,
    hoverJetLine,
    hoverVortexCenter,
    hoverVortexTrack,
    showTooltip,
    showTrough,
    showRawPoints,
    showJetArrowHeads,
    showFutureVortexTracks,
    showOnlyFutureVortexTracks,
    showGraticule,
    fcHour,
    troughLineWidth,
    jetLineWidth,
    visibleTroughLines,
    visibleJetAxisLines,
    visibleColdFrontLines,
    visibleVortexCenters,
    visibleVortexTracks,
    buildProjection,
    transformedPoint,
    screenToGeo,
    requestDraw
  } = store

  function drawMap() {
    const canvas = canvasRef.value
    if (!canvas) return
    const context = canvas.getContext('2d')
    // compact（多图子图）固定 1×：子图尺寸小，不随设备像素比放大位图，显著降低
    // 每个子图的栅格/绘制成本与显存占用；单图仍用完整 devicePixelRatio 保持清晰。
    const ratio = compactView ? 1 : (window.devicePixelRatio || 1)
    const targetWidth = Math.floor(canvasSize.width * ratio)
    const targetHeight = Math.floor(canvasSize.height * ratio)
    // 仅在尺寸变化时才重设 canvas.width/height：赋值会清空并重新分配整块 backing store，
    // 若每次重绘（hover/zoom/平移）都执行，9 个子图叠加开销很大。尺寸不变时用 clearRect 清屏即可。
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
      canvas.style.width = `${canvasSize.width}px`
      canvas.style.height = `${canvasSize.height}px`
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, canvasSize.width, canvasSize.height)

    const projection = buildProjection()
    const path = d3.geoPath(projection, context)

    context.fillStyle = '#f6f8fb'
    context.fillRect(0, 0, canvasSize.width, canvasSize.height)

    context.save()
    context.translate(zoomTransform.value.x, zoomTransform.value.y)
    context.scale(zoomTransform.value.k, zoomTransform.value.k)

    drawWeatherLayers(context, projection, true)
    drawBaseMap(context, path)
    if (showGraticule.value) drawGraticule(context, projection)
    drawWeatherLayers(context, projection, false)
    drawTroughLines(context, projection)
    drawColdFrontLines(context, projection)
    drawJetAxes(context, projection)
    drawVortexTracks(context, projection)
    drawVortexCenters(context, projection)
    if (store.drawDrawings) store.drawDrawings(context, projection)
    drawTileDebug(context, projection)

    context.restore()
    if (showGraticule.value) drawGraticuleAxes(context, projection)
    drawHudFrame(context)
    drawSynchronizedCursor(context, projection)
  }

  function drawSynchronizedCursor(context, projection) {
    const cursor = syncState?.cursor
    if (!cursor || cursor.source === syncId) return
    const point = transformedPoint(projection, [cursor.lon, cursor.lat])
    if (!point) return
    const [x, y] = point
    if (x < 0 || x > canvasSize.width || y < 0 || y > canvasSize.height) return

    context.save()
    context.strokeStyle = '#1f7a8c'
    context.lineWidth = 1.6
    context.beginPath()
    context.moveTo(x - 8, y)
    context.lineTo(x + 8, y)
    context.moveTo(x, y - 8)
    context.lineTo(x, y + 8)
    context.stroke()
    context.restore()
  }

  function trackColor(track) {
    return track.warm ? '#f97316' : '#0ea5e9'
  }

  function drawBaseMap(context, path) {
    if (worldFeatures.value) {
      context.beginPath()
      path(worldFeatures.value)
      context.strokeStyle = 'rgba(48, 60, 76, 0.78)'
      context.lineWidth = 1.2 / zoomTransform.value.k
      context.stroke()
    }

    if (chinaFeatures.value) {
      context.beginPath()
      path(chinaFeatures.value)
      context.strokeStyle = 'rgba(31, 41, 55, 0.9)'
      context.lineWidth = 2 / zoomTransform.value.k
      context.stroke()
    }
  }

  function drawGraticule(context, projection) {
    const interval = graticuleStep(zoomTransform.value.k)
    const path = d3.geoPath(projection, context)
    const bounds = store.manifestBounds()
    const graticule = d3.geoGraticule()
      .extent([[bounds.lon_min, bounds.lat_min], [bounds.lon_max, bounds.lat_max]])
      .step([interval, interval])

    context.beginPath()
    path(graticule())
    context.strokeStyle = 'rgba(76, 89, 105, 0.34)'
    context.lineWidth = 0.55 / zoomTransform.value.k
    context.setLineDash([3 / zoomTransform.value.k, 3 / zoomTransform.value.k])
    context.stroke()
    context.setLineDash([])
  }

  // 屏幕空间绘制经纬度坐标轴：沿画布底边标注经度、沿左边标注纬度。
  // 在 context.restore() 之后调用，坐标使用 CSS 像素（不随缩放放大），刻度位置由投影反算。
  function drawGraticuleAxes(context, projection) {
    const { width, height } = canvasSize
    const interval = graticuleStep(zoomTransform.value.k)
    const bounds = store.manifestBounds()
    const midLon = (bounds.lon_min + bounds.lon_max) / 2
    const midLat = (bounds.lat_min + bounds.lat_max) / 2

    const axisWidth = 34
    const axisHeight = 20

    context.save()
    // 半透明底衬，保证刻度在图层之上仍清晰可读。
    context.fillStyle = 'rgba(246, 248, 251, 0.82)'
    context.fillRect(0, height - axisHeight, width, axisHeight)
    context.fillRect(0, 0, axisWidth, height - axisHeight)

    context.font = '600 11px "PingFang SC", "Microsoft YaHei", sans-serif'
    context.fillStyle = 'rgba(31, 41, 55, 0.9)'
    context.strokeStyle = 'rgba(76, 89, 105, 0.5)'
    context.lineWidth = 1

    // 经度刻度（底边）
    context.textAlign = 'center'
    context.textBaseline = 'bottom'
    const lonStart = Math.ceil(bounds.lon_min / interval) * interval
    for (let lon = lonStart; lon <= bounds.lon_max + 1e-6; lon += interval) {
      const point = transformedPoint(projection, [lon, midLat])
      if (!point) continue
      const x = point[0]
      if (x < axisWidth || x > width) continue
      context.beginPath()
      context.moveTo(x, height - axisHeight)
      context.lineTo(x, height - axisHeight + 4)
      context.stroke()
      context.fillText(formatLonTick(lon), x, height - 4)
    }

    // 纬度刻度（左边）
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    const latStart = Math.ceil(bounds.lat_min / interval) * interval
    for (let lat = latStart; lat <= bounds.lat_max + 1e-6; lat += interval) {
      const point = transformedPoint(projection, [midLon, lat])
      if (!point) continue
      const y = point[1]
      if (y < 0 || y > height - axisHeight) continue
      context.beginPath()
      context.moveTo(axisWidth - 4, y)
      context.lineTo(axisWidth, y)
      context.stroke()
      context.fillText(formatLatTick(lat), 3, y)
    }

    // 坐标轴基线
    context.strokeStyle = 'rgba(76, 89, 105, 0.7)'
    context.beginPath()
    context.moveTo(axisWidth, 0)
    context.lineTo(axisWidth, height - axisHeight)
    context.lineTo(width, height - axisHeight)
    context.stroke()
    context.restore()
  }

  function drawWeatherLayers(context, projection, fillLayers) {
    if (!showSvgLayer.value || !activeSvgLayers.value.length) return

    const layers = activeSvgLayers.value
      .filter((layer) => layer.isFill === fillLayers)
      .sort((left, right) => {
        if (fillLayers) return left.order - right.order
        return layerDrawPriority(left.type) - layerDrawPriority(right.type) || left.order - right.order
      })

    for (const layer of layers) {
      drawSvgLayer(context, projection, layer)
    }
  }

  function drawSvgLayer(context, projection, layer) {
    if (!layer?.record) return

    if (Array.isArray(layer.tiles)) {
      for (const tile of layer.tiles) {
        drawSvgImage(context, projection, tile.image, tile.bounds, layer)
      }
      return
    }

    drawSvgImage(context, projection, layer.image, layer.record.bounds, layer)
  }

  function drawSvgImage(context, projection, image, bounds, layer) {
    if (!image || !bounds) return
    const topLeft = projection([bounds.lon_min, bounds.lat_max])
    const bottomRight = projection([bounds.lon_max, bounds.lat_min])
    if (!topLeft || !bottomRight) return

    const dx = topLeft[0]
    const dy = topLeft[1]
    const dw = bottomRight[0] - topLeft[0]
    const dh = bottomRight[1] - topLeft[1]

    context.globalAlpha = layer.isFill && fillLayerCount.value > 1 ? 0.5 : 1
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'

    // 放大系数较小时，先以多方向偏移重绘等值线以加粗线条，使视觉线宽在各放大系数下保持一致。
    const dilation = contourDilationRadius(layer, zoomTransform.value.k)
    if (dilation > 0) {
      for (const [ox, oy] of CONTOUR_DILATION_OFFSETS) {
        context.drawImage(image, dx + ox * dilation, dy + oy * dilation, dw, dh)
      }
    }

    context.drawImage(image, dx, dy, dw, dh)
    context.globalAlpha = 1
  }

  function drawTroughLines(context, projection) {
    if (!visibleTroughLines.value.length) return

    for (const line of visibleTroughLines.value) {
      const points = line.smoothed_points?.length ? line.smoothed_points : line.points
      if (!points?.length) continue

      context.beginPath()
      points.forEach((point, index) => {
        const xy = projection([point.lon, point.lat])
        if (!xy) return
        if (index === 0) context.moveTo(xy[0], xy[1])
        else context.lineTo(xy[0], xy[1])
      })
      context.strokeStyle = SHEAR_COLORS[line.shear_type] || '#111827'
      context.lineWidth = Math.max(troughLineWidth.value / zoomTransform.value.k, 0.65)
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.stroke()

      if (showRawPoints.value && line.points?.length) {
        context.fillStyle = SHEAR_COLORS[line.shear_type] || '#111827'
        for (const point of line.points) {
          const xy = projection([point.lon, point.lat])
          if (!xy) continue
          context.beginPath()
          context.arc(xy[0], xy[1], 1.8 / zoomTransform.value.k, 0, Math.PI * 2)
          context.fill()
        }
      }
    }
  }

  function drawColdFrontLines(context, projection) {
    if (!visibleColdFrontLines.value.length) return

    for (const line of visibleColdFrontLines.value) {
      const projectedPoints = (line.points || [])
        .map((point) => projection([point.lon, point.lat]))
        .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      if (projectedPoints.length < 2) continue

      drawShape(
        context,
        { kind: 'line', render: 'cold', color: '#2563eb' },
        projectedPoints,
        zoomTransform.value.k
      )
    }
  }

  function drawJetAxes(context, projection) {
    if (!visibleJetAxisLines.value.length) return

    for (const line of visibleJetAxisLines.value) {
      const points = line.smoothed_points?.length ? line.smoothed_points : line.points
      if (!points?.length) continue

      const projectedPoints = points
        .map((point) => projection([point.lon, point.lat]))
        .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))

      if (projectedPoints.length < 2) continue

      context.save()
      context.beginPath()
      projectedPoints.forEach((point, index) => {
        if (index === 0) context.moveTo(point[0], point[1])
        else context.lineTo(point[0], point[1])
      })
      context.strokeStyle = '#e11d48'
      context.lineWidth = jetLineWidth.value / zoomTransform.value.k
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.stroke()

      if (showJetArrowHeads.value) drawLineArrowHead(context, projectedPoints, '#e11d48')
      context.restore()
    }
  }

  function drawLineArrowHead(context, projectedPoints, color, lengthPx = 24, halfWidthPx = 5) {
    const arrow = lineArrowGeometry(projectedPoints)
    if (!arrow) return

    const { point: baseCenter, angle } = arrow
    const length = lengthPx / zoomTransform.value.k
    const halfWidth = halfWidthPx / zoomTransform.value.k
    const tip = [
      baseCenter[0] + length * Math.cos(angle),
      baseCenter[1] + length * Math.sin(angle)
    ]
    const normal = angle + Math.PI / 2

    context.fillStyle = color
    context.beginPath()
    context.moveTo(tip[0], tip[1])
    context.lineTo(
      baseCenter[0] + halfWidth * Math.cos(normal),
      baseCenter[1] + halfWidth * Math.sin(normal)
    )
    context.lineTo(
      baseCenter[0] - halfWidth * Math.cos(normal),
      baseCenter[1] - halfWidth * Math.sin(normal)
    )
    context.closePath()
    context.fill()
  }

  function drawVortexTracks(context, projection) {
    if (!visibleVortexTracks.value.length) return

    visibleVortexTracks.value.forEach((track) => {
      const color = trackColor(track)
      const lineWidth = track.warm ? 2.1 / zoomTransform.value.k : 1.5 / zoomTransform.value.k

      for (const segment of visibleVortexTrackSegments(track)) {
        drawTrackSegment(context, projection, segment.points, color, lineWidth, segment.dashed)
      }
    })
  }

  function visibleVortexTrackSegments(track) {
    const points = (track.track || []).filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
    if (points.length < 2) return []

    const currentStep = Number(fcHour.value)
    const onlyFuture = showOnlyFutureVortexTracks.value
    const showFuture = onlyFuture || showFutureVortexTracks.value
    const pastPoints = onlyFuture
      ? []
      : points.filter((point) => Number(point.step ?? point.fc_hour) <= currentStep)
    const futurePoints = showFuture
      ? points.filter((point) => Number(point.step ?? point.fc_hour) >= currentStep)
      : []

    return [
      { points: pastPoints, dashed: false },
      { points: futurePoints, dashed: true }
    ]
  }

  function drawTrackSegment(context, projection, points, color, lineWidth, dashed) {
    if (points.length < 2) return

    const projectedPoints = points
      .map((point) => projection([point.lon, point.lat]))
      .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))

    if (projectedPoints.length < 2) return

    context.save()
    context.beginPath()
    projectedPoints.forEach((point, pointIndex) => {
      if (pointIndex === 0) context.moveTo(point[0], point[1])
      else context.lineTo(point[0], point[1])
    })
    context.strokeStyle = color
    context.lineWidth = lineWidth
    context.setLineDash(dashed ? [5 / zoomTransform.value.k, 4 / zoomTransform.value.k] : [])
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke()
    drawLineArrowHead(context, projectedPoints, color, 16, 4)
    context.restore()
  }

  function drawVortexCenters(context, projection) {
    if (!visibleVortexCenters.value.length) return

    for (const center of visibleVortexCenters.value) {
      if (!Number.isFinite(center.lon) || !Number.isFinite(center.lat)) continue
      const xy = projection([center.lon, center.lat])
      if (!xy) continue

      context.save()
      context.translate(xy[0], xy[1])
      context.fillStyle = '#dc2626'
      context.font = `800 ${24 / zoomTransform.value.k}px Arial`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText('L', 0, 0.5 / zoomTransform.value.k)
      context.restore()
    }
  }

  function drawTileDebug(context, projection) {
    if (!showTileDebug.value) return

    const k = zoomTransform.value.k
    const debugLayers = activeSvgLayers.value.filter((layer) => Array.isArray(layer.tiles) && layer.tiles.length)
    if (!debugLayers.length) return

    context.save()
    for (const layer of debugLayers) {
      for (const tile of layer.tiles) {
        const bounds = tile.bounds
        if (!bounds) continue
        const topLeft = projection([bounds.lon_min, bounds.lat_max])
        const bottomRight = projection([bounds.lon_max, bounds.lat_min])
        if (!topLeft || !bottomRight) continue

        const width = bottomRight[0] - topLeft[0]
        const height = bottomRight[1] - topLeft[1]

        context.strokeStyle = 'rgba(220, 38, 38, 0.9)'
        context.lineWidth = 1.4 / k
        context.setLineDash([6 / k, 4 / k])
        context.strokeRect(topLeft[0], topLeft[1], width, height)
        context.setLineDash([])

        const centerX = topLeft[0] + width / 2
        const centerY = topLeft[1] + height / 2
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillStyle = 'rgba(220, 38, 38, 0.95)'
        context.font = `700 ${14 / k}px Menlo, Consolas, monospace`
        context.fillText(`${layer.type} z${tile.z}`, centerX, centerY - 8 / k)
        context.font = `500 ${12 / k}px Menlo, Consolas, monospace`
        context.fillText(`x${tile.x} y${tile.y} k=${k.toFixed(2)}`, centerX, centerY + 9 / k)
      }
    }
    context.restore()
  }

  function drawHudFrame(context) {
    context.strokeStyle = '#bcc7d3'
    context.lineWidth = 1
    context.strokeRect(0.5, 0.5, canvasSize.width - 1, canvasSize.height - 1)

    if (showTileDebug.value) {
      const z = getTileZoom(zoomTransform.value.k)
      const actualZoomItems = activeSvgLayers.value
        .filter((layer) => Number.isFinite(layer.z))
        .map((layer) => `${layer.type}:z${layer.z}`)
      const actualZooms = actualZoomItems.length > 4
        ? `${actualZoomItems.slice(0, 4).join('  ')}  +${actualZoomItems.length - 4}`
        : actualZoomItems.join('  ')
      const text = `瓦片调试  k=${zoomTransform.value.k.toFixed(2)}  期望z=${z}${actualZooms ? `  ${actualZooms}` : ''}`
      context.font = '600 12px Menlo, Consolas, monospace'
      context.textAlign = 'left'
      context.textBaseline = 'top'
      const paddingX = 8
      const paddingY = 5
      const metrics = context.measureText(text)
      const boxWidth = metrics.width + paddingX * 2
      const boxHeight = 22
      context.fillStyle = 'rgba(15, 23, 42, 0.82)'
      context.fillRect(8, 8, boxWidth, boxHeight)
      context.fillStyle = '#f8fafc'
      context.fillText(text, 8 + paddingX, 8 + paddingY)
    }
  }

  function findNearestLine(mouse) {
    if (!showTooltip.value || !visibleTroughLines.value.length || !mouse) return null
    const projection = buildProjection()
    let nearest = null
    let nearestDistance = Infinity

    for (const line of visibleTroughLines.value) {
      const points = line.smoothed_points?.length ? line.smoothed_points : line.points
      for (const point of points || []) {
        const screen = transformedPoint(projection, [point.lon, point.lat])
        if (!screen) continue
        const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = line
        }
      }
    }

    return nearestDistance <= 12 ? nearest : null
  }

  function findNearestJetLine(mouse) {
    if (!showTooltip.value || !visibleJetAxisLines.value.length || !mouse) return null
    const projection = buildProjection()
    let nearest = null
    let nearestDistance = Infinity

    for (const line of visibleJetAxisLines.value) {
      const points = line.smoothed_points?.length ? line.smoothed_points : line.points
      for (const point of points || []) {
        const screen = transformedPoint(projection, [point.lon, point.lat])
        if (!screen) continue
        const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = line
        }
      }
    }

    return nearestDistance <= 12 ? nearest : null
  }

  function findNearestVortexCenter(mouse) {
    if (!showTooltip.value || !visibleVortexCenters.value.length || !mouse) return null
    const projection = buildProjection()
    let nearest = null
    let nearestDistance = Infinity

    for (const center of visibleVortexCenters.value) {
      const screen = transformedPoint(projection, [center.lon, center.lat])
      if (!screen) continue
      const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = center
      }
    }

    return nearestDistance <= 14 ? nearest : null
  }

  function findNearestVortexTrack(mouse) {
    if (!showTooltip.value || !visibleVortexTracks.value.length || !mouse) return null
    const projection = buildProjection()
    let nearest = null
    let nearestDistance = Infinity

    visibleVortexTracks.value.forEach((track) => {
      for (const segment of visibleVortexTrackSegments(track)) {
        for (const point of segment.points) {
          const screen = transformedPoint(projection, [point.lon, point.lat])
          if (!screen) continue
          const distance = Math.hypot(screen[0] - mouse.x, screen[1] - mouse.y)
          if (distance < nearestDistance) {
            nearestDistance = distance
            nearest = { track, point }
          }
        }
      }
    })

    return nearestDistance <= 11 ? nearest : null
  }

  function handleMouseMove(event) {
    if (drawMode.value) {
      draftCursor.value = screenToGeo(event)
      hoverDeleteIndex.value = getDrawTool(activeDrawTool.value)?.kind === 'erase'
        ? store.findShapeIndexNear(event)
        : -1
      requestDraw()
      return
    }
    mouseGeo.value = screenToGeo(event)
    store.broadcastCursor(mouseGeo.value)
    hoverVortexCenter.value = findNearestVortexCenter(mouseGeo.value)
    hoverVortexTrack.value = hoverVortexCenter.value ? null : findNearestVortexTrack(mouseGeo.value)
    hoverJetLine.value = hoverVortexCenter.value || hoverVortexTrack.value ? null : findNearestJetLine(mouseGeo.value)
    hoverLine.value = hoverVortexCenter.value || hoverVortexTrack.value || hoverJetLine.value ? null : findNearestLine(mouseGeo.value)
  }

  function handleMouseLeave() {
    if (drawMode.value) {
      draftCursor.value = null
      hoverDeleteIndex.value = -1
      requestDraw()
      return
    }
    store.broadcastCursor(null)
    clearHoverState()
  }

  function clearHoverState() {
    mouseGeo.value = null
    hoverLine.value = null
    hoverJetLine.value = null
    hoverVortexCenter.value = null
    hoverVortexTrack.value = null
  }

  return {
    drawMap,
    handleMouseMove,
    handleMouseLeave,
    clearHoverState,
    findNearestLine,
    findNearestJetLine,
    findNearestVortexCenter,
    findNearestVortexTrack
  }
}
