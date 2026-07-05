#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="${PROJECT_ROOT}/vis_web"
PY_CONFIG="${PROJECT_ROOT}/ecosystem.weather-business.config.js"
WEB_CONFIG="${WEB_ROOT}/ecosystem.config.cjs"

export WEATHER_OUTPUT_ROOT="${WEATHER_OUTPUT_ROOT:-/data/weather_vis}"
export WEATHER_PRODUCTS_ROOT="${WEATHER_PRODUCTS_ROOT:-${WEATHER_OUTPUT_ROOT}/products}"
export TROUGH_INTERVAL_SECONDS="${TROUGH_INTERVAL_SECONDS:-1800}"

ensure_uv() {
  if command -v uv >/dev/null 2>&1; then
    return
  fi

  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="${HOME}/.local/bin:${PATH}"
}

ensure_node_tools() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install pm2/pnpm and run the frontend." >&2
    exit 1
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      corepack enable
      corepack prepare pnpm@latest --activate
    else
      npm install -g pnpm
    fi
  fi
}

mkdir -p "${WEATHER_OUTPUT_ROOT}" "${WEATHER_PRODUCTS_ROOT}" "${PROJECT_ROOT}/logs"

ensure_uv
ensure_node_tools

cd "${PROJECT_ROOT}"
uv sync --frozen

cd "${WEB_ROOT}"
pnpm install --frozen-lockfile
pnpm build

cd "${PROJECT_ROOT}"
pm2 startOrReload "${PY_CONFIG}" --update-env
pm2 startOrReload "${WEB_CONFIG}" --update-env
pm2 save
pm2 status weather-draw-schedule weather-trough weather-vis-web
