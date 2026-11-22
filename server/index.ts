import { access } from 'node:fs/promises'
import path from 'node:path'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { config, isProduction } from './config.js'
import { checkDatabase, pool } from './db/client.js'
import { migrate } from './db/migrate.js'
import { ensureBootstrapAdmin } from './lib/auth.js'
import { adminRoutes } from './routes/admin.js'
import { publicRoutes } from './routes/public.js'
import { modelRoutes } from './routes/models.js'
import { ModelCatalogService } from './models/service.js'
const modelCatalog = new ModelCatalogService(pool)

const app = Fastify({
  logger: {
    level: isProduction ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie']
  },
  trustProxy: true,
  bodyLimit: 2_100_000
})

await app.register(cookie)
await app.register(rateLimit, { global: false })
await app.register(multipart, { limits: { files: 1, fileSize: config.maxUploadBytes } })
await app.register(helmet, {
  frameguard: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'", ...config.frameAncestors]
    }
  }
})

app.get('/healthz', async () => {
  await checkDatabase()
  return { status: 'ok' }
})
await app.register(publicRoutes, { prefix: '/api/public' })
await app.register(adminRoutes, { prefix: '/api/admin' })
await app.register(modelRoutes(modelCatalog), { prefix: '/api' })

const uploadRoot = config.uploadDir
await app.register(fastifyStatic, {
  root: uploadRoot,
  prefix: '/uploads/',
  decorateReply: false,
  cacheControl: true,
  maxAge: '30d',
  immutable: true
})

const clientRoot = path.resolve('dist/client')
let hasClientBuild = true
try {
  await access(path.join(clientRoot, 'index.html'))
} catch {
  hasClientBuild = false
}

if (hasClientBuild) {
  await app.register(fastifyStatic, {
    root: clientRoot, prefix: '/', decorateReply: true,
    setHeaders(response, filePath) {
      // Vite fingerprints these filenames; entry HTML must revalidate to pick up deployments.
      const versionedImage = /\.(svg|ico|png|webmanifest)$/.test(filePath) && /[?&]v=[a-zA-Z0-9_-]+(?:&|$)/.test(response.request.url)
      if (filePath.startsWith(path.join(clientRoot, 'assets') + path.sep) || versionedImage) response.header('Cache-Control', 'public, max-age=31536000, immutable')
      else if (filePath.endsWith('.html')) response.header('Cache-Control', 'no-cache, no-transform')
    }
  })
}

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: '提交内容格式不正确', issues: error.issues })
  }
  const appError = error as Error & { statusCode?: number }
  const statusCode = typeof appError.statusCode === 'number' ? appError.statusCode : 500
  if (statusCode >= 500) request.log.error(appError)
  return reply.code(statusCode).send({ error: statusCode >= 500 ? '服务器处理请求时发生错误' : appError.message })
})

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/') || request.url.startsWith('/uploads/') || request.url === '/healthz') {
    return reply.code(404).send({ error: '资源不存在' })
  }
  if (hasClientBuild && request.method === 'GET') return reply.sendFile('index.html')
  return reply.code(404).send({ error: '前端尚未构建' })
})

async function start() {
  await migrate(pool)
  await ensureBootstrapAdmin()
  await modelCatalog.start().catch(() => app.log.warn('Model catalog unavailable; documentation remains accessible'))
  await app.listen({ host: config.host, port: config.port })
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down docs application')
  await app.close()
  await modelCatalog.close()
  await pool.end()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start().catch((error) => {
  app.log.fatal(error)
  process.exit(1)
})
