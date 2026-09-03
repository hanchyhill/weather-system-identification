"""解码 vis_web 前端底图 TopoJSON，供形势图描边。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_MAP_DIR = REPO_ROOT / "vis_web" / "src" / "source"
WORLD_TOPO_PATH = FRONTEND_MAP_DIR / "110m.json"
CHINA_TOPO_PATH = FRONTEND_MAP_DIR / "bou2_4l.topo.simplify.json"

WORLD_STROKE = (48 / 255, 60 / 255, 76 / 255, 0.78)
CHINA_STROKE = (31 / 255, 41 / 255, 55 / 255, 0.9)


def decode_arcs(topo: dict) -> list[list[tuple[float, float]]]:
    """把 TopoJSON 的 delta 弧段还原为经纬度折线。"""
    transform = topo.get("transform") or {}
    scale = transform.get("scale") or [1.0, 1.0]
    translate = transform.get("translate") or [0.0, 0.0]
    decoded: list[list[tuple[float, float]]] = []
    for raw_arc in topo.get("arcs") or []:
        x = y = 0
        points: list[tuple[float, float]] = []
        for dx, dy in raw_arc:
            x += dx
            y += dy
            points.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
        decoded.append(points)
    return decoded


def _ring(decoded_arcs: list[list[tuple[float, float]]], indexes: list[int]) -> list[tuple[float, float]]:
    ring: list[tuple[float, float]] = []
    for index in indexes:
        if index < 0:
            points = list(reversed(decoded_arcs[~index]))
        else:
            points = decoded_arcs[index]
        if ring:
            points = points[1:]
        ring.extend(points)
    return ring


def geometry_lines(geom: dict, decoded_arcs: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """把一个 TopoJSON geometry 转成折线（只描边，与前端 stroke 一致）。"""
    arcs = geom.get("arcs")
    if not arcs:
        return []
    geom_type = geom.get("type")
    if geom_type in {None, "LineString"} and isinstance(arcs[0], int):
        return [_ring(decoded_arcs, arcs)]
    if geom_type in {None, "LineString", "MultiLineString"} and isinstance(arcs[0], list) and arcs[0] and isinstance(arcs[0][0], int):
        return [_ring(decoded_arcs, part) for part in arcs if part]
    if geom_type == "Polygon":
        return [_ring(decoded_arcs, ring) for ring in arcs if ring]
    if geom_type == "MultiPolygon":
        lines = []
        for polygon in arcs:
            for ring in polygon:
                if ring:
                    lines.append(_ring(decoded_arcs, ring))
        return lines
    return []


def object_lines(topo: dict, object_name: str) -> list[list[tuple[float, float]]]:
    decoded = decode_arcs(topo)
    collection = topo["objects"][object_name]
    geometries = collection.get("geometries") or [collection]
    lines: list[list[tuple[float, float]]] = []
    for geom in geometries:
        lines.extend(geometry_lines(geom, decoded))
    return [line for line in lines if len(line) >= 2]


@lru_cache(maxsize=1)
def load_frontend_basemap_lines() -> tuple[list[list[tuple[float, float]]], list[list[tuple[float, float]]]]:
    """读取前端 ``110m`` 陆地与 ``bou2_4l`` 中国境界。"""
    world_topo = json.loads(WORLD_TOPO_PATH.read_text(encoding="utf-8"))
    china_topo = json.loads(CHINA_TOPO_PATH.read_text(encoding="utf-8"))
    return object_lines(world_topo, "land"), object_lines(china_topo, "bou2_4l")


def draw_frontend_basemap(ax) -> None:
    """按 vis_web 底图描边：世界陆地轮廓 + 中国境界。"""
    import cartopy.crs as ccrs

    world_lines, china_lines = load_frontend_basemap_lines()
    for line in world_lines:
        lons, lats = zip(*line)
        ax.plot(
            lons,
            lats,
            color=WORLD_STROKE,
            linewidth=1.0,
            solid_capstyle="round",
            transform=ccrs.PlateCarree(),
            zorder=4,
        )
    for line in china_lines:
        lons, lats = zip(*line)
        ax.plot(
            lons,
            lats,
            color=CHINA_STROKE,
            linewidth=1.6,
            solid_capstyle="round",
            transform=ccrs.PlateCarree(),
            zorder=5,
        )
