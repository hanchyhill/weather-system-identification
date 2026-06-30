"""Track warm-core vortex centers across forecast hours."""

from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Iterable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from vortex_common import (
    DEFAULT_AREA,
    DEFAULT_FC_HOURS,
    VortexPreflightError,
    calLatestBaseTime,
    center_json_path,
    forecast_time,
    format_fc_hour,
    haversine_distance,
    normalize_fc_hours,
    parse_output_datetime,
    read_json,
    track_json_path,
    tracks_dir,
    warm_json_path,
    write_json,
)


MAX_DISTANCE_BETWEEN_TWO_POINTS = 1000.0


def calculate_speed_and_bearing(
    lon1: float,
    lat1: float,
    lon2: float,
    lat2: float,
    time_interval_hours: float,
) -> tuple[float, float]:
    """Calculate motion speed in km/h and bearing in degrees."""
    distance = haversine_distance(lat1, lon1, lat2, lon2)
    speed = distance / time_interval_hours if time_interval_hours > 0 else 0.0

    lon1_rad, lat1_rad, lon2_rad, lat2_rad = map(math.radians, [lon1, lat1, lon2, lat2])
    dlon = lon2_rad - lon1_rad
    y = math.sin(dlon) * math.cos(lat2_rad)
    x = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(dlon)
    bearing = (math.degrees(math.atan2(y, x)) + 360.0) % 360.0
    return speed, bearing


def predict_position(
    lon: float,
    lat: float,
    speed: float,
    bearing: float,
    time_interval_hours: float,
) -> tuple[float, float]:
    """Predict a future lon/lat from speed, bearing, and time interval."""
    distance = speed * time_interval_hours
    radius_km = 6371.0
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    bearing_rad = math.radians(bearing)

    new_lat_rad = math.asin(
        math.sin(lat_rad) * math.cos(distance / radius_km)
        + math.cos(lat_rad) * math.sin(distance / radius_km) * math.cos(bearing_rad)
    )
    new_lon_rad = lon_rad + math.atan2(
        math.sin(bearing_rad) * math.sin(distance / radius_km) * math.cos(lat_rad),
        math.cos(distance / radius_km) - math.sin(lat_rad) * math.sin(new_lat_rad),
    )
    return math.degrees(new_lon_rad), math.degrees(new_lat_rad)


def time_interval_hours(first: str, second: str) -> float:
    """Return the signed hour interval between two JSON datetime strings."""
    delta = parse_output_datetime(second) - parse_output_datetime(first)
    return delta.total_seconds() / 3600.0


def _point_distance(a: dict, b: dict) -> float:
    return haversine_distance(float(a["lat"]), float(a["lon"]), float(b["lat"]), float(b["lon"]))


