"""Generate transparent SVG weather layers and a frontend manifest.

The output is organized for the Vue viewer:

    data/products/{init_time}/manifest.json
    data/products/{init_time}/{fc_hour}/{level}/{layer_type}.svg
    data/products/{init_time}/{fc_hour}/surface/{layer_type}.svg
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import cartopy.crs as ccrs
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import xarray as xr
from scipy.ndimage import gaussian_filter


HIGH_LAYER_TYPES = (
    "hght_contour",
    "wind_quiver",
    "wind_barb",
    "wind_speed_fill",
    "wind_streamline",
)
SURFACE_LAYER_TYPES = (
    "surface_quiver",
    "surface_barb",
    "surface_speed_fill",
    "surface_streamline",
)
DEFAULT_LEVELS = (200, 500, 850, 925, 950)
DEFAULT_BOUNDS = (60.0, 180.0, 0.0, 60.0)
DEFAULT_BASE_URL_TEMPLATE = "http://10.148.8.71:7080/thredds/dodsC/{source}/"


@dataclass(frozen=True)
class Bounds:
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


def format_fc_hour(fc_hour: str | int) -> str:
    return str(fc_hour).strip().zfill(3)


def selected_time(init_time: str) -> str:
    return f"{init_time[0:4]}-{init_time[4:6]}-{init_time[6:8]} {init_time[8:10]}:00:00"


def thredds_url(init_time: str, source: str, filename: str, base_url_template: str) -> str:
    return (
        base_url_template.format(source=source).rstrip("/")
        + f"/{init_time[0:6]}/{filename}"
    )


def first_present(names: Iterable[str], candidates: Iterable[str]) -> str | None:
    available = set(names)
    for candidate in candidates:
        if candidate in available:
            return candidate
    return None


def coord_name(data: xr.DataArray, role: str) -> str:
    if role == "lon":
        candidates = ("lon", "longitude", "x")
    elif role == "lat":
        candidates = ("lat", "latitude", "y")
    elif role == "level":
        candidates = ("level", "lev", "isobaricInhPa", "pressure")
    elif role == "time":
        candidates = ("time", "valid_time")
    else:
        raise ValueError(f"Unknown coordinate role: {role}")

    name = first_present(data.coords, candidates) or first_present(data.dims, candidates)
    if name is None:
        raise ValueError(f"Could not find {role} coordinate in {data.name or 'data array'}")
    return name


def choose_variable(dataset: xr.Dataset, candidates: Iterable[str]) -> str:
    name = first_present(dataset.data_vars, candidates)
    if name is not None:
        return name
    if len(dataset.data_vars) == 1:
        return next(iter(dataset.data_vars))
    raise ValueError(
        "Could not choose variable. Tried "
        + ", ".join(candidates)
        + f"; available variables: {', '.join(dataset.data_vars)}"
    )


def open_data_array(
    path_or_url: str,
    variable_candidates: Iterable[str],
    init_time: str,
    level: int | None,
    bounds: Bounds,
) -> xr.DataArray:
    dataset = xr.open_dataset(path_or_url)
    variable = choose_variable(dataset, variable_candidates)
    data = dataset[variable]

    time_name = first_present(data.coords, ("time", "valid_time"))
    if time_name is not None:
        try:
            data = data.sel({time_name: np.datetime64(selected_time(init_time))})
        except Exception:
            data = data.sel({time_name: np.datetime64(selected_time(init_time))}, method="nearest")

    if level is not None:
        level_name = first_present(data.coords, ("level", "lev", "isobaricInhPa", "pressure"))
        if level_name is not None:
            data = data.sel({level_name: level}, method="nearest")

    lat_name = coord_name(data, "lat")
    lon_name = coord_name(data, "lon")

    data = data.sortby(lat_name).sortby(lon_name)
    data = data.sel(
        {
            lon_name: slice(bounds.lon_min, bounds.lon_max),
            lat_name: slice(bounds.lat_min, bounds.lat_max),
        }
    )

    if data.sizes.get(lat_name, 0) == 0 or data.sizes.get(lon_name, 0) == 0:
        raise ValueError(
            f"No data remains after cropping to bounds {bounds.as_list()} from {path_or_url}"
        )

    return data.squeeze(drop=True)


def default_path(
    explicit_path: str | None,
    init_time: str,
    source: str,
    filename: str,
    base_url_template: str,
) -> str:
    if explicit_path:
        return explicit_path
    return thredds_url(init_time, source, filename, base_url_template)


def wind_speed(u: xr.DataArray, v: xr.DataArray) -> xr.DataArray:
    return np.sqrt(u**2 + v**2)


def smooth_array(data: xr.DataArray, sigma: float) -> xr.DataArray:
    if sigma <= 0:
        return data
    values = gaussian_filter(np.asarray(data.values, dtype=float), sigma=sigma)
    return xr.DataArray(values, coords=data.coords, dims=data.dims, attrs=data.attrs)


def lon_lat_values(data: xr.DataArray) -> tuple[np.ndarray, np.ndarray]:
    return (
        np.asarray(data[coord_name(data, "lon")].values, dtype=float),
        np.asarray(data[coord_name(data, "lat")].values, dtype=float),
    )


def setup_axis(bounds: Bounds, figsize: tuple[float, float], dpi: int):
    fig = plt.figure(figsize=figsize, dpi=dpi)
    ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
    ax.set_extent(bounds.as_list(), crs=ccrs.PlateCarree())
    fig.patch.set_alpha(0)
    ax.patch.set_alpha(0)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_axis_off()
    if "geo" in ax.spines:
        ax.spines["geo"].set_visible(False)
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    return fig, ax


def save_svg(fig, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        output_path,
        bbox_inches="tight",
        format="svg",
        transparent=True,
        pad_inches=0,
    )
    plt.close(fig)


def draw_hght_contour(hght: xr.DataArray, bounds: Bounds, output_path: Path, dpi: int) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    lon, lat = lon_lat_values(hght)
    values = np.asarray(hght.values, dtype=float)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        raise ValueError("Height field contains no finite values")
    interval = 40 if np.nanmax(finite) > 2000 else 4
    levels = np.arange(
        np.floor(np.nanmin(finite) / interval) * interval,
        np.ceil(np.nanmax(finite) / interval) * interval + interval,
        interval,
    )
    ax.contour(lon, lat, values, levels=levels, colors="#364152", linewidths=0.7)
    save_svg(fig, output_path)


def draw_wind_quiver(
    u: xr.DataArray,
    v: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    skip: int,
    sigma: float,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    u_smoothed = smooth_array(u, sigma)
    v_smoothed = smooth_array(v, sigma)
    lon, lat = lon_lat_values(u_smoothed)
    ax.quiver(
        lon[::skip],
        lat[::skip],
        u_smoothed.values[::skip, ::skip],
        v_smoothed.values[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        scale=320,
        width=0.0024,
        color="#111827",
    )
    save_svg(fig, output_path)


def draw_wind_barb(
    u: xr.DataArray,
    v: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    skip: int,
    sigma: float,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    u_smoothed = smooth_array(u, sigma)
    v_smoothed = smooth_array(v, sigma)
    lon, lat = lon_lat_values(u_smoothed)
    ax.barbs(
        lon[::skip],
        lat[::skip],
        u_smoothed.values[::skip, ::skip],
        v_smoothed.values[::skip, ::skip],
        transform=ccrs.PlateCarree(),
        length=4.7,
        linewidth=0.45,
        color="#172033",
        barb_increments={"half": 2, "full": 4, "flag": 20},
        sizes={"emptybarb": 0},
    )
    save_svg(fig, output_path)


def draw_wind_speed_fill(
    u: xr.DataArray,
    v: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    sigma: float,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    speed = smooth_array(wind_speed(u, v), sigma)
    lon, lat = lon_lat_values(speed)
    finite = np.asarray(speed.values, dtype=float)
    finite = finite[np.isfinite(finite)]
    if finite.size == 0:
        raise ValueError("Wind speed field contains no finite values")
    max_speed = max(10.0, float(np.nanpercentile(finite, 98)))
    levels = np.linspace(0, max_speed, 13)
    ax.contourf(
        lon,
        lat,
        speed.values,
        levels=levels,
        cmap="viridis",
        alpha=0.72,
        extend="max",
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def draw_wind_streamline(
    u: xr.DataArray,
    v: xr.DataArray,
    bounds: Bounds,
    output_path: Path,
    dpi: int,
    sigma: float,
) -> None:
    fig, ax = setup_axis(bounds, (10, 8), dpi)
    u_smoothed = smooth_array(u, sigma)
    v_smoothed = smooth_array(v, sigma)
    lon, lat = lon_lat_values(u_smoothed)
    ax.streamplot(
        lon,
        lat,
        u_smoothed.values,
        v_smoothed.values,
        density=1.45,
        linewidth=0.55,
        arrowsize=0.65,
        color="#0f172a",
        transform=ccrs.PlateCarree(),
    )
    save_svg(fig, output_path)


def product_record(
    init_time: str,
    fc_hour: str,
    level: str | int,
    layer_type: str,
    path: Path,
    output_root: Path,
    bounds: Bounds,
    status: str = "generated",
    error: str | None = None,
) -> dict[str, object]:
    init_root = output_root / init_time
    try:
        rel_path = path.relative_to(init_root).as_posix()
    except ValueError:
        rel_path = path.as_posix()

    record: dict[str, object] = {
        "init_time": init_time,
        "fc_hour": fc_hour,
        "level": level,
        "layer_type": layer_type,
        "path": rel_path,
        "bounds": bounds.as_dict(),
        "projection": "PlateCarree",
        "status": status,
    }
    if error:
        record["error"] = error
    return record


def ensure_manifest_shape(init_time: str, bounds: Bounds) -> dict[str, object]:
    return {
        "init_time": init_time,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bounds": bounds.as_dict(),
        "projection": "PlateCarree",
        "fc_hours": [],
        "levels": [],
        "layer_types": {
            "upper_air": list(HIGH_LAYER_TYPES),
            "surface": list(SURFACE_LAYER_TYPES),
        },
        "products": {},
    }


def add_manifest_record(manifest: dict[str, object], record: dict[str, object]) -> None:
    fc_hour = str(record["fc_hour"])
    level = str(record["level"])
    layer_type = str(record["layer_type"])
    products = manifest["products"]
    assert isinstance(products, dict)
    products.setdefault(fc_hour, {}).setdefault(level, {})[layer_type] = record

    fc_hours = manifest["fc_hours"]
    levels = manifest["levels"]
    assert isinstance(fc_hours, list)
    assert isinstance(levels, list)
    if fc_hour not in fc_hours:
        fc_hours.append(fc_hour)
    if level not in levels:
        levels.append(level)


def generate_upper_air_layers(args, fc_hour: str, level: int, bounds: Bounds, manifest) -> None:
    output_root = Path(args.output)
    layer_dir = output_root / args.init_time / fc_hour / str(level)
    common = {
        "init_time": args.init_time,
        "level": level,
        "bounds": bounds,
    }
    u_path = default_path(args.uwnd_path, args.init_time, args.source, "uwnd.nc", args.base_url_template)
    v_path = default_path(args.vwnd_path, args.init_time, args.source, "vwnd.nc", args.base_url_template)
    hght_path = default_path(args.hght_path, args.init_time, args.source, "hght.nc", args.base_url_template)

    u_candidates = [args.uwnd_var.format(fc_hour=fc_hour), f"uwnd{fc_hour}", "uwnd", "u"]
    v_candidates = [args.vwnd_var.format(fc_hour=fc_hour), f"vwnd{fc_hour}", "vwnd", "v"]
    hght_candidates = [args.hght_var.format(fc_hour=fc_hour), f"hght{fc_hour}", "hght", "z"]

    wind_fields = None
    for layer_type in HIGH_LAYER_TYPES:
        output_path = layer_dir / f"{layer_type}.svg"
        if args.skip_existing and output_path.exists():
            add_manifest_record(
                manifest,
                product_record(args.init_time, fc_hour, level, layer_type, output_path, output_root, bounds, "skipped"),
            )
            continue

        try:
            if layer_type == "hght_contour":
                hght = open_data_array(hght_path, hght_candidates, **common)
                draw_hght_contour(hght, bounds, output_path, args.dpi)
            else:
                if wind_fields is None:
                    wind_fields = (
                        open_data_array(u_path, u_candidates, **common),
                        open_data_array(v_path, v_candidates, **common),
                    )
                u, v = wind_fields
                if layer_type == "wind_quiver":
                    draw_wind_quiver(u, v, bounds, output_path, args.dpi, args.skip, args.sigma)
                elif layer_type == "wind_barb":
                    draw_wind_barb(u, v, bounds, output_path, args.dpi, args.skip, args.sigma)
                elif layer_type == "wind_speed_fill":
                    draw_wind_speed_fill(u, v, bounds, output_path, args.dpi, args.sigma)
                elif layer_type == "wind_streamline":
                    draw_wind_streamline(u, v, bounds, output_path, args.dpi, args.sigma)

            status = "generated"
            error = None
        except Exception as exc:
            status = "failed"
            error = str(exc)
            print(f"Failed {fc_hour} {level} {layer_type}: {error}")

        add_manifest_record(
            manifest,
            product_record(
                args.init_time, fc_hour, level, layer_type, output_path, output_root, bounds, status, error
            ),
        )


def generate_surface_layers(args, fc_hour: str, bounds: Bounds, manifest) -> None:
    if not args.u10_path or not args.v10_path:
        return

    output_root = Path(args.output)
    layer_dir = output_root / args.init_time / fc_hour / "surface"
    common = {
        "init_time": args.init_time,
        "level": None,
        "bounds": bounds,
    }
    u_candidates = [args.u10_var.format(fc_hour=fc_hour), f"u10{fc_hour}", "u10", "u"]
    v_candidates = [args.v10_var.format(fc_hour=fc_hour), f"v10{fc_hour}", "v10", "v"]

    wind_fields = None
    for layer_type in SURFACE_LAYER_TYPES:
        output_path = layer_dir / f"{layer_type}.svg"
        if args.skip_existing and output_path.exists():
            add_manifest_record(
                manifest,
                product_record(args.init_time, fc_hour, "surface", layer_type, output_path, output_root, bounds, "skipped"),
            )
            continue

        try:
            if wind_fields is None:
                wind_fields = (
                    open_data_array(args.u10_path, u_candidates, **common),
                    open_data_array(args.v10_path, v_candidates, **common),
                )
            u, v = wind_fields
            if layer_type == "surface_quiver":
                draw_wind_quiver(u, v, bounds, output_path, args.dpi, args.skip, args.sigma)
            elif layer_type == "surface_barb":
                draw_wind_barb(u, v, bounds, output_path, args.dpi, args.skip, args.sigma)
            elif layer_type == "surface_speed_fill":
                draw_wind_speed_fill(u, v, bounds, output_path, args.dpi, args.sigma)
            elif layer_type == "surface_streamline":
                draw_wind_streamline(u, v, bounds, output_path, args.dpi, args.sigma)

            status = "generated"
            error = None
        except Exception as exc:
            status = "failed"
            error = str(exc)
            print(f"Failed {fc_hour} surface {layer_type}: {error}")

        add_manifest_record(
            manifest,
            product_record(
                args.init_time, fc_hour, "surface", layer_type, output_path, output_root, bounds, status, error
            ),
        )


def write_manifest(output_root: Path, init_time: str, manifest: dict[str, object]) -> Path:
    manifest["fc_hours"] = sorted(manifest["fc_hours"])
    manifest["levels"] = sorted(manifest["levels"], key=lambda item: (item == "surface", str(item)))
    manifest_path = output_root / init_time / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate transparent SVG weather layers.")
    parser.add_argument("--init-time", required=True, help="Initial time, e.g. 2026062900.")
    parser.add_argument("--fc-hours", nargs="+", default=["000"], help="Forecast hours, e.g. 000 003.")
    parser.add_argument("--levels", nargs="+", type=int, default=list(DEFAULT_LEVELS), help="Pressure levels in hPa.")
    parser.add_argument("--output", default="data/products", help="Output root directory.")
    parser.add_argument("--bounds", nargs=4, type=float, default=list(DEFAULT_BOUNDS), metavar=("LON_MIN", "LON_MAX", "LAT_MIN", "LAT_MAX"))
    parser.add_argument("--source", default="ecmwfthin", help="THREDDS source name.")
    parser.add_argument("--base-url-template", default=DEFAULT_BASE_URL_TEMPLATE)
    parser.add_argument("--uwnd-path", help="Local path or URL for upper-air U wind NetCDF.")
    parser.add_argument("--vwnd-path", help="Local path or URL for upper-air V wind NetCDF.")
    parser.add_argument("--hght-path", help="Local path or URL for geopotential height NetCDF.")
    parser.add_argument("--u10-path", help="Local path or URL for 10 m U wind NetCDF.")
    parser.add_argument("--v10-path", help="Local path or URL for 10 m V wind NetCDF.")
    parser.add_argument("--uwnd-var", default="uwnd{fc_hour}")
    parser.add_argument("--vwnd-var", default="vwnd{fc_hour}")
    parser.add_argument("--hght-var", default="hght{fc_hour}")
    parser.add_argument("--u10-var", default="u10")
    parser.add_argument("--v10-var", default="v10")
    parser.add_argument("--surface-only", action="store_true", help="Generate only surface layers.")
    parser.add_argument("--upper-only", action="store_true", help="Generate only upper-air layers.")
    parser.add_argument("--skip-existing", action="store_true", help="Reuse existing SVG files.")
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--skip", type=int, default=8, help="Vector/barb grid skip.")
    parser.add_argument("--sigma", type=float, default=2.0, help="Gaussian smoothing sigma.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    bounds = Bounds(*args.bounds)
    output_root = Path(args.output)
    fc_hours = [format_fc_hour(fc_hour) for fc_hour in args.fc_hours]
    manifest = ensure_manifest_shape(args.init_time, bounds)

    for fc_hour in fc_hours:
        if not args.surface_only:
            for level in args.levels:
                generate_upper_air_layers(args, fc_hour, level, bounds, manifest)
        if not args.upper_only:
            generate_surface_layers(args, fc_hour, bounds, manifest)

    manifest_path = write_manifest(output_root, args.init_time, manifest)
    print(f"Wrote manifest: {manifest_path}")


if __name__ == "__main__":
    main()
