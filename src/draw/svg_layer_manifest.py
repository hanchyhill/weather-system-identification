"""SVG 产品清单的读写、补全与生成日志。"""

from __future__ import annotations

import json
import os
import time
from errno import EACCES, EBUSY
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from draw.svg_layer_config import TILE_SCHEME
from draw.svg_layer_geometry import Bounds, Tile, tile_bounds, tile_levels_for_layer, tile_scheme_manifest


def product_record(init_time: str, fc_hour: str, level: str | int, layer_type: str, path: Path, output_root: Path, bounds: Bounds, status: str = "generated", error: str | None = None) -> dict[str, object]:
    init_root = output_root / init_time
    try:
        relative_path = path.relative_to(init_root).as_posix()
    except ValueError:
        relative_path = path.as_posix()
    record: dict[str, object] = {"init_time": init_time, "fc_hour": fc_hour, "level": level, "layer_type": layer_type, "path": relative_path, "bounds": bounds.as_dict(), "projection": "PlateCarree", "status": status}
    if error:
        record["error"] = error
    return record


def product_tile_record(init_time: str, fc_hour: str, level: str | int, layer_type: str, output_root: Path, bounds: Bounds, tiles: Iterable[tuple[Tile, Path, str, str | None]], timings: dict[str, float] | None = None) -> dict[str, object]:
    init_root = output_root / init_time
    tiles_by_z: dict[str, list[dict[str, object]]] = {}
    status_set: set[str] = set()
    errors: list[str] = []
    for tile, path, status, error in tiles:
        status_set.add(status)
        if error:
            errors.append(f"z={tile.z},x={tile.x},y={tile.y}: {error}")
        tiles_by_z.setdefault(str(tile.z), []).append(tile.as_dict(path, init_root, status, error))
    for records in tiles_by_z.values():
        records.sort(key=lambda item: (int(item["y"]), int(item["x"])))
    status = "failed" if "failed" in status_set else "skipped" if status_set == {"skipped"} else "generated" if "generated" in status_set else "missing"
    record: dict[str, object] = {"init_time": init_time, "fc_hour": fc_hour, "level": level, "layer_type": layer_type, "bounds": bounds.as_dict(), "projection": "PlateCarree", "status": status, "tiles": dict(sorted(tiles_by_z.items(), key=lambda item: int(item[0]))), "available_tile_levels": sorted(int(z) for z in tiles_by_z)}
    if errors:
        record["error"] = "; ".join(errors[:3])
    if timings:
        record["timings"] = timings
    return record


def ensure_manifest_shape(init_time: str, bounds: Bounds, high_layer_types: Iterable[str], surface_layer_types: Iterable[str]) -> dict[str, object]:
    return {"init_time": init_time, "generated_at": datetime.now(timezone.utc).isoformat(), "bounds": bounds.as_dict(), "projection": "PlateCarree", "tile_scheme": tile_scheme_manifest(bounds, TILE_SCHEME["levels"]), "fc_hours": [], "levels": [], "layer_types": {"upper_air": list(high_layer_types), "surface": list(surface_layer_types)}, "products": {}}


def rebuild_manifest_indexes(manifest: dict[str, object]) -> None:
    if not isinstance(manifest.get("fc_hours"), list):
        manifest["fc_hours"] = []
    if not isinstance(manifest.get("levels"), list):
        manifest["levels"] = []
    if not isinstance(manifest.get("products"), dict):
        manifest["products"] = {}
    fc_hour_set = {str(item) for item in manifest["fc_hours"]}
    level_set = {str(item) for item in manifest["levels"]}
    for fc_hour, levels_by_hour in manifest["products"].items():
        fc_hour_set.add(str(fc_hour))
        if isinstance(levels_by_hour, dict):
            level_set.update(str(level) for level in levels_by_hour)
    manifest["fc_hours"] = list(fc_hour_set)
    manifest["levels"] = list(level_set)


