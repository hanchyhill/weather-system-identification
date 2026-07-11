# Repository Guidelines

## Project Structure & Module Organization

This repository identifies weather systems from ECMWF NetCDF forecast data and visualizes the resulting products. It has two main parts:

- `src/` contains Python workflows. `trough.py` and `jet.py` identify troughs and jet axes; `vortex_center.py`, `vortex_warm_core.py`, and `vortex_tracker.py` form the vortex pipeline; `vortex_workflow.py` is its orchestrator. Share helpers through `weather_common.py` and `vortex_common.py` rather than duplicating them.
- `src/draw/` generates SVG map tiles. Keep its tile projection, bounds, zoom scheme, and the frontend consumer in sync.
- `src/*.ipynb` and `src/ty-locator/` are exploratory or runnable notebooks; reusable production logic belongs in importable Python modules.
- `vis_web/` is the Vue 3/Vite frontend. Keep view-state logic in `src/composables/`, map utilities in `src/utils/`, and user-facing components in `src/components/`.
- `tests/` contains `unittest` test modules named `test_*.py`. Use mocked or temporary data instead of live THREDDS requests.
- `data/` and `demo/` hold local inputs and generated products. `ifs/` is an independent legacy GRIB/SQLite workflow; do not couple it to the `src/` THREDDS/JSON pipeline.

## Build, Test, and Development Commands

Python requires 3.10+ and is managed with `uv`; the frontend uses pnpm and the Node version in `.node-version`.

- `uv sync`: install or update the Python environment from `pyproject.toml` and `uv.lock`.
- `uv run python -m unittest discover`: run the Python test suite.
- `uv run python -m unittest tests.test_jet`: run one test module.
- `uv run python -m py_compile src/trough.py src/jet.py`: perform a quick syntax check on edited Python modules.
- `uv run python src/vortex_workflow.py --init-time YYYYMMDDHH`: run the complete vortex workflow. Individual trough, jet, and SVG workflows use the analogous scripts in `src/`.
- `uv run jupyter notebook`: start Jupyter when working with a notebook.
- `pnpm install`, then `pnpm dev` (from `vis_web/`): run the Vite frontend locally.
- `pnpm build` (from `vis_web/`): produce the frontend build in `vis_web/dist`.

The recognition workflows read an internal THREDDS service, so do not treat a failed end-to-end data request as a test failure when the service is unavailable. Use the test suite and mocked inputs for deterministic verification.

## Coding Style & Naming Conventions

Use Python 3.10+ with PEP 8: four-space indentation, `snake_case`, clear module imports, type hints where they clarify public interfaces, and concise docstrings on reusable functions. Keep domain names consistent: `init_time` is `YYYYMMDDHH`, `fc_hour` is a zero-padded forecast-hour string such as `006`, `target_lev`/`level` is hPa, and coordinate fields are `lat` and `lon`. State meteorological units explicitly.

Preserve data contracts. Internally some algorithms use `[lon, lat]`, but JSON point output must use `{\"lat\": ..., \"lon\": ...}`. Do not change the SVG tile layout or layer manifest without updating its frontend reader. Maintain the vortex pipeline's incremental behavior: existing artifacts are skipped, and downstream warm-core/tracking work runs only when new upstream products warrant it.

For frontend changes, use the existing Vue composition style, keep state changes within the established weather-view composable where appropriate, and avoid adding generated or vendored assets to source control.

## Testing Guidelines

Add or update deterministic `unittest` coverage for Python behavior changes, especially output JSON shape, coordinate order, path construction, and incremental workflow decisions. Prefer `tempfile.TemporaryDirectory` and `unittest.mock.patch` for file and remote-data boundaries. Run the relevant module test plus `unittest discover` when practical, and run `py_compile` for changed Python files.

For frontend changes, run `pnpm build` at minimum. Manually verify the affected map/control interaction with local data when it changes rendering, selection, tile loading, or screenshot behavior.

## Commit & Pull Request Guidelines

Use concise, imperative commit subjects that describe the behavior change. Keep unrelated user changes out of commits. Pull requests should state the affected pipeline or UI, data requirements, verification performed, and any changes to generated JSON/SVG contracts. Include before/after screenshots or plots for visible output changes, and note any required external data service or deployment configuration.

## Security & Configuration Tips

Do not commit credentials, private endpoints, local environment files, large data, or generated outputs. The `.gitignore` excludes NetCDF, image, SVG, PDF, `data/`, `demo/`, virtual environments, and `node_modules/`; keep them untracked. Output locations may differ between local and production environments, so use the repository's output-root helpers and supported environment variables rather than hard-coding machine-specific paths.
