"""Objective cold-front identification from ECMWF TDS forecast fields.

The implementation follows the two-step method demonstrated in
``demo/冷锋识别.htm``: a frontal zone is first identified from the thermal
front parameter (TFP) and pressure-level cold advection, then its warm
(east/south) edge is retained as the cold-front position.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import xarray as xr
from scipy.ndimage import gaussian_filter, label

from vortex_common import (
    DEFAULT_FC_HOURS,
    DEFAULT_SOURCE,
    VortexDataError,
    calLatestBaseTime,
    format_datetime,
    format_fc_hour,
    forecast_time,
    haversine_distance,
    json_safe_float,
    normalize_fc_hours,
    read_tds_field,
    read_wind_pair,
    write_json,
)
from weather_common import smooth_lines_bezier


DEFAULT_AREA = [0.0, 180.0, 15.0, 75.0]
COLD_FRONT_LEVELS = [850, 925, 950, 1000]
COLD_FRONT_CONFIG = {
    "level": 850,
    "temperature_smoothing_sigma": 6.0,
    "wind_smoothing_sigma": 6.0,
    "tfp_abs_max": 2.0e-11,
    "cold_advection_max_k_per_s": -1.0e-4,
    "coarse_resolution_degrees": 2.5,
    "coarse_frontal_fraction_min": 0.05,
    "minimum_component_points": 50,
    "minimum_length_km": 200.0,
    "line_point_count": 100,
    "num_control_points": 5,
}


def cold_front_dir(output_root: str | Path, init_time: str) -> Path:
    """Return the cold-front product directory for an initialization time."""
    return Path(output_root) / init_time / "cold_fronts"


def cold_front_json_path(
    output_root: str | Path, init_time: str, fc_hour: int | str, level: int = 850
) -> Path:
    """Return the JSON path for one cold-front forecast product."""
    return cold_front_dir(output_root, init_time) / (
        f"cold_front_{init_time}_{format_fc_hour(fc_hour)}_{int(level)}hPa.json"
    )


def _as_data_array(data: xr.DataArray | xr.Dataset) -> xr.DataArray:
    if isinstance(data, xr.Dataset):
        return data[next(iter(data.data_vars))]
    return data


def _normalise_field(data: xr.DataArray | xr.Dataset) -> xr.DataArray:
    """Return a latitude-ascending, longitude-ascending two-dimensional field."""
    data = _as_data_array(data)
    rename_map = {}
    if "latitude" in data.coords or "latitude" in data.dims:
        rename_map["latitude"] = "lat"
    if "longitude" in data.coords or "longitude" in data.dims:
        rename_map["longitude"] = "lon"
    if rename_map:
        data = data.rename(rename_map)
    if "lat" not in data.dims or "lon" not in data.dims:
        raise ValueError("Cold-front fields must have lat and lon dimensions")
    return data.transpose("lat", "lon").sortby("lat").sortby("lon")


def _temperature_kelvin(temp: xr.DataArray) -> xr.DataArray:
    values = np.asarray(temp.values, dtype=float)
    units = str(temp.attrs.get("units", "")).lower()
    if units in {"degc", "c", "celsius", "degrees_celsius"} or np.nanmedian(values) < 100:
        values = values + 273.15
    return xr.DataArray(values, coords=temp.coords, dims=temp.dims, attrs={**temp.attrs, "units": "K"})


def _smoothed(data: xr.DataArray, sigma: float) -> xr.DataArray:
    if sigma <= 0:
        return data
    values = gaussian_filter(np.asarray(data.values, dtype=float), sigma=float(sigma))
    return xr.DataArray(values, coords=data.coords, dims=data.dims, attrs=data.attrs)


def _grid_spacing_metres(lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return local meridional and zonal grid spacing in metres."""
    earth_radius_m = 6_371_000.0
    dy = np.gradient(np.deg2rad(lat)) * earth_radius_m
    dx = (
        np.gradient(np.deg2rad(lon))[None, :]
        * earth_radius_m
        * np.cos(np.deg2rad(lat))[:, None]
    )
    return dy[:, None], dx


