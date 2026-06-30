"""Warm-core identification for TDS-based vortex centers."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

import numpy as np

from vortex_common import (
    DEFAULT_AREA,
    DEFAULT_FC_HOURS,
    DEFAULT_SOURCE,
    DEFAULT_WARM_LEVELS,
    VortexDataError,
    calLatestBaseTime,
    center_json_path,
    format_fc_hour,
    haversine_distance,
    json_safe_float,
    normalize_fc_hours,
    read_json,
    read_temperature_fields,
    warm_json_path,
    write_json,
)


def find_max_temp_in_region(temp_mean, center_lat: float, center_lon: float, radius_deg: float = 5.0):
    """Return max temperature and its location in a degree-radius box."""
    temp_region = temp_mean.sel(
        lat=slice(center_lat - radius_deg, center_lat + radius_deg),
        lon=slice(center_lon - radius_deg, center_lon + radius_deg),
    )
    if temp_region.size == 0:
        return None, None, None

    values = np.asarray(temp_region.values, dtype=float)
    if values.size == 0 or np.all(np.isnan(values)):
        return None, None, None

    max_indices = np.unravel_index(int(np.nanargmax(values)), values.shape)
    max_temp = float(values[max_indices])
    max_lat = float(temp_region.lat.values[max_indices[0]])
    max_lon = float(temp_region.lon.values[max_indices[1]])
    return max_temp, max_lat, max_lon


def get_temperature_at_point(temp_mean, lat: float, lon: float) -> float | None:
    """Return nearest temperature at one point."""
    try:
        return json_safe_float(temp_mean.sel(lat=lat, lon=lon, method="nearest"))
    except Exception:
        return None


def evaluate_warm_core(center: dict, temp_mean) -> dict:
    """Add warm-core diagnostics to one center record."""
    result = dict(center)
    center_lat = float(center["lat"])
    center_lon = float(center["lon"])

    max_temp, max_lat, max_lon = find_max_temp_in_region(temp_mean, center_lat, center_lon, radius_deg=5.0)
    distance_to_max = None
    warm_core = False
    if max_temp is not None:
        distance_to_max = haversine_distance(center_lat, center_lon, max_lat, max_lon)
        warm_core = distance_to_max < 220.0

    center_temp = get_temperature_at_point(temp_mean, center_lat, center_lon)
    temp_north = get_temperature_at_point(temp_mean, center_lat + 8.0, center_lon)
    temp_south = get_temperature_at_point(temp_mean, center_lat - 8.0, center_lon)
    temp_east = get_temperature_at_point(temp_mean, center_lat, center_lon + 8.0)
    temp_west = get_temperature_at_point(temp_mean, center_lat, center_lon - 8.0)
    surrounding_temps = [temp_north, temp_south, temp_east, temp_west]
    warm_slope = (
        center_temp is not None
        and all(temp is not None for temp in surrounding_temps)
        and all(center_temp > temp for temp in surrounding_temps if temp is not None)
    )

    result.update(
        {
            "warm": bool(warm_core and warm_slope),
            "warm_core": bool(warm_core),
            "warm_slope": bool(warm_slope),
            "max_temp": json_safe_float(max_temp),
            "max_temp_lat": json_safe_float(max_lat),
            "max_temp_lon": json_safe_float(max_lon),
            "distance_to_max": json_safe_float(distance_to_max),
            "center_temp": json_safe_float(center_temp),
            "temp_north": json_safe_float(temp_north),
            "temp_south": json_safe_float(temp_south),
            "temp_east": json_safe_float(temp_east),
            "temp_west": json_safe_float(temp_west),
        }
    )
    return result


def process_warm_core_hour(
    init_time: str,
    fc_hour: int | str,
    area: list[float],
    source: str,
    output_root: str | Path,
    warm_levels: Iterable[int],
) -> dict:
    """Process one forecast hour of 850 hPa centers."""
    fc_str = format_fc_hour(fc_hour)
    input_path = center_json_path(output_root, init_time, fc_str, 850)
    output_path = warm_json_path(output_root, init_time, fc_str)
    centers = read_json(input_path)

    if not centers:
        write_json(output_path, [])
        return {
            "init_time": init_time,
            "fc_hour": fc_str,
            "center_count": 0,
            "warm_count": 0,
            "input_path": str(input_path),
            "json_path": str(output_path),
            "status": "completed",
            "generated": True,
            "generated_files": [str(output_path)],
        }

    temp_fields = read_temperature_fields(
        init_time=init_time,
        fc_hour=fc_str,
        levels=warm_levels,
        area=area,
        source=source,
    )
    temp_mean = sum(temp_fields) / float(len(temp_fields))
    enriched = [evaluate_warm_core(center, temp_mean) for center in centers]
    write_json(output_path, enriched)
    return {
        "init_time": init_time,
        "fc_hour": fc_str,
        "center_count": len(enriched),
        "warm_count": sum(1 for center in enriched if center.get("warm")),
        "input_path": str(input_path),
        "json_path": str(output_path),
        "status": "completed",
        "generated": True,
        "generated_files": [str(output_path)],
    }


def run_warm_core_identification(
    init_time: str | None = None,
    fc_hours: Iterable[int | str] | None = None,
    area: list[float] | None = None,
    source: str = DEFAULT_SOURCE,
    output_root: str | Path = "data",
    warm_levels: Iterable[int] = DEFAULT_WARM_LEVELS,
    show_progress: bool = True,
) -> list[dict]:
    """Run warm-core identification for several forecast hours."""
    if init_time is None:
        init_time = calLatestBaseTime()
    fc_hours = normalize_fc_hours(fc_hours)
    area = [float(value) for value in (area or DEFAULT_AREA)]
    warm_levels = [int(level) for level in warm_levels]

    summary = []
    for index, fc_str in enumerate(fc_hours, start=1):
        if show_progress:
            print(f"[{index}/{len(fc_hours)}] warm-core init={init_time} fc={fc_str}")
        try:
            summary.append(
                process_warm_core_hour(
                    init_time=init_time,
                    fc_hour=fc_str,
                    area=area,
                    source=source,
                    output_root=output_root,
                    warm_levels=warm_levels,
                )
            )
        except FileNotFoundError as exc:
            summary.append(
                {
                    "init_time": init_time,
                    "fc_hour": fc_str,
                    "center_count": 0,
                    "warm_count": 0,
                    "input_path": str(center_json_path(output_root, init_time, fc_str, 850)),
                    "json_path": None,
                    "status": "missing_center",
                    "error": str(exc),
                    "generated": False,
                    "generated_files": [],
                }
            )
            if show_progress:
                print(f"  missing center JSON: {exc}")
            return summary
        except VortexDataError as exc:
            summary.append(
                {
                    "init_time": init_time,
                    "fc_hour": fc_str,
                    "center_count": 0,
                    "warm_count": 0,
                    "input_path": str(center_json_path(output_root, init_time, fc_str, 850)),
                    "json_path": None,
                    "status": "aborted",
                    "error": str(exc),
                    "generated": False,
                    "generated_files": [],
                }
            )
            if show_progress:
                print(f"  aborted: {exc}")
            return summary
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Identify warm-core vortices from 850 hPa center JSON files.")
    parser.add_argument("--init-time", default=None, help="Initialization time, YYYYMMDDHH. Defaults to latest ECMWF base time.")
    parser.add_argument("--fc-hours", nargs="+", default=DEFAULT_FC_HOURS)
    parser.add_argument("--area", nargs=4, type=float, default=DEFAULT_AREA, metavar=("W", "E", "S", "N"))
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output-root", default="data")
    parser.add_argument("--warm-levels", nargs="+", type=int, default=DEFAULT_WARM_LEVELS)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_warm_core_identification(
        init_time=args.init_time,
        fc_hours=args.fc_hours,
        area=args.area,
        source=args.source,
        output_root=args.output_root,
        warm_levels=args.warm_levels,
    )


if __name__ == "__main__":
    main()
