"""Vortex center identification from TDS wind fields."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.spatial import cKDTree
from sklearn.cluster import DBSCAN

from vortex_common import (
    DEFAULT_AREA,
    DEFAULT_FC_HOURS,
    DEFAULT_LEVELS,
    DEFAULT_SOURCE,
    VortexDataError,
    calLatestBaseTime,
    center_dir,
    center_json_path,
    forecast_time,
    format_datetime,
    format_fc_hour,
    haversine_distance,
    json_safe_float,
    normalize_fc_hours,
    read_surface_wind_pair,
    read_wind_pair,
    write_json,
)


VORTICITY_THRESHOLD = 3.5e-5


def smooth_wind_field(data, smooth_threshold: float = 1.0):
    """Apply a rolling mean similar to the IFS workflow."""
    if smooth_threshold <= 0:
        return data
    lon_unit = float(abs(data.lon.values[1] - data.lon.values[0]))
    window_size = max(1, int(smooth_threshold / lon_unit) + 1)
    return data.rolling(lat=window_size, lon=window_size, center=True).mean()


def find_shear_points(uwnd, vwnd) -> tuple[np.ndarray, np.ndarray]:
    """Find u and v wind sign-change shear points."""
    latitude = uwnd.lat.values
    longitude = uwnd.lon.values
    grid_unit = float(abs(latitude[1] - latitude[0]))
    u_values = np.asarray(uwnd.values)
    v_values = np.asarray(vwnd.values)

    sign_change_u = np.diff(np.sign(u_values), axis=0)
    shear_u_index = np.where(sign_change_u < 0)
    shear_u = np.vstack(
        [
            latitude[shear_u_index[0]] + grid_unit / 2.0,
            longitude[shear_u_index[1]],
        ]
    ).T

    sign_change_v = np.diff(np.sign(v_values), axis=1)
    shear_v_index = np.where(sign_change_v > 0)
    shear_v = np.vstack(
        [
            latitude[shear_v_index[0]],
            longitude[shear_v_index[1]] + grid_unit / 2.0,
        ]
    ).T

    return shear_u, shear_v


def calculate_vorticity(uwnd, vwnd) -> np.ndarray:
    """Calculate relative vorticity in s^-1 using spherical grid spacing."""
    lat = np.asarray(uwnd.lat.values, dtype=float)
    lon = np.asarray(uwnd.lon.values, dtype=float)
    u = np.nan_to_num(np.asarray(uwnd.values, dtype=float), nan=0.0)
    v = np.nan_to_num(np.asarray(vwnd.values, dtype=float), nan=0.0)

    earth_radius_m = 6371000.0
    lat_rad = np.deg2rad(lat)
    dy = np.gradient(lat_rad) * earth_radius_m
    dx = np.gradient(np.deg2rad(lon))[None, :] * earth_radius_m * np.cos(lat_rad)[:, None]

    dv_dlon_index = np.gradient(v, axis=1)
    du_dlat_index = np.gradient(u, axis=0)
    dvdx = np.divide(dv_dlon_index, dx, out=np.zeros_like(v), where=np.abs(dx) > 0)
    dudy = np.divide(du_dlat_index, dy[:, None], out=np.zeros_like(u), where=np.abs(dy[:, None]) > 0)
    return dvdx - dudy


def _nearest_field_value(field: np.ndarray, lat_values: np.ndarray, lon_values: np.ndarray, lat: float, lon: float) -> float:
    lat_idx = int(np.abs(lat_values - lat).argmin())
    lon_idx = int(np.abs(lon_values - lon).argmin())
    return float(field[lat_idx, lon_idx])


def filter_vortex_centers(
    shear_u: np.ndarray,
    shear_v: np.ndarray,
    uwnd,
    vwnd,
    distance_threshold: float = 0.5,
    eps_factor: float = 2.0,
    min_samples: int = 2,
    vorticity_threshold: float = VORTICITY_THRESHOLD,
) -> np.ndarray:
    """Cluster wind-shear intersections and filter them by positive vorticity."""
    if len(shear_u) == 0 or len(shear_v) == 0:
        return np.empty((0, 3))

    tree = cKDTree(shear_v)
    pair_midpoints = []
    for point in shear_u:
        neighbor_indices = tree.query_ball_point(point, r=distance_threshold)
        for neighbor_index in neighbor_indices:
            pair_midpoints.append((point + shear_v[neighbor_index]) / 2.0)

    if not pair_midpoints:
        return np.empty((0, 3))

    center_positions = np.asarray(pair_midpoints)
    grid_unit = float(abs(uwnd.lat.values[1] - uwnd.lat.values[0]))
    clustering = DBSCAN(eps=grid_unit * eps_factor, min_samples=min_samples).fit(center_positions)
    labels = sorted(label for label in set(clustering.labels_) if label != -1)
    if not labels:
        return np.empty((0, 3))

    average_positions = np.asarray(
        [center_positions[clustering.labels_ == label].mean(axis=0) for label in labels]
    )
    vorticity = calculate_vorticity(uwnd, vwnd)
    lat_values = np.asarray(uwnd.lat.values)
    lon_values = np.asarray(uwnd.lon.values)

    centers = []
    for lat, lon in average_positions:
        vort = _nearest_field_value(vorticity, lat_values, lon_values, lat, lon)
        if vort > vorticity_threshold:
            centers.append([float(lat), float(lon), float(vort)])
    if not centers:
        return np.empty((0, 3))
    return np.asarray(centers)


def detect_vortex_centers(uwnd, vwnd, smooth_threshold: float = 1.0) -> np.ndarray:
    """Run the center-detection algorithm for one wind field."""
    uwnd = smooth_wind_field(uwnd, smooth_threshold=smooth_threshold)
    vwnd = smooth_wind_field(vwnd, smooth_threshold=smooth_threshold)
    shear_u, shear_v = find_shear_points(uwnd, vwnd)
    return filter_vortex_centers(shear_u, shear_v, uwnd, vwnd)


def get_max_wind_speed(center: np.ndarray, uwnd, vwnd, max_distance_km: float = 100.0) -> tuple[float | None, float | None, float | None]:
    """Find the maximum wind speed around a center within a great-circle radius."""
    center_lat, center_lon = float(center[0]), float(center[1])
    max_distance_deg = max_distance_km / 111.0
    target_u = uwnd.sel(
        lat=slice(center_lat - max_distance_deg, center_lat + max_distance_deg),
        lon=slice(center_lon - max_distance_deg, center_lon + max_distance_deg),
    )
    target_v = vwnd.sel(
        lat=slice(center_lat - max_distance_deg, center_lat + max_distance_deg),
        lon=slice(center_lon - max_distance_deg, center_lon + max_distance_deg),
    )
    if target_u.size == 0 or target_v.size == 0:
        return None, None, None

    speed = np.sqrt(np.asarray(target_u.values) ** 2 + np.asarray(target_v.values) ** 2)
    lat_values = np.asarray(target_u.lat.values)
    lon_values = np.asarray(target_u.lon.values)
    distance_mask = np.asarray(
        [
            [haversine_distance(center_lat, center_lon, lat, lon) <= max_distance_km for lon in lon_values]
            for lat in lat_values
        ]
    )
    masked_speed = np.where(distance_mask, speed, np.nan)
    if np.all(np.isnan(masked_speed)):
        return None, None, None

    max_indices = np.unravel_index(int(np.nanargmax(masked_speed)), masked_speed.shape)
    return (
        float(masked_speed[max_indices]),
        float(lat_values[max_indices[0]]),
        float(lon_values[max_indices[1]]),
    )


def adjust_with_surface_center(
    center: np.ndarray,
    surface_centers: np.ndarray,
    max_adjust_distance_km: float = 200.0,
) -> tuple[float, float, int, float | None]:
    """Move an 850 hPa center to the nearest 10m wind center within 200 km."""
    if len(surface_centers) == 0:
        return float(center[0]), float(center[1]), 0, None

    best_distance = float("inf")
    best_center = center
    for surface_center in surface_centers:
        distance = haversine_distance(center[0], center[1], surface_center[0], surface_center[1])
        if distance < best_distance:
            best_distance = distance
            best_center = surface_center

    if best_distance < max_adjust_distance_km:
        return float(best_center[0]), float(best_center[1]), 1, float(best_distance)
    return float(center[0]), float(center[1]), 0, float(best_distance)


def build_center_records(
    init_time: str,
    fc_hour: int | str,
    level: int,
    centers: np.ndarray,
    surface_centers: np.ndarray | None = None,
    u10m=None,
    v10m=None,
    source: str = DEFAULT_SOURCE,
) -> list[dict]:
    """Convert detected centers to output JSON records."""
    fc_str = format_fc_hour(fc_hour)
    init_dt = forecast_time(init_time, 0)
    fore_dt = forecast_time(init_time, fc_str)
    records = []

    for center in centers:
        output_center = center.copy()
        is_surface_center = 0
        surface_distance = None
        if level == 850 and surface_centers is not None:
            lat, lon, is_surface_center, surface_distance = adjust_with_surface_center(
                output_center, surface_centers
            )
            output_center[0] = lat
            output_center[1] = lon

        vmax, vmax_lat, vmax_lon = (None, None, None)
        if level == 850 and u10m is not None and v10m is not None:
            vmax, vmax_lat, vmax_lon = get_max_wind_speed(output_center, u10m, v10m, max_distance_km=100.0)

        records.append(
            {
                "model": source,
                "init_time": format_datetime(init_dt),
                "fore_time": format_datetime(fore_dt),
                "fc_hour": fc_str,
                "step": int(fc_str),
                "level": int(level),
                "lat": json_safe_float(output_center[0]),
                "lon": json_safe_float(output_center[1]),
                "vort": json_safe_float(output_center[2]),
                "vmax": json_safe_float(vmax),
                "vmax_lat": json_safe_float(vmax_lat),
                "vmax_lon": json_safe_float(vmax_lon),
                "is_surface_center": is_surface_center,
                "surface_center_distance": json_safe_float(surface_distance),
            }
        )

    return records


def plot_centers(uwnd, vwnd, records: list[dict], output_path: Path, title: str) -> None:
    """Save a simple wind and center map."""
    try:
        import cartopy.crs as ccrs
        import cartopy.feature as cfeature

        fig = plt.figure(figsize=(10, 8), dpi=150)
        ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
        ax.set_extent(
            [
                float(uwnd.lon.values[0]),
                float(uwnd.lon.values[-1]),
                float(uwnd.lat.values[0]),
                float(uwnd.lat.values[-1]),
            ],
            crs=ccrs.PlateCarree(),
        )
        ax.add_feature(cfeature.COASTLINE)
        ax.add_feature(cfeature.BORDERS)
        skip = max(1, len(uwnd.lat) // 25)
        ax.barbs(
            uwnd.lon.values[::skip],
            uwnd.lat.values[::skip],
            uwnd.values[::skip, ::skip],
            vwnd.values[::skip, ::skip],
            transform=ccrs.PlateCarree(),
            length=5,
        )
        if records:
            ax.scatter(
                [record["lon"] for record in records],
                [record["lat"] for record in records],
                c="red",
                s=32,
                marker="x",
                transform=ccrs.PlateCarree(),
                label="Vortex center",
            )
            ax.legend(loc="upper right")
        ax.gridlines(draw_labels=True)
        ax.set_title(title)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, bbox_inches="tight")
        plt.close(fig)
    except Exception:
        plt.close("all")
        raise


def process_one_level(
    init_time: str,
    fc_hour: int | str,
    level: int,
    area: list[float],
    source: str,
    output_root: str | Path,
    save_json: bool,
    save_image: bool,
    smooth_threshold: float,
    skip_existing: bool = True,
) -> dict:
    """Process one forecast hour and pressure level."""
    fc_str = format_fc_hour(fc_hour)
    json_path = center_json_path(output_root, init_time, fc_str, level)
    image_path = center_dir(output_root, init_time) / f"vortex_center_{init_time}_{fc_str}_{int(level)}hPa.png"
    if save_json and skip_existing and json_path.exists():
        return {
            "init_time": init_time,
            "fc_hour": fc_str,
            "level": int(level),
            "center_count": None,
            "json_path": str(json_path),
            "image_path": str(image_path) if save_image and image_path.exists() else None,
            "status": "skipped",
            "reason": "center JSON already exists",
            "generated": False,
            "skipped": True,
            "generated_files": [],
            "skipped_files": [str(json_path)],
        }

    uwnd, vwnd = read_wind_pair(init_time, fc_str, level, area, source=source)
    centers = detect_vortex_centers(uwnd, vwnd, smooth_threshold=smooth_threshold)

    surface_centers = None
    u10m = None
    v10m = None
    if level == 850:
        u10m, v10m = read_surface_wind_pair(init_time, fc_str, area, source=source)
        u10m = smooth_wind_field(u10m, smooth_threshold=smooth_threshold)
        v10m = smooth_wind_field(v10m, smooth_threshold=smooth_threshold)
        surface_centers = detect_vortex_centers(u10m, v10m, smooth_threshold=0)

    records = build_center_records(
        init_time=init_time,
        fc_hour=fc_str,
        level=level,
        centers=centers,
        surface_centers=surface_centers,
        u10m=u10m,
        v10m=v10m,
        source=source,
    )

    if save_json:
        write_json(json_path, records)
    if save_image:
        plot_centers(
            uwnd,
            vwnd,
            records,
            image_path,
            f"Vortex Centers - {init_time} +{fc_str}h {level}hPa",
        )
    return {
        "init_time": init_time,
        "fc_hour": fc_str,
        "level": int(level),
        "center_count": len(records),
        "json_path": str(json_path) if save_json else None,
        "image_path": str(image_path) if save_image else None,
        "status": "completed",
        "generated": bool(save_json),
        "skipped": False,
        "generated_files": [str(json_path)] if save_json else [],
        "skipped_files": [],
    }


def run_center_identification(
    init_time: str | None = None,
    fc_hours: Iterable[int | str] | None = None,
    levels: Iterable[int] | None = None,
    area: list[float] | None = None,
    source: str = DEFAULT_SOURCE,
    output_root: str | Path = "data",
    save_json: bool = True,
    save_image: bool = False,
    smooth_threshold: float = 1.0,
    show_progress: bool = True,
    skip_existing: bool = True,
) -> list[dict]:
    """Run center identification for many forecast hours and levels."""
    if init_time is None:
        init_time = calLatestBaseTime()
    fc_hours = normalize_fc_hours(fc_hours)
    levels = [int(level) for level in (levels or DEFAULT_LEVELS)]
    area = [float(value) for value in (area or DEFAULT_AREA)]

    summary = []
    total = len(fc_hours) * len(levels)
    task_index = 0
    for fc_str in fc_hours:
        for level in levels:
            task_index += 1
            if show_progress:
                print(f"[{task_index}/{total}] center init={init_time} fc={fc_str} level={level}")
            try:
                item = process_one_level(
                    init_time=init_time,
                    fc_hour=fc_str,
                    level=level,
                    area=area,
                    source=source,
                    output_root=output_root,
                    save_json=save_json,
                    save_image=save_image,
                    smooth_threshold=smooth_threshold,
                    skip_existing=skip_existing,
                )
                summary.append(item)
                if show_progress and item.get("status") == "skipped":
                    print(f"  skipped existing center JSON: {item.get('json_path')}")
            except VortexDataError as exc:
                item = {
                    "init_time": init_time,
                    "fc_hour": fc_str,
                    "level": level,
                    "center_count": 0,
                    "json_path": None,
                    "image_path": None,
                    "status": "aborted",
                    "error": str(exc),
                    "generated": False,
                    "skipped": False,
                    "generated_files": [],
                    "skipped_files": [],
                }
                summary.append(item)
                if show_progress:
                    print(f"  aborted: {exc}")
                return summary
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Identify vortex centers from TDS wind fields.")
    parser.add_argument("--init-time", default=None, help="Initialization time, YYYYMMDDHH. Defaults to latest ECMWF base time.")
    parser.add_argument("--fc-hours", nargs="+", default=DEFAULT_FC_HOURS, help="Forecast hours, e.g. 000 006 012.")
    parser.add_argument("--levels", nargs="+", type=int, default=DEFAULT_LEVELS, help="Pressure levels in hPa.")
    parser.add_argument("--area", nargs=4, type=float, default=DEFAULT_AREA, metavar=("W", "E", "S", "N"))
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output-root", default="data")
    parser.add_argument("--smooth-threshold", type=float, default=1.0)
    parser.add_argument("--save-image", action="store_true")
    parser.add_argument("--save-json", action="store_true", default=True)
    parser.add_argument("--no-save-json", dest="save_json", action="store_false")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_center_identification(
        init_time=args.init_time,
        fc_hours=args.fc_hours,
        levels=args.levels,
        area=args.area,
        source=args.source,
        output_root=args.output_root,
        save_json=args.save_json,
        save_image=args.save_image,
        smooth_threshold=args.smooth_threshold,
    )


if __name__ == "__main__":
    main()
