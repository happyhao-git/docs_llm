import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import { and, eq, gt, sql } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config, isProduction } from '../config.js'
import { db } from '../db/client.js'
import { adminSessions, adminUsers } from '../db/schema.js'

const SESSION_COOKIE = 'docs_session'
const CSRF_COOKIE = 'docs_csrf'

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const token = (bytes = 32) => randomBytes(bytes).toString('base64url')

const cookieOptions = {
  path: '/',
  secure: isProduction,
  sameSite: 'strict' as const
}

export async function ensureBootstrapAdmin() {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(adminUsers)
  if (Number(row.count) > 0) return

  const { username, password } = config.bootstrapAdmin
  if (!username || password.length < 12) {
    throw new Error('ADMIN_USERNAME and an ADMIN_PASSWORD of at least 12 characters are required for first startup.')
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  await db.insert(adminUsers).values({ username, passwordHash })
}

export async function createSession(reply: FastifyReply, userId: number) {
  const sessionToken = token()
  const csrfToken = token(24)
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000)
  await db.insert(adminSessions).values({ tokenHash: hashToken(sessionToken), userId, expiresAt })
  reply.setCookie(SESSION_COOKIE, sessionToken, { ...cookieOptions, httpOnly: true, expires: expiresAt })
  reply.setCookie(CSRF_COOKIE, csrfToken, { ...cookieOptions, httpOnly: false, expires: expiresAt })
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const sessionToken = request.cookies[SESSION_COOKIE]
  if (sessionToken) {
    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(sessionToken)))
  }
  reply.clearCookie(SESSION_COOKIE, cookieOptions)
  reply.clearCookie(CSRF_COOKIE, cookieOptions)
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const sessionToken = request.cookies[SESSION_COOKIE]
  if (!sessionToken) return reply.code(401).send({ error: '请先登录' })

  const [session] = await db.select({
    id: adminUsers.id,
    username: adminUsers.username
  })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.userId))
    .where(and(
      eq(adminSessions.tokenHash, hashToken(sessionToken)),
      gt(adminSessions.expiresAt, new Date())
    ))
    .limit(1)

  if (!session) {
    reply.clearCookie(SESSION_COOKIE, cookieOptions)
    return reply.code(401).send({ error: '登录已过期' })
  }
  request.admin = session
}

export async function verifyCsrf(request: FastifyRequest, reply: FastifyReply) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
  const cookie = request.cookies[CSRF_COOKIE] ?? ''
  const header = String(request.headers['x-csrf-token'] ?? '')
  if (!cookie || !header) return reply.code(403).send({ error: '安全校验失败，请刷新后重试' })
  const cookieBuffer = Buffer.from(cookie)
  const headerBuffer = Buffer.from(header)
  if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer)) {
    return reply.code(403).send({ error: '安全校验失败，请刷新后重试' })
  }

  const origin = request.headers.origin
  if (origin && origin !== config.appOrigin && !origin.startsWith('http://127.0.0.1:')) {
    return reply.code(403).send({ error: '请求来源无效' })
  }
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}