def calculate_tfp(temp: xr.DataArray) -> xr.DataArray:
    """Calculate the thermal front parameter in K m^-2.

    ``TFP = -grad(|grad(T)|) · grad(T) / |grad(T)|``.  Grid spacing accounts
    for latitude, unlike the degree-only approximation in the demo page.
    """
    temp = _normalise_field(temp)
    lat = np.asarray(temp.lat.values, dtype=float)
    lon = np.asarray(temp.lon.values, dtype=float)
    if len(lat) < 2 or len(lon) < 2:
        raise ValueError("At least two latitude and longitude grid points are required")
    dy, dx = _grid_spacing_metres(lat, lon)
    values = np.asarray(temp.values, dtype=float)
    dtemp_dlat_index, dtemp_dlon_index = np.gradient(values)
    dtemp_dy = np.divide(dtemp_dlat_index, dy, out=np.zeros_like(values), where=np.abs(dy) > 0)
    dtemp_dx = np.divide(dtemp_dlon_index, dx, out=np.zeros_like(values), where=np.abs(dx) > 0)
    gradient_magnitude = np.hypot(dtemp_dx, dtemp_dy)
    dmag_dlat_index, dmag_dlon_index = np.gradient(gradient_magnitude)
    dmag_dy = np.divide(dmag_dlat_index, dy, out=np.zeros_like(values), where=np.abs(dy) > 0)
    dmag_dx = np.divide(dmag_dlon_index, dx, out=np.zeros_like(values), where=np.abs(dx) > 0)
    safe_magnitude = np.where(gradient_magnitude > 0, gradient_magnitude, np.nan)
    tfp = -(dmag_dx * dtemp_dx + dmag_dy * dtemp_dy) / safe_magnitude
    return xr.DataArray(tfp, coords=temp.coords, dims=temp.dims, attrs={"units": "K m-2"})


def calculate_temperature_advection(
    temp: xr.DataArray, uwnd: xr.DataArray, vwnd: xr.DataArray
) -> xr.DataArray:
    """Calculate horizontal temperature advection in K s^-1."""
    temp, uwnd, vwnd = (_normalise_field(field) for field in (temp, uwnd, vwnd))
    uwnd, vwnd = xr.align(uwnd, vwnd, join="exact")
    temp, uwnd = xr.align(temp, uwnd, join="exact")
    lat = np.asarray(temp.lat.values, dtype=float)
    lon = np.asarray(temp.lon.values, dtype=float)
    dy, dx = _grid_spacing_metres(lat, lon)
    values = np.asarray(temp.values, dtype=float)
    dtemp_dlat_index, dtemp_dlon_index = np.gradient(values)
    dtemp_dy = np.divide(dtemp_dlat_index, dy, out=np.zeros_like(values), where=np.abs(dy) > 0)
    dtemp_dx = np.divide(dtemp_dlon_index, dx, out=np.zeros_like(values), where=np.abs(dx) > 0)
    advection = -(
        np.asarray(uwnd.values, dtype=float) * dtemp_dx
        + np.asarray(vwnd.values, dtype=float) * dtemp_dy
    )
    return xr.DataArray(advection, coords=temp.coords, dims=temp.dims, attrs={"units": "K s-1"})


