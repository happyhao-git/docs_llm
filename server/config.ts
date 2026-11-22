import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config()

const intValue = (name: string, fallback: number) => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const listValue = (name: string, fallback: string[]) => {
  const values = (process.env[name] ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  return values.length ? values : fallback
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '127.0.0.1',
  port: intValue('PORT', 8090),
  appOrigin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173',
  defaultSite: {
    siteName: process.env.DEFAULT_SITE_NAME ?? 'Link API 文档',
    subtitle: process.env.DEFAULT_SITE_SUBTITLE ?? 'AI API 接入与使用指南',
    consoleUrl: process.env.DEFAULT_CONSOLE_URL ?? 'https://ai.gs88.shop',
    accentColor: process.env.DEFAULT_ACCENT_COLOR ?? '#6d4aff'
  },
  frameAncestors: listValue('FRAME_ANCESTORS', ['https://ai.gs88.shop']),
  database: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: intValue('DB_PORT', 3306),
    user: process.env.DB_USER ?? 'docs_llm',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'docs_llm'
  },
  bootstrapAdmin: {
    username: process.env.ADMIN_USERNAME ?? '',
    password: process.env.ADMIN_PASSWORD ?? ''
  },
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './data/uploads'),
  maxUploadBytes: intValue('MAX_UPLOAD_MB', 10) * 1024 * 1024,
  sessionDays: 7
}

export const isProduction = config.nodeEnv === 'production'