class VortexTracker:
    """Three-stage vortex tracker based on distance and motion prediction."""

    def __init__(self, max_jump_km: float = MAX_DISTANCE_BETWEEN_TWO_POINTS):
        self.max_jump_km = max_jump_km
        self.current_id = 1

    def get_next_id(self) -> int:
        next_id = self.current_id
        self.current_id += 1
        return next_id

    def find_closest(
        self,
        target_lon: float,
        target_lat: float,
        candidates: list[dict],
        assigned: set[int],
    ) -> tuple[dict | None, float]:
        closest = None
        min_distance = float("inf")
        for index, candidate in enumerate(candidates):
            if index in assigned or "lat" not in candidate or "lon" not in candidate:
                continue
            distance = haversine_distance(target_lat, target_lon, candidate["lat"], candidate["lon"])
            if distance < min_distance:
                closest = candidate
                min_distance = distance
        return closest, min_distance

    def nearest_distance_match(
        self,
        current: dict,
        next_candidates: list[dict],
        assigned: set[int],
        hour_interval: float,
    ) -> tuple[dict | None, bool]:
        closest, min_distance = self.find_closest(current["lon"], current["lat"], next_candidates, assigned)
        threshold = min(hour_interval * 25.0 + 350.0, self.max_jump_km)
        return (closest, True) if closest is not None and min_distance < threshold else (None, False)

    def forward_speed_match(
        self,
        track: list[dict],
        next_candidates: list[dict],
        assigned: set[int],
        hour_interval: float,
    ) -> tuple[dict | None, bool]:
        previous, current = track[-2], track[-1]
        previous_interval = time_interval_hours(previous["fore_time"], current["fore_time"])
        speed, bearing = calculate_speed_and_bearing(
            previous["lon"], previous["lat"], current["lon"], current["lat"], previous_interval
        )
        predicted_lon, predicted_lat = predict_position(
            current["lon"], current["lat"], speed, bearing, hour_interval
        )
        closest, min_distance = self.find_closest(predicted_lon, predicted_lat, next_candidates, assigned)
        if closest is None or _point_distance(current, closest) > self.max_jump_km:
            return None, False
        return (closest, True) if min_distance < 350.0 else (None, False)

    def central_difference_match(
        self,
        track: list[dict],
        next_candidates: list[dict],
        assigned: set[int],
        hour_interval: float,
    ) -> tuple[dict | None, bool]:
        previous2, current = track[-3], track[-1]
        previous_interval = time_interval_hours(previous2["fore_time"], current["fore_time"])
        speed, bearing = calculate_speed_and_bearing(
            previous2["lon"], previous2["lat"], current["lon"], current["lat"], previous_interval
        )
        predicted_lon, predicted_lat = predict_position(
            current["lon"], current["lat"], speed, bearing, hour_interval
        )
        closest, min_distance = self.find_closest(predicted_lon, predicted_lat, next_candidates, assigned)
        if closest is None or _point_distance(current, closest) > self.max_jump_km:
            return None, False
        return (closest, True) if min_distance < 350.0 else (None, False)

    def run_tracking(self, time_slices: list[dict]) -> list[list[dict]]:
        """Track centers through sorted forecast time slices."""
        if not time_slices:
            return []

        all_tracks: list[list[dict]] = []
        assigned_by_time = [set() for _ in time_slices]

        for time_index in range(len(time_slices) - 1):
            current_candidates = time_slices[time_index]["tc_list"]
            current_candidates.sort(
                key=lambda item: item.get("vmax") if item.get("vmax") is not None else 0.0,
                reverse=True,
            )

            for candidate_index, candidate in enumerate(current_candidates):
                if candidate_index in assigned_by_time[time_index]:
                    continue
                if "lat" not in candidate or "lon" not in candidate:
                    continue

                track_id = self.get_next_id()
                candidate["id"] = track_id
                assigned_by_time[time_index].add(candidate_index)
                current_track = [candidate.copy()]
                next_time_index = time_index + 1

                while next_time_index < len(time_slices):
                    next_candidates = time_slices[next_time_index]["tc_list"]
                    hour_interval = time_interval_hours(
                        current_track[-1]["fore_time"],
                        time_slices[next_time_index]["fore_time"],
                    )
                    if hour_interval <= 0:
                        break

                    track_length = len(current_track)
                    if track_length == 1:
                        matched, success = self.nearest_distance_match(
                            current_track[-1],
                            next_candidates,
                            assigned_by_time[next_time_index],
                            hour_interval,
                        )
                    elif track_length == 2:
                        matched, success = self.forward_speed_match(
                            current_track,
                            next_candidates,
                            assigned_by_time[next_time_index],
                            hour_interval,
                        )
                    else:
                        matched, success = self.central_difference_match(
                            current_track,
                            next_candidates,
                            assigned_by_time[next_time_index],
                            hour_interval,
                        )

                    if success and matched is not None:
                        matched_index = next_candidates.index(matched)
                        matched["id"] = track_id
                        assigned_by_time[next_time_index].add(matched_index)
                        current_track.append(matched.copy())
                        next_time_index += 1
                    elif hour_interval <= 24.0 and len(current_track) > 1:
                        next_time_index += 1
                    else:
                        break

                if len(current_track) > 1:
                    all_tracks.append(current_track)

        return all_tracks

    @staticmethod
    def restructure_tracks(raw_tracks: list[list[dict]], min_track_length: int = 3, min_max_wind: float = 5.0) -> list[dict]:
        filtered = [track for track in raw_tracks if len(track) >= min_track_length]
        records = []
        for track in filtered:
            first = track[0]
            max_wind = max(point.get("vmax") or 0.0 for point in track)
            if max_wind < min_max_wind:
                continue
            records.append(
                {
                    "model": first.get("model", ""),
                    "init_time": first.get("init_time", ""),
                    "lon": first.get("lon"),
                    "lat": first.get("lat"),
                    "id": first.get("id"),
                    "GZ_number": "",
                    "seq_number": "",
                    "max_wind": max_wind,
                    "warm": any(point.get("warm", False) for point in track),
                    "track": track,
                }
            )

        records.sort(key=lambda item: item["max_wind"], reverse=True)
        for index, record in enumerate(records, start=1):
            time_part = parse_output_datetime(record["init_time"]).strftime("%Y%m%d%H")
            record["GZ_number"] = f"{time_part}_{index:03d}"
            record["seq_number"] = f"{index:03d}"
        return records


def preflight_tracking_inputs(output_root: str | Path, init_time: str, fc_hours: Iterable[int | str]) -> list[str]:
    """Ensure all expected center and warm-core JSON files are present and readable."""
    missing_or_bad = []
    ready_fc_hours = []
    for fc_str in normalize_fc_hours(fc_hours):
        center_path = center_json_path(output_root, init_time, fc_str, 850)
        warm_path = warm_json_path(output_root, init_time, fc_str)
        for path in (center_path, warm_path):
            if not path.exists():
                missing_or_bad.append(f"missing {path}")
                continue
            try:
                read_json(path)
            except Exception as exc:
                missing_or_bad.append(f"unreadable {path}: {exc}")
        ready_fc_hours.append(fc_str)
    if missing_or_bad:
        raise VortexPreflightError("Tracking inputs are not ready: " + "; ".join(missing_or_bad))
    return ready_fc_hours