def aggregate_frontal_zone(
    fine_mask: np.ndarray,
    lat: np.ndarray,
    lon: np.ndarray,
    coarse_resolution_degrees: float,
    frontal_fraction_min: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int, int]:
    """Aggregate a fine frontal-zone mask to blocks near the requested resolution."""
    if fine_mask.ndim != 2 or len(lat) < 2 or len(lon) < 2:
        raise ValueError("A two-dimensional mask with at least two coordinates is required")
    lat_step = float(np.median(np.abs(np.diff(lat))))
    lon_step = float(np.median(np.abs(np.diff(lon))))
    lat_factor = max(1, int(round(coarse_resolution_degrees / lat_step)))
    lon_factor = max(1, int(round(coarse_resolution_degrees / lon_step)))
    rows, cols = fine_mask.shape
    coarse_rows = int(np.ceil(rows / lat_factor))
    coarse_cols = int(np.ceil(cols / lon_factor))
    coarse_mask = np.zeros((coarse_rows, coarse_cols), dtype=bool)
    coarse_lat = np.empty(coarse_rows, dtype=float)
    coarse_lon = np.empty(coarse_cols, dtype=float)
    for row in range(coarse_rows):
        row_start, row_stop = row * lat_factor, min((row + 1) * lat_factor, rows)
        coarse_lat[row] = float(np.mean(lat[row_start:row_stop]))
        for col in range(coarse_cols):
            col_start, col_stop = col * lon_factor, min((col + 1) * lon_factor, cols)
            block = fine_mask[row_start:row_stop, col_start:col_stop]
            coarse_mask[row, col] = bool(block.mean() > frontal_fraction_min)
    for col in range(coarse_cols):
        col_start, col_stop = col * lon_factor, min((col + 1) * lon_factor, cols)
        coarse_lon[col] = float(np.mean(lon[col_start:col_stop]))
    return coarse_mask, coarse_lat, coarse_lon, lat_factor, lon_factor


def extract_warm_boundary(coarse_mask: np.ndarray) -> np.ndarray:
    """Return the east and south edges of frontal-zone cells.

    Latitude is required to increase with row index.  For a cold front this is
    the warm-side boundary used by the two-step method (east/south in the
    Northern Hemisphere convention of the reference implementation).
    """
    if coarse_mask.ndim != 2:
        raise ValueError("coarse_mask must be two-dimensional")
    east_neighbour = np.zeros_like(coarse_mask, dtype=bool)
    east_neighbour[:, :-1] = coarse_mask[:, 1:]
    south_neighbour = np.zeros_like(coarse_mask, dtype=bool)
    south_neighbour[1:, :] = coarse_mask[:-1, :]
    return coarse_mask & (~east_neighbour | ~south_neighbour)


def map_coarse_mask_to_fine(
    coarse_mask: np.ndarray, fine_shape: tuple[int, int], lat_factor: int, lon_factor: int
) -> np.ndarray:
    """Expand coarse cells using nearest-neighbour blocks and crop to fine shape."""
    expanded = np.repeat(np.repeat(coarse_mask, lat_factor, axis=0), lon_factor, axis=1)
    result = np.zeros(fine_shape, dtype=bool)
    rows, cols = min(fine_shape[0], expanded.shape[0]), min(fine_shape[1], expanded.shape[1])
    result[:rows, :cols] = expanded[:rows, :cols]
    return result


def _line_length_km(points: np.ndarray) -> float:
    return float(sum(
        haversine_distance(float(a[0]), float(a[1]), float(b[0]), float(b[1]))
        for a, b in zip(points[:-1], points[1:])
    ))


def _smooth_component_line(
    points: np.ndarray, point_count: int, num_control_points: int
) -> np.ndarray:
    """Order a boundary component and apply trough-style Bezier smoothing.

    Cold-front points use the same ``[lat, lon]`` coordinate order as the
    trough workflow's ``smooth_lines_bezier`` helper.
    """
    centre = points.mean(axis=0)
    _, _, vectors = np.linalg.svd(points - centre, full_matrices=False)
    projection = (points - centre) @ vectors[0]
    ordered = points[np.argsort(projection)]
    _, unique_indices = np.unique(ordered, axis=0, return_index=True)
    ordered = ordered[np.sort(unique_indices)]
    if len(ordered) < 3:
        return ordered
    control_count = max(2, min(int(num_control_points), len(ordered)))
    control_indices = np.linspace(0, len(ordered) - 1, control_count, dtype=int)
    control_points = ordered[control_indices]
    return np.asarray(
        smooth_lines_bezier([control_points], num_points=point_count)[0], dtype=float
    )


