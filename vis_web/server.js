import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.resolve(process.env.WEB_DIST_ROOT || path.join(__dirname, 'dist'));
const dataRoot = path.resolve(
  process.env.WEATHER_OUTPUT_ROOT ||
    (process.platform === 'win32' ? path.join(repoRoot, 'data') : '/data/weather_vis')
);
const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3004', 10);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function safeResolve(root, requestPath) {
  const decodedPath = decodeURIComponent(requestPath.split('?')[0]);
  const relativePath = decodedPath.replace(/^\/+/, '');
  const resolvedPath = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, resolvedPath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return resolvedPath;
}

function sendFile(res, filePath, cacheControl = 'no-cache') {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cacheControl,
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

function handleDataRequest(req, res, pathname) {
  const dataPath = safeResolve(dataRoot, pathname.replace(/^\/data\/?/, ''));
  if (!dataPath) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  sendFile(res, dataPath, 'no-cache');
}

function handleStaticRequest(req, res, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const staticPath = safeResolve(distRoot, requestPath);

  if (!staticPath) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.stat(staticPath, (statError, stat) => {
    if (!statError && stat.isFile()) {
      const isAsset = requestPath.startsWith('/assets/');
      sendFile(res, staticPath, isAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
      return;
    }

    sendFile(res, path.join(distRoot, 'index.html'), 'no-cache');
  });
}

const server = http.createServer((req, res) => {
  if (!req.url || !['GET', 'HEAD'].includes(req.method || '')) {
    send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  if (url.pathname === '/data' || url.pathname.startsWith('/data/')) {
    handleDataRequest(req, res, url.pathname);
    return;
  }

  handleStaticRequest(req, res, url.pathname);
});

server.listen(port, host, () => {
  console.log(`weather vis server listening on http://${host}:${port}`);
  console.log(`dist root: ${distRoot}`);
  console.log(`data root: ${dataRoot}`);
});
