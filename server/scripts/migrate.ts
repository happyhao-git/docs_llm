import { pool } from '../db/client.js'
import { migrate } from '../db/migrate.js'

await migrate(pool)
await pool.end()
console.log('Database migrations complete.')
