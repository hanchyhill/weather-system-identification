# 急流轴数据实现计划

## Summary

- 新增 `src/jet.py`，把 `src/jet_v2.ipynb` 的急流轴识别流程模块化：平滑风场、计算垂直风速平流、提取急流轴点、连线、按风向调整方向、用 `smoothness=5` 样条平滑、绘图和输出 JSON。
- 新增 `src/weather_common.py` 抽离 `trough.py` 与 `jet.py` 共用的时间、数据读取、数据校验、连线、平滑、JSON 坐标转换等函数。
- 保持 `trough.py` 现有公开函数名和行为兼容，避免影响已有槽线输出。

## Key Changes

- 公共库：
  - 抽出 `DEFAULT_SOURCE`、`TIME_STR_LIST_ECMWFTHIN`、`TARGET_LEV_LIST`、`WeatherDataError` 系列异常、`calLatestBaseTime`、`format_fc_hour`、`load_weather_data`、`validate_weather_data_values`。
  - 抽出 `form_lines`、`smooth_lines`、`smooth_lines_bezier`、数值/坐标 JSON 工具。
  - 坐标 JSON 工具支持两种点序：槽线继续使用 `[lat, lon]`，急流轴使用 notebook 的 `[lon, lat]`。

- 急流轴模块 `src/jet.py`：
  - 默认配置：
    - `wind_smooth_sigma=3`
    - `speed_threshold=4`
    - `interval_dis=2.0`
    - `length_min=5.0`
    - `smoothness=5`
    - `barb_skip=8`
    - `figsize=(10, 8)`
    - `dpi=150`
  - 实现函数：
    - `calculate_smoothed_wind(uwnd, vwnd, sigma=3)`
    - `calculate_wind_speed(uwnd, vwnd)`
    - `rotate_vector_90(u, v)`
    - `compute_speed_advection(u_r, v_r, speed, latitude)`
    - `extract_jet_axis_points(adv_s, speed, u_r, v_r, longitude, latitude, speed_threshold)`
    - `adjust_line_direction(lines, uwnd, vwnd)`
    - `plot_lines_with_direction(lines, uwnd, vwnd, speed=None, fill=False, same_color=True, ax=None)`
    - `plot_jet_analysis(init_time=None, fc_hour=0, target_lev=850, source=DEFAULT_SOURCE, config=JET_CONFIG, create_plot=True)`
    - `get_multi_fc_jet_by_init_time(...)`
    - `update_latest_jet_outputs(...)`
    - `main(...)`
  - `plot_jet_analysis` 的最终绘图线条以以下逻辑为准：

    ```python
    adjusted_lines = adjust_line_direction(lines, uwnd, vwnd)
    lines_smooth = smooth_lines(adjusted_lines, smoothness=5)
    plot_lines_with_direction(lines_smooth, uwnd, vwnd, fill=False, same_color=True)
    ```

- 急流轴 JSON 输出：
  - 路径：
    - `data/{init_time}/jet_images/jet_{init_time}_{fc_hour}_{target_lev}hPa_ecmwf.png`
    - `data/{init_time}/jet_data/jet_{init_time}_{fc_hour}_{target_lev}hPa_ecmwf.json`
  - 顶层字段：
    - `init_time`
    - `fc_hour`
    - `target_lev`
    - `source`
    - `units`
    - `config`
    - `jet_axis_lines`
  - 每条急流轴包含：
    - `line_id`
    - `points`
    - `smoothed_points`
    - `attributes.region_box`
    - `attributes.length`
    - `attributes.avg_wind_speed`
    - `attributes.max_wind_speed`
  - 点坐标统一 JSON 为 `{"lat": ..., "lon": ...}`，即使内部算法使用 `[lon, lat]`。

- `trough.py` 调整：
  - 改为从 `weather_common.py` 导入共用函数。
  - 保留原有 `plot_trough_analysis`、`get_multi_fc_trough_by_init_time`、`main`、JSON 结构和输出路径。
  - 保留 `trough.format_fc_hour` 等导入后可访问的名称，兼容现有测试和调用方。

## Test Plan

- 新增 `tests/test_jet.py`：
  - 用小型确定性 `xarray.DataArray` 验证 `extract_jet_axis_points` 返回 `[lon, lat]` 点。
  - 验证 `adjust_line_direction` 会把逆风方向线段反转。
  - 验证 `build_jet_json` 或 `plot_jet_analysis` 输出字段包含 `jet_axis_lines`、`points`、`smoothed_points` 和属性字段。
  - mock `plot_jet_analysis`，验证 `get_multi_fc_jet_by_init_time` 在某个时效失败后默认继续处理后续时效。

- 回归检查：
  - `uv run python -m py_compile src/weather_common.py src/trough.py src/jet.py`
  - `uv run python -m unittest`
  - 不依赖 live THREDDS 的单元测试只使用合成数据或 mock。

## Assumptions

- 默认输出范围采用用户确认的“沿用多层”：`TARGET_LEV_LIST`，调用方仍可传入 `[850]` 只生成低空急流。
- 这次只规划后端 Python 数据与图片输出，不接入 `vis_web` 前端。
- 不修改 notebook；`src/jet_v2.ipynb` 作为算法来源保留。
- 不新增依赖，使用现有 `numpy`、`scipy`、`xarray`、`cartopy`、`matplotlib`。