def orient_cold_front_line(points: np.ndarray) -> np.ndarray:
    """Set a stable north-hemisphere cold-front direction.

    The shared canvas symbol renderer places cold-front triangles on the left
    side of a directed line.  Over the project's Northern Hemisphere domain,
    keeping the first endpoint east of the final endpoint makes the triangle
    side consistent across forecast times and avoids SVD's arbitrary axis sign
    from flipping the symbol direction between otherwise similar fronts.
    """
    if len(points) < 2:
        return points
    start_lon = float(points[0, 1])
    end_lon = float(points[-1, 1])
    mean_lat = float(np.mean(points[:, 0]))
    if mean_lat >= 0:
        if start_lon < end_lon:
            return points[::-1].copy()
        if np.isclose(start_lon, end_lon) and points[0, 0] < points[-1, 0]:
            # A nearly meridional front has no east/west endpoint distinction.
            # North-to-south is the deterministic fallback that keeps markers
            # on its eastern (warm) side with the shared canvas renderer.
            return points[::-1].copy()
    return points


def fit_cold_front_lines(
    boundary_mask: np.ndarray,
    lat: np.ndarray,
    lon: np.ndarray,
    minimum_component_points: int = 50,
    minimum_length_km: float = 200.0,
    line_point_count: int = 100,
    num_control_points: int = 5,
) -> list[np.ndarray]:
    """Split high-resolution boundaries into filtered, smooth cold-front lines.

    Northern-Hemisphere lines are endpoint-oriented east-to-west after fitting.
    The shared frontend renderer uses line direction to decide the side on
    which cold-front triangles are drawn.
    """
    labelled, component_count = label(boundary_mask, structure=np.ones((3, 3), dtype=int))
    lines = []
    for component in range(1, component_count + 1):
        row_indices, col_indices = np.where(labelled == component)
        if len(row_indices) < minimum_component_points:
            continue
        points = np.column_stack((lat[row_indices], lon[col_indices]))
        fitted = _smooth_component_line(points, line_point_count, num_control_points)
        if len(fitted) >= 2 and _line_length_km(fitted) >= minimum_length_km:
            lines.append(orient_cold_front_line(fitted))
    return lines


def identify_cold_fronts(
    temp: xr.DataArray,
    uwnd: xr.DataArray,
    vwnd: xr.DataArray,
    config: dict | None = None,
) -> tuple[list[np.ndarray], dict[str, xr.DataArray | np.ndarray]]:
    """Identify cold-front lines and return intermediate fields for diagnostics."""
    config = {**COLD_FRONT_CONFIG, **(config or {})}
    temp = _temperature_kelvin(_normalise_field(temp))
    uwnd = _normalise_field(uwnd)
    vwnd = _normalise_field(vwnd)
    temp, uwnd, vwnd = xr.align(temp, uwnd, vwnd, join="exact")
    smooth_temp = _smoothed(temp, config["temperature_smoothing_sigma"])
    smooth_u = _smoothed(uwnd, config["wind_smoothing_sigma"])
    smooth_v = _smoothed(vwnd, config["wind_smoothing_sigma"])
    tfp = calculate_tfp(smooth_temp)
    advection = calculate_temperature_advection(smooth_temp, smooth_u, smooth_v)
    frontal_zone = (
        (np.abs(np.asarray(tfp.values)) <= config["tfp_abs_max"])
        & (np.asarray(advection.values) <= config["cold_advection_max_k_per_s"])
    )
    coarse, coarse_lat, coarse_lon, lat_factor, lon_factor = aggregate_frontal_zone(
        frontal_zone,
        np.asarray(temp.lat.values),
        np.asarray(temp.lon.values),
        config["coarse_resolution_degrees"],
        config["coarse_frontal_fraction_min"],
    )
    warm_boundary = extract_warm_boundary(coarse)
    high_resolution_boundary = frontal_zone & map_coarse_mask_to_fine(
        warm_boundary, frontal_zone.shape, lat_factor, lon_factor
    )
    lines = fit_cold_front_lines(
        high_resolution_boundary,
        np.asarray(temp.lat.values),
        np.asarray(temp.lon.values),
        minimum_component_points=config["minimum_component_points"],
        minimum_length_km=config["minimum_length_km"],
        line_point_count=config["line_point_count"],
        num_control_points=config["num_control_points"],
    )
    return lines, {
        "temperature": smooth_temp,
        "tfp": tfp,
        "advection": advection,
        "frontal_zone": frontal_zone,
        "coarse_zone": coarse,
        "coarse_lat": coarse_lat,
        "coarse_lon": coarse_lon,
        "warm_boundary": warm_boundary,
        "high_resolution_boundary": high_resolution_boundary,
    }


