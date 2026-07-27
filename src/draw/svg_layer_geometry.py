"""瓦片坐标、范围与输出路径的公共定义。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

from draw.svg_layer_config import MULTI_Z_LAYER_TYPES, TILE_SCHEME


@dataclass(frozen=True)
class Bounds:
    """经纬度边界。"""

    lon_min: float
    lon_max: float
    lat_min: float
    lat_max: float

    def as_list(self) -> list[float]:
        return [self.lon_min, self.lon_max, self.lat_min, self.lat_max]

    def as_dict(self) -> dict[str, float]:
        return {
            "lon_min": self.lon_min,
            "lon_max": self.lon_max,
            "lat_min": self.lat_min,
            "lat_max": self.lat_max,
        }

    def intersects(self, other: "Bounds") -> bool:
        return (
            self.lon_min < other.lon_max
            and self.lon_max > other.lon_min
            and self.lat_min < other.lat_max
            and self.lat_max > other.lat_min
        )


@dataclass(frozen=True)
class Tile:
    """全局瓦片矩阵中的一个瓦片。"""

    z: int
    x: int
    y: int
    bounds: Bounds

    def as_dict(
        self,
        path: Path,
        init_root: Path,
        status: str = "generated",
        error: str | None = None,
    ) -> dict[str, object]:
        try:
            rel_path = path.relative_to(init_root).as_posix()
        except ValueError:
            rel_path = path.as_posix()

        record: dict[str, object] = {
            "z": self.z,
            "x": self.x,
            "y": self.y,
            "path": rel_path,
            "bounds": self.bounds.as_dict(),
            "status": status,
        }
        if error:
            record["error"] = error
        return record


def tile_scheme_manifest(bounds: Bounds, levels: Iterable[int]) -> dict[str, object]:
    """返回包含本次生成范围与缩放级别的瓦片方案。"""
    scheme = json.loads(json.dumps(TILE_SCHEME))
    scheme["bounds"] = bounds.as_dict()
    selected_levels = [int(level) for level in levels]
    scheme["levels"] = selected_levels
    scheme["tile_count"] = {str(z): matrix_tile_count(z) for z in selected_levels}
    scheme["generated_tile_count"] = {
        str(z): generated_tile_count(bounds, z) for z in selected_levels
    }
    return scheme


def matrix_bounds() -> Bounds:
    values = TILE_SCHEME["matrix_bounds"]
    return Bounds(values["lon_min"], values["lon_max"], values["lat_min"], values["lat_max"])


def tile_size(z: int) -> tuple[float, float]:
    n = 2 ** int(z)
    base_size = TILE_SCHEME["base_tile_size"]
    return base_size["lon"] / n, base_size["lat"] / n


def matrix_tile_count(z: int) -> list[int]:
    lon_size, lat_size = tile_size(z)
    bounds = matrix_bounds()
    return [
        int(round((bounds.lon_max - bounds.lon_min) / lon_size)),
        int(round((bounds.lat_max - bounds.lat_min) / lat_size)),
    ]


def tile_bounds(z: int, x: int, y: int) -> Bounds:
    lon_size, lat_size = tile_size(z)
    bounds = matrix_bounds()
    return Bounds(
        lon_min=bounds.lon_min + x * lon_size,
        lon_max=bounds.lon_min + (x + 1) * lon_size,
        lat_min=bounds.lat_max - (y + 1) * lat_size,
        lat_max=bounds.lat_max - y * lat_size,
    )


def iter_tiles(bounds: Bounds, levels: Iterable[int]) -> list[Tile]:
    """列出与范围相交的所有目标瓦片。"""
    epsilon = 1e-9
    matrix = matrix_bounds()
    tiles: list[Tile] = []
    for z in levels:
        lon_size, lat_size = tile_size(z)
        x_count, y_count = matrix_tile_count(z)
        x_min = max(0, int(np.floor((bounds.lon_min - matrix.lon_min) / lon_size)))
        x_max = min(x_count - 1, int(np.ceil((bounds.lon_max - matrix.lon_min) / lon_size - epsilon)) - 1)
        y_min = max(0, int(np.floor((matrix.lat_max - bounds.lat_max) / lat_size)))
        y_max = min(y_count - 1, int(np.ceil((matrix.lat_max - bounds.lat_min) / lat_size - epsilon)) - 1)
        for y in range(y_min, y_max + 1):
            for x in range(x_min, x_max + 1):
                tile = Tile(int(z), x, y, tile_bounds(int(z), x, y))
                if tile.bounds.intersects(bounds):
                    tiles.append(tile)
    return tiles


def tile_levels_for_layer(layer_type: str, requested_levels: Iterable[int]) -> list[int]:
    """返回图层实际需要生成的瓦片缩放级别。"""
    if layer_type not in MULTI_Z_LAYER_TYPES:
        return [0]

    requested = {int(level) for level in requested_levels}
    return [level for level in TILE_SCHEME["levels"] if int(level) in requested]


def generated_tile_count(bounds: Bounds, z: int) -> list[int]:
    tiles = iter_tiles(bounds, [z])
    if not tiles:
        return [0, 0]
    return [len({tile.x for tile in tiles}), len({tile.y for tile in tiles})]


def layer_output_path(
    output_root: Path,
    init_time: str,
    fc_hour: str,
    level: str | int,
    layer_type: str,
    tile: Tile,
) -> Path:
    """构造单个 SVG 瓦片的稳定输出路径。"""
    return output_root / init_time / fc_hour / str(level) / layer_type / str(tile.z) / str(tile.x) / f"{tile.y}.svg"
