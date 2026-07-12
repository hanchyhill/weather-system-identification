import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const dataRoot = path.join(repoRoot, 'data')

function localDataPlugin() {
  return {
    name: 'weather-local-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const rawUrl = decodeURIComponent(req.url || '/')
        const relativePath = rawUrl.split('?')[0].replace(/^\/+/, '')
        const resolvedPath = path.resolve(dataRoot, relativePath)
        const dataRelativePath = path.relative(dataRoot, resolvedPath)

        if (dataRelativePath.startsWith('..') || path.isAbsolute(dataRelativePath)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }

        fs.stat(resolvedPath, (statError, stat) => {
          if (statError || !stat.isFile()) {
            next()
            return
          }

          const ext = path.extname(resolvedPath).toLowerCase()
          const contentType = {
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml; charset=utf-8'
          }[ext] || 'application/octet-stream'

          res.setHeader('Content-Type', contentType)
          fs.createReadStream(resolvedPath).pipe(res)
        })
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), localDataPlugin()],
  server: {
    fs: {
      allow: [repoRoot]
    },
    // 开发环境把 /api 转发到本地 push 后端（node server/server.js）。
    // 端口须与 server/.env 的 WEATHER_PUSH_PORT 一致；生产由 nginx 反代，无需此项。
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:49173',
        changeOrigin: true
      }
    }
  }
})