def load_manifest(output_root: Path, init_time: str, bounds: Bounds, high_layer_types: Iterable[str], surface_layer_types: Iterable[str]) -> dict[str, object]:
    manifest = ensure_manifest_shape(init_time, bounds, high_layer_types, surface_layer_types)
    manifest_path = output_root / init_time / "manifest.json"
    if not manifest_path.exists():
        return manifest
    try:
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Could not read existing manifest, starting fresh: {manifest_path}, error={exc}")
        return manifest
    if not isinstance(existing, dict):
        print(f"Existing manifest is not a JSON object, starting fresh: {manifest_path}")
        return manifest
    manifest.update(existing)
    manifest.update({"init_time": init_time, "bounds": bounds.as_dict(), "projection": "PlateCarree", "tile_scheme": tile_scheme_manifest(bounds, TILE_SCHEME["levels"])})
    if not isinstance(manifest.get("layer_types"), dict):
        manifest["layer_types"] = {}
    manifest["layer_types"].setdefault("upper_air", list(high_layer_types))
    manifest["layer_types"].setdefault("surface", list(surface_layer_types))
    normalize_manifest_tile_levels(manifest)
    rebuild_manifest_indexes(manifest)
    return manifest


def add_manifest_record(manifest: dict[str, object], record: dict[str, object]) -> None:
    normalize_record_tile_levels(record)
    fc_hour, level, layer_type = str(record["fc_hour"]), str(record["level"]), str(record["layer_type"])
    manifest["products"].setdefault(fc_hour, {}).setdefault(level, {})[layer_type] = record
    if fc_hour not in manifest["fc_hours"]:
        manifest["fc_hours"].append(fc_hour)
    if level not in manifest["levels"]:
        manifest["levels"].append(level)


def manifest_has_record(manifest: dict[str, object], fc_hour: str, level: str, layer_type: str) -> bool:
    products = manifest.get("products")
    if not isinstance(products, dict):
        return False
    levels = products.get(fc_hour)
    return isinstance(levels, dict) and isinstance(levels.get(level), dict) and layer_type in levels[level]


def normalize_record_tile_levels(record: dict[str, object]) -> None:
    tiles = record.get("tiles")
    if not isinstance(tiles, dict):
        return
    allowed = {str(level) for level in tile_levels_for_layer(str(record.get("layer_type", "")), TILE_SCHEME["levels"])}
    record["tiles"] = {str(z): values for z, values in tiles.items() if str(z) in allowed and isinstance(values, list)}
    record["available_tile_levels"] = sorted(int(z) for z in record["tiles"])


def normalize_manifest_tile_levels(manifest: dict[str, object]) -> None:
    products = manifest.get("products")
    if not isinstance(products, dict):
        return
    for levels_by_hour in products.values():
        if not isinstance(levels_by_hour, dict):
            continue
        for layers_by_level in levels_by_hour.values():
            if isinstance(layers_by_level, dict):
                for record in layers_by_level.values():
                    if isinstance(record, dict):
                        normalize_record_tile_levels(record)


def backfill_manifest_from_existing_svgs(output_root: Path, init_time: str, bounds: Bounds, manifest: dict[str, object]) -> int:
    init_root = output_root / init_time
    if not init_root.exists():
        return 0
    backfilled = 0
    for svg_path in init_root.glob("*/*/*.svg"):
        parts = svg_path.relative_to(init_root).parts
        if len(parts) != 3:
            continue
        fc_hour, level, filename = parts
        layer_type = Path(filename).stem
        if not manifest_has_record(manifest, fc_hour, level, layer_type):
            add_manifest_record(manifest, product_record(init_time, fc_hour, level, layer_type, svg_path, output_root, bounds))
            backfilled += 1
    tile_paths: dict[tuple[str, str, str], list[tuple[Tile, Path, str, str | None]]] = {}
    for svg_path in init_root.glob("*/*/*/*/*/*.svg"):
        parts = svg_path.relative_to(init_root).parts
        if len(parts) != 6:
            continue
        fc_hour, level, layer_type, z_value, x_value, filename = parts
        try:
            z, x, y = int(z_value), int(x_value), int(Path(filename).stem)
        except ValueError:
            continue
        if z not in tile_levels_for_layer(layer_type, TILE_SCHEME["levels"]) or manifest_has_record(manifest, fc_hour, level, layer_type):
            continue
        tile_paths.setdefault((fc_hour, level, layer_type), []).append((Tile(z, x, y, tile_bounds(z, x, y)), svg_path, "generated", None))
    for (fc_hour, level, layer_type), records in tile_paths.items():
        add_manifest_record(manifest, product_tile_record(init_time, fc_hour, level, layer_type, output_root, bounds, records))
        backfilled += 1
    return backfilled