def build_cold_front_json(
    init_time: str,
    fc_hour: int | str,
    source: str,
    config: dict,
    lines: list[np.ndarray],
    diagnostics: dict[str, xr.DataArray | np.ndarray],
) -> dict:
    """Build the project JSON payload, preserving the ``lat``/``lon`` contract."""
    advection = np.asarray(_as_data_array(diagnostics["advection"]).values, dtype=float)
    tfp = np.asarray(_as_data_array(diagnostics["tfp"]).values, dtype=float)
    lat = np.asarray(_as_data_array(diagnostics["advection"]).lat.values, dtype=float)
    lon = np.asarray(_as_data_array(diagnostics["advection"]).lon.values, dtype=float)
    records = []
    for line_id, points in enumerate(lines, start=1):
        point_advection = []
        point_tfp = []
        for point_lat, point_lon in points:
            lat_index = int(np.abs(lat - point_lat).argmin())
            lon_index = int(np.abs(lon - point_lon).argmin())
            point_advection.append(advection[lat_index, lon_index])
            point_tfp.append(tfp[lat_index, lon_index])
        records.append({
            "line_id": line_id,
            "points": [{"lat": json_safe_float(point[0]), "lon": json_safe_float(point[1])} for point in points],
            "attributes": {
                "length_km": json_safe_float(_line_length_km(points)),
                "point_count": int(len(points)),
                "mean_temperature_advection_k_per_s": json_safe_float(np.nanmean(point_advection)),
                "mean_tfp_k_per_m2": json_safe_float(np.nanmean(point_tfp)),
            },
        })
    fc_str = format_fc_hour(fc_hour)
    return {
        "model": source,
        "init_time": format_datetime(forecast_time(init_time, 0)),
        "fore_time": format_datetime(forecast_time(init_time, fc_str)),
        "fc_hour": fc_str,
        "step": int(fc_str),
        "level": int(config["level"]),
        "units": {
            "level": "hPa",
            "lat": "degrees_north",
            "lon": "degrees_east",
            "length_km": "km",
            "temperature_advection": "K s-1",
            "tfp": "K m-2",
        },
        "config": config,
        "cold_front_lines": records,
    }


def read_cold_front_fields(
    init_time: str, fc_hour: int | str, level: int, area: list[float], source: str
) -> tuple[xr.DataArray, xr.DataArray, xr.DataArray]:
    """Read temperature and wind fields at one cold-front identification level."""
    temp = read_tds_field(init_time, fc_hour, "temp", "temp", level, area, source=source)
    uwnd, vwnd = read_wind_pair(init_time, fc_hour, level, area, source=source)
    return temp, uwnd, vwnd


def plot_cold_fronts(
    diagnostics: dict[str, xr.DataArray | np.ndarray], lines: list[np.ndarray], output_path: Path, title: str
) -> None:
    """Render a diagnostic map of the frontal zone and identified cold fronts."""
    try:
        import cartopy.crs as ccrs
        import cartopy.feature as cfeature

        temperature = _as_data_array(diagnostics["temperature"])
        fig = plt.figure(figsize=(10, 8), dpi=150)
        ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
        ax.set_extent([float(temperature.lon.min()), float(temperature.lon.max()), float(temperature.lat.min()), float(temperature.lat.max())])
        ax.add_feature(cfeature.COASTLINE)
        ax.add_feature(cfeature.BORDERS)
        ax.contourf(temperature.lon, temperature.lat, diagnostics["frontal_zone"], levels=[0.5, 1.5], colors=["lightsteelblue"], alpha=0.45, transform=ccrs.PlateCarree())
        for line in lines:
            ax.plot(line[:, 1], line[:, 0], color="blue", linewidth=2, transform=ccrs.PlateCarree())
        ax.gridlines(draw_labels=True)
        ax.set_title(title)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, bbox_inches="tight")
        plt.close(fig)
    except Exception:
        plt.close("all")
        raise


