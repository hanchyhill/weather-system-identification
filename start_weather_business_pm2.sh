#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="${PROJECT_ROOT}/vis_web"
SERVER_ROOT="${PROJECT_ROOT}/server"
PY_CONFIG="${PROJECT_ROOT}/ecosystem.weather-business.config.js"

export WEATHER_OUTPUT_ROOT="${WEATHER_OUTPUT_ROOT:-/data/weather_vis}"
export WEATHER_PRODUCTS_ROOT="${WEATHER_PRODUCTS_ROOT:-${WEATHER_OUTPUT_ROOT}/products}"

# 默认不在服务器上构建前端：dist/ 应在本地测试环境构建好后上传到服务器。
# 如需在本机构建，运行前设置 BUILD_FRONTEND=1。
BUILD_FRONTEND="${BUILD_FRONTEND:-0}"

ensure_uv() {
  if command -v uv >/dev/null 2>&1; then
    return
  fi

  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="${HOME}/.local/bin:${PATH}"
}

ensure_node_tools() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install pm2/pnpm and run the push server." >&2
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
export PATH="${HOME}/.local/bin:${PATH}"

ensure_node_tools

cd "${PROJECT_ROOT}"
uv sync --frozen

# 前端：默认跳过构建（dist/ 由本地构建后上传），仅校验产物是否就位。
if [ "${BUILD_FRONTEND}" = "1" ]; then
  cd "${WEB_ROOT}"
  pnpm install --frozen-lockfile
  pnpm build
else
  if [ ! -f "${WEB_ROOT}/dist/index.html" ]; then
    echo "警告：未发现 ${WEB_ROOT}/dist/index.html。" >&2
    echo "      默认不构建前端，请先在本地构建并上传 dist/（或用 BUILD_FRONTEND=1 在本机构建）。" >&2
  fi
fi

# 推送后端（Node）：安装依赖并在缺失时生成 VAPID 密钥（generateVapidKeys.js 幂等，已存在即跳过）。
cd "${SERVER_ROOT}"
if [ ! -f "${SERVER_ROOT}/.env" ]; then
  echo "提示：未发现 ${SERVER_ROOT}/.env，将使用默认配置（端口默认 49173）。" >&2
  echo "      建议 cp .env.example .env 并设置 WEATHER_VAPID_SUBJECT；" >&2
  echo "      WEATHER_PUSH_PORT 须与 nginx_nwp.conf 中 /api/ 反代端口（49173）一致。" >&2
fi
pnpm install --prod
node generateVapidKeys.js

cd "${PROJECT_ROOT}"
pm2 delete weather-draw-schedule 2>/dev/null || true
pm2 delete weather-trough 2>/dev/null || true
pm2 delete weather-vis-web 2>/dev/null || true
pm2 startOrReload "${PY_CONFIG}" --update-env
pm2 save
pm2 status weather-draw-schedule weather-trough weather-push-server weather-push-schedule
