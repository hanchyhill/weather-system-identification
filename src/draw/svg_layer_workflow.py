"""SVG 图层产品生成与并发调度。"""

from __future__ import annotations

import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Iterable

import xarray as xr

from draw.svg_layer_config import style_for
from draw.svg_layer_data import (
    DatasetCache,
    accumulated_precipitation,
    accumulation_start_hour,
    default_path,
    open_data_array,
)
from draw.svg_layer_geometry import Bounds, Tile, iter_tiles, layer_output_path, tile_levels_for_layer
from draw.svg_layer_manifest import (
    add_manifest_record,
    all_tiles_exist,
    log_product_result,
    maybe_log_tile_result,
    product_tile_record,
    tile_results_with_status,
    write_manifest,
)
from draw.svg_layer_rendering import (
    preprocess_surface_layer,
    preprocess_upper_air_layer,
    render_surface_tile,
    render_upper_air_tile,
)


# 暂时只输出风向杆：保留箭头和流线图的渲染实现，恢复时将它们重新加入列表即可。
HIGH_LAYER_TYPES = ("hght_contour", "wind_barb", "wind_speed_fill", "temp_contour", "vort_fill", "rhum_fill")
SURFACE_LAYER_TYPES = (
    "surface_barb",
    "surface_speed_fill",
    "mslp_contour",
    "rain_24h_fill",
    "rain_6h_fill",
    "rain_3h_fill",
)
PRECIPITATION_LAYER_HOURS = {
    "rain_24h_fill": 24,
    "rain_6h_fill": 6,
    "rain_3h_fill": 3,
}


def layer_style(args, layer_type: str, level: int | None, z: int) -> dict[str, object]:
    style = style_for(layer_type, level, z)
    style.setdefault("skip", args.skip)
    style.setdefault("sigma", args.sigma)
    return style


def tile_output_paths(output_root: Path, init_time: str, fc_hour: str, level: str | int, layer_type: str, tiles: Iterable[Tile]) -> list[tuple[Tile, Path]]:
    return [(tile, layer_output_path(output_root, init_time, fc_hour, level, layer_type, tile)) for tile in tiles]


def _append_product_record(args, fc_hour: str, level: str | int, layer_type: str, output_root: Path, bounds: Bounds, tile_results: list[tuple[Tile, Path, str, str | None]], timings: dict[str, float], records: list[dict[str, object]], manifest: dict[str, object] | None) -> None:
    record = product_tile_record(args.init_time, fc_hour, level, layer_type, output_root, bounds, tile_results, timings)
    records.append(record)
    if manifest is not None:
        add_manifest_record(manifest, record)


def _generate_layers(args, fc_hour: str, level: str | int, bounds: Bounds, layer_types: Iterable[str], load_fields, preprocess, render, manifest: dict[str, object] | None, cache: DatasetCache | None) -> list[dict[str, object]]:
    output_root = Path(args.output)
    records: list[dict[str, object]] = []
    loaded_wind: tuple[xr.DataArray, xr.DataArray] | None = None
    preprocessed_cache: dict[tuple[object, ...], object] = {}
    for layer_type in layer_types:
        product_start = time.perf_counter()
        timings = {"data_load_s": 0.0, "preprocess_s": 0.0, "render_s": 0.0}
        layer_tile_levels = tile_levels_for_layer(layer_type, args.tile_levels)
        paths = tile_output_paths(output_root, args.init_time, fc_hour, level, layer_type, iter_tiles(bounds, layer_tile_levels))
        if args.skip_existing and all_tiles_exist(paths):
            results = tile_results_with_status(paths, "skipped")
            timings["total_s"] = time.perf_counter() - product_start
            log_product_result(fc_hour, level, layer_type, results, timings)
            _append_product_record(args, fc_hour, level, layer_type, output_root, bounds, results, timings, records, manifest)
            continue
        fields: dict[str, xr.DataArray | tuple[xr.DataArray, xr.DataArray]] = {}
        results: list[tuple[Tile, Path, str, str | None]] = []
        try:
            data_start = time.perf_counter()
            fields, loaded_wind = load_fields(layer_type, loaded_wind)
            timings["data_load_s"] = time.perf_counter() - data_start
            preprocess_start = time.perf_counter()
            fields = preprocess(layer_type, layer_style(args, layer_type, level if isinstance(level, int) else None, min(layer_tile_levels)), fields, preprocessed_cache)
            timings["preprocess_s"] = time.perf_counter() - preprocess_start
        except Exception as exc:
            error = str(exc)
            results = tile_results_with_status(paths, "failed", error)
            for tile, output_path, _, _ in results:
                maybe_log_tile_result(args, fc_hour, level, layer_type, "failed", output_path, error, tile)
        if fields:
            render_start = time.perf_counter()
            for tile, output_path in paths:
                if args.skip_existing and output_path.exists():
                    results.append((tile, output_path, "skipped", None))
                    maybe_log_tile_result(args, fc_hour, level, layer_type, "skipped", output_path, tile=tile)
                    continue
                try:
                    render(layer_type, tile, output_path, layer_style(args, layer_type, level if isinstance(level, int) else None, tile.z), fields)
                except Exception as exc:
                    error = str(exc)
                    results.append((tile, output_path, "failed", error))
                    maybe_log_tile_result(args, fc_hour, level, layer_type, "failed", output_path, error, tile)
                else:
                    results.append((tile, output_path, "generated", None))
                    maybe_log_tile_result(args, fc_hour, level, layer_type, "generated", output_path, tile=tile)
            timings["render_s"] = time.perf_counter() - render_start
        timings["total_s"] = time.perf_counter() - product_start
        log_product_result(fc_hour, level, layer_type, results, timings)
        _append_product_record(args, fc_hour, level, layer_type, output_root, bounds, results, timings, records, manifest)
    return records


