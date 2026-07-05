const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const logDir = path.join(projectRoot, 'logs');
const cacheBase = process.env.XDG_CACHE_HOME
  ? path.join(process.env.XDG_CACHE_HOME, 'weather-system-identification')
  : path.join(process.env.HOME || projectRoot, '.cache', 'weather-system-identification');
const xdgRuntimeDir = path.join(cacheBase, 'xdg-runtime');
const uvCacheDir = path.join(cacheBase, 'uv-cache');
const outputRoot = process.env.WEATHER_OUTPUT_ROOT || '/data/weather_vis';
const productsRoot = process.env.WEATHER_PRODUCTS_ROOT || path.join(outputRoot, 'products');
const home = process.env.HOME || '';
const pathPrefix = home ? `${home}/.local/bin:` : '';
const bashPath = pathPrefix ? `export PATH="${pathPrefix}$PATH"; ` : '';

function uvPythonCommand(scriptArgs) {
  return `${bashPath}cd "${projectRoot}" && exec uv run python ${scriptArgs}`;
}

fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(xdgRuntimeDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(uvCacheDir, { recursive: true });
fs.chmodSync(xdgRuntimeDir, 0o700);

const commonEnv = {
  PYTHONUNBUFFERED: '1',
  TZ: 'Asia/Shanghai',
  XDG_RUNTIME_DIR: xdgRuntimeDir,
  UV_CACHE_DIR: uvCacheDir,
  WEATHER_OUTPUT_ROOT: outputRoot,
  WEATHER_PRODUCTS_ROOT: productsRoot,
};

module.exports = {
  apps: [
    {
      name: 'weather-draw-schedule',
      script: 'bash',
      args: [
        '-lc',
        uvPythonCommand(
          `src/draw_schedule.py --run-immediately --output "${productsRoot}"`,
        ),
      ],
      cwd: projectRoot,
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: path.join(logDir, 'weather-draw-schedule.out.log'),
      error_file: path.join(logDir, 'weather-draw-schedule.err.log'),
      env: commonEnv,
    },
    {
      name: 'weather-trough',
      script: 'bash',
      args: [
        '-lc',
        uvPythonCommand(`src/schedule.py --output-root "${outputRoot}"`),
      ],
      cwd: projectRoot,
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: path.join(logDir, 'weather-trough.out.log'),
      error_file: path.join(logDir, 'weather-trough.err.log'),
      env: commonEnv,
    },
  ],
};