def run_cold_front_identification(
    init_time: str | None = None,
    fc_hours: Iterable[int | str] | None = None,
    levels: Iterable[int] | None = None,
    area: list[float] | None = None,
    source: str = DEFAULT_SOURCE,
    output_root: str | Path = "data",
    config: dict | None = None,
    save_json: bool = True,
    save_image: bool = False,
    show_progress: bool = True,
    skip_existing: bool = True,
) -> list[dict]:
    """Run the cold-front workflow for one initialization and multiple forecast hours."""
    init_time = init_time or calLatestBaseTime()
    fc_hours = normalize_fc_hours(fc_hours or DEFAULT_FC_HOURS)
    levels = [int(level) for level in (levels or COLD_FRONT_LEVELS)]
    area = [float(value) for value in (area or DEFAULT_AREA)]
    config = {**COLD_FRONT_CONFIG, **(config or {})}
    results = []
    total_tasks = len(fc_hours) * len(levels)
    task_index = 0
    for fc_str in fc_hours:
        for level in levels:
            task_index += 1
            level_config = {**config, "level": level}
            json_path = cold_front_json_path(output_root, init_time, fc_str, level)
            image_path = cold_front_dir(output_root, init_time) / f"cold_front_{init_time}_{fc_str}_{level}hPa.png"
            if save_json and skip_existing and json_path.exists():
                results.append({"init_time": init_time, "fc_hour": fc_str, "level": level, "json_path": str(json_path), "image_path": str(image_path) if image_path.exists() else None, "status": "skipped", "generated": False, "skipped": True, "generated_files": [], "skipped_files": [str(json_path)]})
                continue
            if show_progress:
                print(f"[{task_index}/{total_tasks}] cold front init={init_time} fc={fc_str} level={level}")
            try:
                temp, uwnd, vwnd = read_cold_front_fields(init_time, fc_str, level, area, source)
                lines, diagnostics = identify_cold_fronts(temp, uwnd, vwnd, level_config)
                payload = build_cold_front_json(init_time, fc_str, source, level_config, lines, diagnostics)
                generated_files = []
                if save_json:
                    write_json(json_path, payload)
                    generated_files.append(str(json_path))
                if save_image:
                    plot_cold_fronts(diagnostics, lines, image_path, f"Cold Fronts - {init_time} +{fc_str}h {level}hPa")
                    generated_files.append(str(image_path))
                results.append({"init_time": init_time, "fc_hour": fc_str, "level": level, "cold_front_count": len(lines), "json_path": str(json_path) if save_json else None, "image_path": str(image_path) if save_image else None, "status": "completed", "generated": bool(generated_files), "skipped": False, "generated_files": generated_files, "skipped_files": []})
            except VortexDataError as exc:
                results.append({"init_time": init_time, "fc_hour": fc_str, "level": level, "cold_front_count": 0, "json_path": None, "image_path": None, "status": "aborted", "error": str(exc), "generated": False, "skipped": False, "generated_files": [], "skipped_files": []})
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Identify cold fronts from ECMWF TDS fields.")
    parser.add_argument("--init-time", help="Initialization time, YYYYMMDDHH. Defaults to latest ECMWF base time.")
    parser.add_argument("--fc-hours", nargs="+", default=DEFAULT_FC_HOURS)
    parser.add_argument("--levels", nargs="+", type=int, default=COLD_FRONT_LEVELS, help="Pressure levels in hPa.")
    parser.add_argument("--area", nargs=4, type=float, default=DEFAULT_AREA, metavar=("W", "E", "S", "N"))
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output-root", default="data")
    parser.add_argument("--save-image", action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="Regenerate products that already exist.")
    parser.add_argument("--no-save-json", dest="save_json", action="store_false")
    parser.set_defaults(save_json=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_cold_front_identification(
        init_time=args.init_time,
        fc_hours=args.fc_hours,
        levels=args.levels,
        area=args.area,
        source=args.source,
        output_root=args.output_root,
        save_json=args.save_json,
        save_image=args.save_image,
        skip_existing=not args.overwrite,
    )


if __name__ == "__main__":
    main()
