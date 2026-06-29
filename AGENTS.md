# Repository Guidelines

## Project Structure & Module Organization

This repository contains Python and Jupyter workflows for weather system identification. Core analysis code lives in `src/`: `src/trough.py` contains reusable trough-detection functions, while `src/trough.ipynb` and `src/jet_v2.ipynb` are exploratory or runnable notebooks. Tropical cyclone locator work is under `src/ty-locator/` with notebooks such as `locator.ipynb` and `detect_TC_location.ipynb`. Input/output data should stay in `data/` or `demo/`; generated files such as `.nc`, `.png`, `.svg`, and PDFs are ignored by Git.

## Build, Test, and Development Commands

- `uv sync`: create or update the local environment from `pyproject.toml` and `uv.lock`.
- `uv run python -m py_compile src/trough.py`: quick syntax check for the Python module.
- `uv run jupyter notebook`: start Jupyter for the notebooks, if Jupyter is installed in the active environment.
- `uv add <package>`: add a runtime dependency and update the lockfile.

There is no package build target yet; keep runnable analysis in notebooks or importable functions in `src/*.py`.

## Coding Style & Naming Conventions

Use Python 3.10+ and follow PEP 8 conventions: 4-space indentation, `snake_case` for functions and variables, and clear module-level imports. Prefer small, importable functions in `.py` files, then call them from notebooks. Keep domain variables descriptive (`init_time`, `fc_hour`, `latitude`, `longitude`) and document expected units for meteorological quantities. Avoid committing machine-specific server paths unless they are configurable.

## Testing Guidelines

No automated test suite is currently present. For code changes, at minimum run `uv run python -m py_compile src/trough.py` and execute the affected notebook cells with a small or known dataset. When adding tests, place them under `tests/`, name files `test_*.py`, and prefer deterministic fixtures over live THREDDS data where possible.

## Commit & Pull Request Guidelines

Recent commits use imperative, descriptive messages such as `Add initial project structure...`. Keep the first line concise and explain the main behavior change. Pull requests should include a short summary, affected notebooks/modules, data requirements, and before/after plots or screenshots when visual output changes. Link related issues and note any external data servers needed to reproduce results.

## Security & Configuration Tips

Do not commit credentials, private endpoints, large datasets, or generated outputs. Keep `.env`, `.venv/`, NetCDF files, and rendered figures untracked as configured in `.gitignore`.
