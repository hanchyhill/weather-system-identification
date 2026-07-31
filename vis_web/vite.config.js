import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const dataRoot = path.join(repoRoot, 'data')
const mapDataRoot = path.join(__dirname, 'src', 'source')

const staticMapFiles = new Map([
  ['110m.json', path.join(mapDataRoot, '110m.json')],
  ['bou2_4l.topo.simplify.json', path.join(mapDataRoot, 'bou2_4l.topo.simplify.json')]
])

// 设为线上地址（如 https://nwp.gdmo.gq）后，/data 改为反代到该服务器，
// 便于在本地改代码、直接用生产数据量级复现下载性能问题。
const remoteDataOrigin = process.env.WEATHER_REMOTE_DATA || ''

function localDataPlugin() {
  return {
    name: 'weather-local-data',
    configureServer(server) {
      // 反代模式下不注册本地 /data 中间件，请求全部交给 server.proxy。
      if (!remoteDataOrigin) server.middlewares.use('/data', (req, res, next) => {
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

      // 生产环境由 generateBundle 输出这些文件；开发环境直接从源码目录读取，
      // 以保持 /map-data 路径在两种环境下一致。
      server.middlewares.use('/map-data', (req, res, next) => {
        const fileName = decodeURIComponent(req.url || '/').split('?')[0].replace(/^\/+/, '')
        const sourcePath = staticMapFiles.get(fileName)
        if (!sourcePath) {
          next()
          return
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        fs.createReadStream(sourcePath).pipe(res)
      })
    },
    generateBundle() {
      for (const [fileName, sourcePath] of staticMapFiles) {
        this.emitFile({
          type: 'asset',
          fileName: `map-data/${fileName}`,
          source: fs.readFileSync(sourcePath)
        })
      }
    }
  }
}

export default defineConfig({
  plugins: [vue(), localDataPlugin()],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Naive UI 的组件可按顶层目录安全拆分；将其合为一个 vendor 包仍会超过
          // Vite 的 500 kB 告警阈值，且不利于缓存与并行下载。
          const naiveComponent = id.match(/[\\/]naive-ui[\\/]es[\\/]([^\\/]+)/)?.[1]
          if (naiveComponent) return `naive-${naiveComponent}`
          if (id.includes('lucide-vue-next')) return 'icons'
          if (id.includes('d3') || id.includes('topojson-client')) return 'map-libs'
          if (id.includes('vue') || id.includes('pinia')) return 'vue-vendor'
        }
      }
    }
  },
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
      },
      // WEATHER_REMOTE_DATA=https://nwp.gdmo.gq pnpm dev
      ...(remoteDataOrigin
        ? {
            '/data': {
              target: remoteDataOrigin,
              changeOrigin: true,
              secure: false
            }
          }
        : {})
    }
  }
})
