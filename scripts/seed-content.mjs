import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { prefixDocumentIds, renderMarkdown } from '../dist/server/lib/markdown.js'

const manifest = JSON.parse(await readFile(new URL('../content/manifest.json', import.meta.url), 'utf8'))
const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME,
  charset: 'utf8mb4'
})

try {
  const [existing] = await connection.query('SELECT COUNT(*) AS count FROM nav_groups')
  if (Number(existing[0].count) > 0) throw new Error('目标内容库已有导航分组，停止初始化以避免覆盖数据。')

  const [admins] = await connection.query('SELECT id FROM admin_users ORDER BY id LIMIT 1')
  if (!admins.length) throw new Error('目标内容库没有管理员，请先启动服务完成管理员初始化。')
  const adminId = admins[0].id
  const siteName = process.env.DEFAULT_SITE_NAME ?? 'AiLink 文档'
  const subtitle = process.env.DEFAULT_SITE_SUBTITLE ?? 'AI API 接入与使用指南'
  const consoleUrl = process.env.DEFAULT_CONSOLE_URL ?? 'https://ai.ailink1.com'
  const accentColor = process.env.DEFAULT_ACCENT_COLOR ?? '#6d4aff'

  await connection.beginTransaction()
  const groupIds = new Map()
  for (const group of manifest.groups) {
    await connection.execute(
      'INSERT INTO nav_groups (id,name,anchor,sort_order,is_visible) VALUES (?,?,?,?,?)',
      [group.id, group.name, group.anchor, group.sortOrder ?? 0, group.isVisible === false ? 0 : 1]
    )
    groupIds.set(group.anchor, group.id)
  }

  const documents = []
  for (const item of manifest.documents) {
    const markdown = await readFile(path.resolve('content', item.file), 'utf8')
    const groupId = groupIds.get(item.group)
    if (!groupId) throw new Error(`文档分组不存在：${item.group}`)
    await connection.execute(
      'INSERT INTO documents (id,group_id,title,nav_label,slug,markdown,sort_order,is_visible) VALUES (?,?,?,?,?,?,?,?)',
      [item.id, groupId, item.title, item.navLabel, item.slug, markdown, item.sortOrder ?? 0, item.isVisible === false ? 0 : 1]
    )
    documents.push({ ...item, markdown, groupId })
  }

  await connection.execute(
    `INSERT INTO site_settings (id,site_name,subtitle,console_url,accent_color)
     VALUES (1,?,?,?,?)
     ON DUPLICATE KEY UPDATE site_name=VALUES(site_name),subtitle=VALUES(subtitle),console_url=VALUES(console_url),accent_color=VALUES(accent_color)`,
    [siteName, subtitle, consoleUrl, accentColor]
  )

  const publishedAt = new Date()
  const [publication] = await connection.execute(
    'INSERT INTO publications (site_name,subtitle,console_url,accent_color,document_count,created_by,created_at) VALUES (?,?,?,?,?,?,?)',
    [siteName, subtitle, consoleUrl, accentColor, documents.length, adminId, publishedAt]
  )
  const publicationId = publication.insertId
  const publicationGroups = new Map()
  for (const [groupIndex, group] of manifest.groups.entries()) {
    const [created] = await connection.execute(
      'INSERT INTO publication_groups (publication_id,source_group_id,name,anchor,sort_order) VALUES (?,?,?,?,?)',
      [publicationId, group.id, group.name, group.anchor, groupIndex]
    )
    publicationGroups.set(group.anchor, created.insertId)
  }
  for (const doc of documents) {
    const rendered = renderMarkdown(doc.markdown)
    await connection.execute(
      `INSERT INTO publication_documents
       (publication_id,publication_group_id,source_document_id,title,nav_label,slug,markdown,rendered_html,search_text,content_updated_at,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [publicationId, publicationGroups.get(doc.group), doc.id, doc.title, doc.navLabel, doc.slug, doc.markdown,
        prefixDocumentIds(rendered.html, doc.slug), rendered.searchText, publishedAt, doc.sortOrder ?? 0]
    )
  }
  await connection.execute('UPDATE site_state SET active_publication_id=?,updated_at=? WHERE id=1', [publicationId, publishedAt])
  await connection.commit()
  console.log(JSON.stringify({ seeded: true, publicationId, groups: manifest.groups.length, documents: documents.length }))
} catch (error) {
  await connection.rollback().catch(() => undefined)
  throw error
} finally {
  await connection.end()
}
