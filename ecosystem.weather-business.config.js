const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const logDir = path.join(projectRoot, 'logs');
const cacheBase = process.env.XDG_CACHE_HOME
  ? path.join(process.env.XDG_CACHE_HOME, 'weather-system-identification')
  : path.join(process.env.HOME || projectRoot, '.cache', 'weather-system-identification');
const xdgRuntimeDir = path.join(cacheBase, 'xdg-runtime');
const uvCacheDir = path.join(cacheBase, 'uv-cache');
// 热盘（本地 SSD）：生成任务直接写这里。默认值须与 nginx 的 `root /srv/weather/hot`
// 加上 /data 子目录一致，即 /srv/weather/hot/data。
const outputRoot = process.env.WEATHER_OUTPUT_ROOT || '/srv/weather/hot/data';
// 用 path.posix：这是服务器上的 Linux 路径，在 Windows 上校验配置时
// path.join 会把分隔符转成反斜杠，产出 \srv\weather\... 这种错误路径。
const productsRoot = process.env.WEATHER_PRODUCTS_ROOT || path.posix.join(outputRoot, 'products');
// 冷盘（NFS）：超过保留期的时次迁移到这里，由 nginx 在热盘未命中时回落。
// 置空则不启用归档。
const coldRoot = process.env.WEATHER_COLD_ROOT || '/data/weather_vis';
const hotRetentionDays = process.env.WEATHER_HOT_RETENTION_DAYS || '7';
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
  WEATHER_COLD_ROOT: coldRoot,
  WEATHER_HOT_RETENTION_DAYS: hotRetentionDays,
};

module.exports = {
  apps: [
    {
      name: 'weather-draw-schedule',
      script: 'bash',
      args: [
        '-lc',
        uvPythonCommand(
          `src/draw_schedule.py --run-immediately`
          + (coldRoot
            ? ` --archive-cold-root "${coldRoot}"`
              + ` --archive-hot-root "${outputRoot}"`
              + ` --archive-retention-days ${hotRetentionDays}`
            : '')
          + ` --output "${productsRoot}"`,
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
    {
      // Web Push 订阅服务（Node/Express）：下发 VAPID 公钥、收订阅/退订。nginx 反代 /api/ 到此端口。
      name: 'weather-push-server',
      script: 'server.js',
      cwd: path.join(projectRoot, 'server'),
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: path.join(logDir, 'weather-push-server.out.log'),
      error_file: path.join(logDir, 'weather-push-server.err.log'),
      env: commonEnv,
    },
    {
      // 独立的 30 分钟轮询（Node）：发现新起报时次即推送一次（与绘图流水线解耦）。
      name: 'weather-push-schedule',
      script: 'pushSchedule.js',
      args: '--run-immediately --interval-minutes 30',
      cwd: path.join(projectRoot, 'server'),
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: path.join(logDir, 'weather-push-schedule.out.log'),
      error_file: path.join(logDir, 'weather-push-schedule.err.log'),
      env: commonEnv,
    },
  ],
};