def generate_upper_air_layers(args, fc_hour: str, level: int, bounds: Bounds, manifest: dict[str, object] | None = None, cache: DatasetCache | None = None) -> list[dict[str, object]]:
    common = {"init_time": args.init_time, "level": level, "bounds": bounds, "cache": cache}
    sources = {
        "wind": ((args.uwnd_path, "uwnd.nc", args.uwnd_var, ("uwnd", "u")), (args.vwnd_path, "vwnd.nc", args.vwnd_var, ("vwnd", "v"))),
        "hght": (args.hght_path, "hght.nc", args.hght_var, ("hght", "z")),
        "temp": (args.temp_path, "temp.nc", args.temp_var, ("temp", "t")),
        "vort": (args.vort_path, "vort.nc", args.vort_var, ("vort", "vo")),
        "rhum": (args.rhum_path, "rhum.nc", args.rhum_var, ("rhum", "r")),
    }
    def read(source):
        explicit_path, filename, variable_template, fallbacks = source
        candidates = [variable_template.format(fc_hour=fc_hour), *(f"{name}{fc_hour}" for name in fallbacks), *fallbacks]
        return open_data_array(default_path(explicit_path, args.init_time, args.source, filename, args.base_url_template), candidates, **common)
    def load(layer_type, wind):
        if layer_type == "hght_contour": return {"hght": read(sources["hght"])}, wind
        if layer_type == "temp_contour": return {"temp": read(sources["temp"])}, wind
        if layer_type == "vort_fill": return {"vort": read(sources["vort"])}, wind
        if layer_type == "rhum_fill": return {"rhum": read(sources["rhum"])}, wind
        wind = wind or (read(sources["wind"][0]), read(sources["wind"][1]))
        return {"wind": wind}, wind
    return _generate_layers(args, fc_hour, level, bounds, HIGH_LAYER_TYPES, load, lambda kind, style, fields, memo: preprocess_upper_air_layer(kind, level, style, fields, memo), lambda kind, tile, path, style, fields: render_upper_air_tile(kind, level, tile, path, args.dpi, style, fields), manifest, cache)


