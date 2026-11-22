import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { config } from '../config.js'
import * as schema from './schema.js'

export const pool = mysql.createPool({
  ...config.database,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 5,
  idleTimeout: 60_000,
  enableKeepAlive: true,
  charset: 'utf8mb4'
})

export const db = drizzle(pool, { schema, mode: 'default' })

export async function checkDatabase() {
  const connection = await pool.getConnection()
  try {
    await connection.ping()
  } finally {
    connection.release()
  }
}
