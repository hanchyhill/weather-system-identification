const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const logDir = path.join(projectRoot, 'logs');

module.exports = {
  apps: [
    {
      name: 'weather-vis-web',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      out_file: path.join(logDir, 'weather-vis-web.out.log'),
      error_file: path.join(logDir, 'weather-vis-web.err.log'),
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3004,
        WEB_DIST_ROOT: process.env.WEB_DIST_ROOT || '/var/www/html/nwp_weather_system/vis_web/dist',
        WEATHER_OUTPUT_ROOT: process.env.WEATHER_OUTPUT_ROOT || '/data/weather_vis',
      },
    },
  ],
};