def generate_surface_layers(args, fc_hour: str, bounds: Bounds, manifest: dict[str, object] | None = None, cache: DatasetCache | None = None) -> list[dict[str, object]]:
    common = {"init_time": args.init_time, "level": None, "bounds": bounds, "cache": cache}
    def read(path, filename, template, candidates, source_fc_hour: str = fc_hour):
        variable_candidates = [template.format(fc_hour=source_fc_hour), *(f"{name}{source_fc_hour}" for name in candidates), *candidates]
        return open_data_array(default_path(path, args.init_time, args.source, filename, args.base_url_template), variable_candidates, **common)
    def load(layer_type, wind):
        if layer_type == "mslp_contour":
            return {"mslp": read(args.mslp_path, "mslp.nc", args.mslp_var, ("mslp", "msl"))}, wind
        accumulation_hours = PRECIPITATION_LAYER_HOURS.get(layer_type)
        if accumulation_hours is not None:
            start_fc_hour = accumulation_start_hour(fc_hour, accumulation_hours)
            if start_fc_hour is None:
                raise ValueError(f"No valid {accumulation_hours}-hour precipitation window for fc_hour={fc_hour}")
            end_accumulation = read(args.tppm_path, "tppm.nc", args.tppm_var, ("tppm",))
            start_accumulation = read(args.tppm_path, "tppm.nc", args.tppm_var, ("tppm",), start_fc_hour)
            return {"precipitation": accumulated_precipitation(end_accumulation, start_accumulation)}, wind
        wind = wind or (read(args.u10_path, "u10m.nc", args.u10_var, ("u10m", "u10", "10u", "u")), read(args.v10_path, "v10m.nc", args.v10_var, ("v10m", "v10", "10v", "v")))
        return {"wind": wind}, wind
    available_layer_types = tuple(
        layer_type
        for layer_type in SURFACE_LAYER_TYPES
        if layer_type not in PRECIPITATION_LAYER_HOURS
        or accumulation_start_hour(fc_hour, PRECIPITATION_LAYER_HOURS[layer_type]) is not None
    )
    return _generate_layers(args, fc_hour, "surface", bounds, available_layer_types, load, preprocess_surface_layer, lambda kind, tile, path, style, fields: render_surface_tile(kind, tile, path, args.dpi, style, fields), manifest, cache)


def default_worker_count() -> int:
    return max((os.cpu_count() or 1) - 2, 1)


def build_generation_jobs(args, fc_hours: list[str]) -> list[tuple[str, str, int | None]]:
    jobs = []
    for fc_hour in fc_hours:
        if args.schedule == "fc-hour": jobs.append(("fc_hour", fc_hour, None))
        else:
            if not args.surface_only: jobs.extend(("upper_air", fc_hour, level) for level in args.levels)
            if not args.upper_only: jobs.append(("surface", fc_hour, None))
    return jobs


def run_generation_job(args, bounds: Bounds, job: tuple[str, str, int | None]) -> dict[str, object]:
    started = time.perf_counter()
    layer_group, fc_hour, level = job
    cache = DatasetCache()
    try:
        if layer_group == "fc_hour":
            records = ([] if args.surface_only else [record for selected_level in args.levels for record in generate_upper_air_layers(args, fc_hour, selected_level, bounds, cache=cache)]) + ([] if args.upper_only else generate_surface_layers(args, fc_hour, bounds, cache=cache))
        elif layer_group == "upper_air": records = generate_upper_air_layers(args, fc_hour, level, bounds, cache=cache)
        elif layer_group == "surface": records = generate_surface_layers(args, fc_hour, bounds, cache=cache)
        else: raise ValueError(f"Unknown generation job type: {layer_group}")
        return {"job": {"type": layer_group, "fc_hour": fc_hour, "level": level}, "records": records, "total_s": time.perf_counter() - started}
    finally:
        cache.close()


def generation_stats_from_result(result: dict[str, object]) -> dict[str, object]:
    records = result.get("records", [])
    products = [{"fc_hour": record.get("fc_hour"), "level": record.get("level"), "layer_type": record.get("layer_type"), "status": record.get("status"), "timings": record.get("timings", {})} for record in records if isinstance(record, dict)] if isinstance(records, list) else []
    return {"job": result.get("job", {}), "total_s": result.get("total_s", 0.0), "products": products}


def run_generation_jobs(args, fc_hours: list[str], bounds: Bounds, manifest: dict[str, object]) -> list[dict[str, object]]:
    jobs = build_generation_jobs(args, fc_hours)
    if not jobs: return []
    workers = min(args.data_workers if args.data_workers is not None else args.workers, args.workers, len(jobs))
    stats = []
    def accept(result):
        for record in result["records"]: add_manifest_record(manifest, record)
        stats.append(generation_stats_from_result(result))
        if len(stats) % args.manifest_checkpoint_interval == 0: write_manifest(Path(args.output), args.init_time, manifest)
    if workers <= 1:
        for job in jobs: accept(run_generation_job(args, bounds, job))
        return stats
    print(f"Using parallel SVG generation workers: {workers}, schedule={args.schedule}", flush=True)
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(run_generation_job, args, bounds, job) for job in jobs]
        for future in as_completed(futures): accept(future.result())
    return stats