def load_warm_time_slices(output_root: str | Path, init_time: str, fc_hours: Iterable[int | str]) -> list[dict]:
    """Load warm-core JSON files and attach forecast valid times."""
    time_slices = []
    for fc_str in normalize_fc_hours(fc_hours):
        data = read_json(warm_json_path(output_root, init_time, fc_str))
        fore_dt = forecast_time(init_time, fc_str)
        if data:
            fore_time = data[0].get("fore_time", fore_dt.strftime("%Y-%m-%d %H:%M:%S"))
            init_time_output = data[0].get("init_time")
            step = data[0].get("step", int(fc_str))
        else:
            fore_time = fore_dt.strftime("%Y-%m-%d %H:%M:%S")
            init_time_output = forecast_time(init_time, 0).strftime("%Y-%m-%d %H:%M:%S")
            step = int(fc_str)
        time_slices.append(
            {
                "init_time": init_time_output,
                "fore_time": fore_time,
                "step": step,
                "fc_hour": fc_str,
                "tc_list": data,
            }
        )
    time_slices.sort(key=lambda item: parse_output_datetime(item["fore_time"]))
    return time_slices


def plot_tracks(tracks: list[dict], output_path: str | Path, area: list[float]) -> None:
    """Plot warm tracks to a PNG map."""
    try:
        import cartopy.crs as ccrs
        import cartopy.feature as cfeature

        fig = plt.figure(figsize=(12, 8), dpi=150)
        ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
        ax.set_extent(area, crs=ccrs.PlateCarree())
        ax.add_feature(cfeature.COASTLINE)
        ax.add_feature(cfeature.BORDERS)
        ax.gridlines(draw_labels=True)

        for track_record in tracks:
            if not track_record.get("warm"):
                continue
            points = track_record["track"]
            if len(points) < 2:
                continue
            lons = [point["lon"] for point in points]
            lats = [point["lat"] for point in points]
            ax.plot(lons, lats, "o-", linewidth=1.5, markersize=3, transform=ccrs.PlateCarree())
            ax.text(lons[0], lats[0], track_record["seq_number"], fontsize=8, transform=ccrs.PlateCarree())

        ax.set_title(f"Warm-Core Vortex Tracks ({sum(1 for track in tracks if track.get('warm'))})")
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output_path, bbox_inches="tight")
        plt.close(fig)
    except Exception:
        plt.close("all")
        raise


def run_tracking_workflow(
    init_time: str | None = None,
    fc_hours: Iterable[int | str] | None = None,
    output_root: str | Path = "data",
    save_image: bool = False,
    area: list[float] | None = None,
    show_progress: bool = True,
) -> dict:
    """Run preflight, tracking, and output serialization."""
    if init_time is None:
        init_time = calLatestBaseTime()
    fc_hours = normalize_fc_hours(fc_hours or DEFAULT_FC_HOURS)
    area = [float(value) for value in (area or DEFAULT_AREA)]

    ready_fc_hours = preflight_tracking_inputs(output_root, init_time, fc_hours)
    if show_progress:
        print(f"Tracking preflight ready: init={init_time}, forecast_hours={len(ready_fc_hours)}")

    time_slices = load_warm_time_slices(output_root, init_time, ready_fc_hours)
    tracker = VortexTracker()
    raw_tracks = tracker.run_tracking(time_slices)
    tracks = tracker.restructure_tracks(raw_tracks)
    output_path = track_json_path(output_root, init_time)
    output_data = {"total_tracks": len(tracks), "tracks": tracks}
    write_json(output_path, output_data)

    image_path = None
    if save_image:
        image_path = tracks_dir(output_root, init_time) / f"tc_tracking_plot_processed_{init_time}.png"
        plot_tracks(tracks, image_path, area)

    if show_progress:
        print(f"Saved tracking JSON: {output_path}")
        if image_path:
            print(f"Saved tracking image: {image_path}")
    return {
        "init_time": init_time,
        "fc_hours": ready_fc_hours,
        "raw_track_count": len(raw_tracks),
        "total_tracks": len(tracks),
        "json_path": str(output_path),
        "image_path": str(image_path) if image_path else None,
        "status": "completed",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Track warm-core vortex centers.")
    parser.add_argument("--init-time", default=None, help="Initialization time, YYYYMMDDHH. Defaults to latest ECMWF base time.")
    parser.add_argument("--fc-hours", nargs="+", default=DEFAULT_FC_HOURS)
    parser.add_argument("--output-root", default="data")
    parser.add_argument("--save-image", action="store_true")
    parser.add_argument("--area", nargs=4, type=float, default=DEFAULT_AREA, metavar=("W", "E", "S", "N"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_tracking_workflow(
        init_time=args.init_time,
        fc_hours=args.fc_hours,
        output_root=args.output_root,
        save_image=args.save_image,
        area=args.area,
    )


if __name__ == "__main__":
    main()
