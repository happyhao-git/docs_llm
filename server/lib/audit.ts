import { db } from '../db/client.js'
import { auditLogs } from '../db/schema.js'

export async function audit(adminId: number, action: string, targetType: string, targetId?: string | number, details?: unknown) {
  await db.insert(auditLogs).values({
    adminId,
    action,
    targetType,
    targetId: targetId === undefined ? null : String(targetId),
    details: details === undefined ? null : JSON.stringify(details)
  })
}
