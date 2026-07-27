"""Configuration for SVG weather layer rendering and tile indexing."""

from __future__ import annotations

from copy import deepcopy


MULTI_Z_LAYER_TYPES = {"wind_barb", "wind_quiver", "surface_barb", "surface_quiver"}
VECTOR_SKIP_BY_Z = {
    0: 8,
    1: 5,
    2: 3,
}
SINGLE_Z_FIGURE_SIZE = (20, 16)


TILE_SCHEME = {
    "type": "quadtree",
    "projection": "PlateCarree",
    "bounds": {
        "lon_min": 60.0,
        "lon_max": 150.0,
        "lat_min": 0.0,
        "lat_max": 60.0,
    },
    "matrix_bounds": {
        "lon_min": -120.0,
        "lon_max": 240.0,
        "lat_min": -120.0,
        "lat_max": 120.0,
    },
    "origin": "northwest",
    "indexing": "global_matrix",
    "levels": [0, 1, 2],
    "base_tile_size": {
        "lon": 90.0,
        "lat": 60.0,
    },
    "tile_count": {
        "0": [4, 4],
        "1": [8, 8],
        "2": [16, 16],
    },
    "generated_tile_count": {
        "0": [1, 1],
        "1": [2, 2],
        "2": [4, 4],
    },
}


DEFAULT_LAYER_STYLE = {
    "figure_size": (10, 8),
    "sigma": 2.0,
    "skip": 8,
    "contour_interval": 2.0,
    "contour_color": "black",
    "contour_linewidth": 0.7,
}


LAYER_STYLES = {
    "hght_contour": {
        "contour_interval": 2.0,
        "contour_color": "black",
        "contour_linewidth": 0.7,
        "hght_500_fill": [
            {"levels": [586, 588], "color": "yellow", "alpha": 0.5},
            {"levels": [588, None], "color": "orange", "alpha": 0.5},
        ],
        "hght_500_contours": [
            {"levels": "range_500_600_2", "color": "black", "linewidth": 0.7, "zorder": 3},
            {"levels": [588], "color": "red", "linewidth": 3.0, "zorder": 4},
            {"levels": [584], "color": "orange", "linewidth": 2.0, "zorder": 4},
        ],
    },
    "wind_quiver": {
        "skip_by_z": VECTOR_SKIP_BY_Z,
        "sigma": 2.0,
        "scale": 320,
        "width": 0.0024,
        "color": "#111827",
    },
    "surface_quiver": {
        "skip_by_z": VECTOR_SKIP_BY_Z,
        "sigma": 2.0,
        "scale": 320,
        "width": 0.0024,
        "color": "#111827",
    },
    "wind_barb": {
        "skip_by_z": VECTOR_SKIP_BY_Z,
        "sigma": 2.0,
        "length": 6,
        "linewidth": 0.45,
        "barbcolor": "blue",
        "barb_increments": {"half": 2, "full": 4, "flag": 20},
        "sizes": {"emptybarb": 0},
    },
    "surface_barb": {
        "skip_by_z": VECTOR_SKIP_BY_Z,
        "sigma": 2.0,
        "length": 6,
        "linewidth": 0.45,
        "barbcolor": "blue",
        "barb_increments": {"half": 2, "full": 4, "flag": 20},
        "sizes": {"emptybarb": 0},
    },
    "wind_speed_fill": {
        "sigma": 2.0,
        "high_level_threshold": 500,
        "high_extend": "max",
        "extend": "both",
    },
    "surface_speed_fill": {
        "sigma": 2.0,
        "extend": "both",
    },
    "wind_streamline": {
        "sigma": 2.0,
        "density": 1.45,
        "linewidth": 0.55,
        "arrowsize": 0.65,
        "color": "#0f172a",
    },
    "surface_streamline": {
        "sigma": 2.0,
        "density": 1.45,
        "linewidth": 0.55,
        "arrowsize": 0.65,
        "color": "#0f172a",
    },
    "temp_contour": {
        "contour_linewidth": 0.7,
        "levels": {"start": -40.0, "stop": 40.0, "count": 81},
    },
    "vort_fill": {
        "scale_factor": 100000.0,
        "levels": {"start": 1.0, "stop": 51.0, "count": 51},
        "extend": "both",
    },
    "rhum_fill": {
        "levels": {"start": 0.0, "stop": 100.0, "count": 21},
        "extend": "both",
    },
    "mslp_contour": {
        "contour_interval": 2.0,
        "contour_color": "black",
        "contour_linewidth": 0.75,
    },
    "rain_24h_fill": {
        "extend": "max",
    },
    "rain_6h_fill": {
        "extend": "max",
    },
    "rain_3h_fill": {
        "extend": "max",
    },
}


def style_for(layer_type: str, level: int | None, z: int) -> dict[str, object]:
    """Return rendering style for a layer at a pressure level and tile zoom."""
    del level
    style = deepcopy(DEFAULT_LAYER_STYLE)
    style.update(deepcopy(LAYER_STYLES.get(layer_type, {})))
    skip_by_z = style.pop("skip_by_z", None)
    if skip_by_z is not None:
        style["skip"] = skip_by_z.get(int(z), style["skip"])
    if int(z) == 0 and layer_type not in MULTI_Z_LAYER_TYPES:
        style["figure_size"] = SINGLE_Z_FIGURE_SIZE
    return style