_REPLACE_RETRY_DELAYS_SECONDS = (0.05, 0.1, 0.2, 0.4, 0.8, 1.6)


def _replace_with_retry(temporary_path: Path, path: Path) -> None:
    """替换可能被 Windows 短暂占用的产品文件。"""
    for delay in (*_REPLACE_RETRY_DELAYS_SECONDS, None):
        try:
            os.replace(temporary_path, path)
            return
        except OSError as exc:
            if exc.errno not in (EACCES, EBUSY) or delay is None:
                raise
            time.sleep(delay)


def write_json_atomic(path: Path, payload: dict[str, object]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f"{path.name}.tmp.{os.getpid()}.{uuid4().hex}")
    serialized_payload = json.dumps(payload, ensure_ascii=False, indent=2)
    try:
        temporary_path.write_text(serialized_payload, encoding="utf-8")
        try:
            _replace_with_retry(temporary_path, path)
        except PermissionError:
            if os.name != "nt":
                raise
            # Windows 读取方可能允许写入、但未允许删除共享，导致 os.replace
            # 即使重试后仍被拒绝。此时宁可原位更新，也不能让整批生成失败。
            print(f"JSON output remained locked after atomic replace retries; writing in place: {path}", flush=True)
            path.write_text(serialized_payload, encoding="utf-8")
    finally:
        # replace 成功后临时文件已不存在；失败时不遗留中间文件。
        temporary_path.unlink(missing_ok=True)
    return path


def write_manifest(output_root: Path, init_time: str, manifest: dict[str, object]) -> Path:
    rebuild_manifest_indexes(manifest)
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat()
    manifest["fc_hours"] = sorted(manifest["fc_hours"])
    manifest["levels"] = sorted(manifest["levels"], key=lambda item: (item == "surface", str(item)))
    return write_json_atomic(output_root / init_time / "manifest.json", manifest)


def write_generation_stats(output_root: Path, init_time: str, stats: list[dict[str, object]]) -> Path:
    return write_json_atomic(output_root / init_time / "generation_stats.json", {"init_time": init_time, "generated_at": datetime.now(timezone.utc).isoformat(), "jobs": stats})


def log_layer_result(fc_hour: str, level: str | int, layer_type: str, status: str, output_path: Path, error: str | None = None, tile: Tile | None = None) -> None:
    context = f"fc_hour={fc_hour}, level={level}, layer={layer_type}"
    if tile is not None:
        context += f", z={tile.z}, x={tile.x}, y={tile.y}"
    if status == "generated": print(f"  Completed SVG: {context}, path={output_path}")
    elif status == "skipped": print(f"  Skipped existing SVG: {context}, path={output_path}")
    elif error: print(f"  Failed SVG: {context}, error={error}")
    else: print(f"  {status.capitalize()} SVG: {context}, path={output_path}")


def all_tiles_exist(paths: Iterable[tuple[Tile, Path]]) -> bool:
    path_list = list(paths)
    return bool(path_list) and all(path.exists() for _, path in path_list)


def tile_results_with_status(paths: Iterable[tuple[Tile, Path]], status: str, error: str | None = None) -> list[tuple[Tile, Path, str, str | None]]:
    return [(tile, path, status, error) for tile, path in paths]


def log_product_result(fc_hour: str, level: str | int, layer_type: str, tile_results: list[tuple[Tile, Path, str, str | None]], timings: dict[str, float]) -> None:
    counts = {status: 0 for status in ("generated", "skipped", "failed", "missing")}
    for _, _, status, _ in tile_results:
        counts[status] = counts.get(status, 0) + 1
    print(f"  Layer fc_hour={fc_hour}, level={level}, layer={layer_type}: generated={counts['generated']}, skipped={counts['skipped']}, failed={counts['failed']}, data={timings.get('data_load_s', 0.0):.2f}s, preprocess={timings.get('preprocess_s', 0.0):.2f}s, render={timings.get('render_s', 0.0):.2f}s, total={timings.get('total_s', 0.0):.2f}s", flush=True)


def maybe_log_tile_result(args, fc_hour: str, level: str | int, layer_type: str, status: str, output_path: Path, error: str | None = None, tile: Tile | None = None) -> None:
    if getattr(args, "verbose_tiles", False):
        log_layer_result(fc_hour, level, layer_type, status, output_path, error, tile)
