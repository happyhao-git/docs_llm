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
  await connection.beginTransaction()
  const siteName = process.env.DEFAULT_SITE_NAME ?? 'AiLink 文档'
  const subtitle = process.env.DEFAULT_SITE_SUBTITLE ?? 'AI API 接入与使用指南'
  const consoleUrl = process.env.DEFAULT_CONSOLE_URL ?? 'https://ai.ailink1.com'
  const accentColor = process.env.DEFAULT_ACCENT_COLOR ?? '#6d4aff'
  await connection.execute(
    `UPDATE site_settings SET site_name=?, subtitle=?, console_url=?, accent_color=? WHERE id=1`,
    [siteName, subtitle, consoleUrl, accentColor]
  )

  const [stateRows] = await connection.query('SELECT active_publication_id AS id FROM site_state WHERE id=1 LIMIT 1')
  const publicationId = stateRows[0]?.id
  if (!publicationId) throw new Error('没有活动中的发布版本，停止同步。')
  await connection.execute(
    'UPDATE publications SET site_name=?, subtitle=?, console_url=?, accent_color=? WHERE id=?',
    [siteName, subtitle, consoleUrl, accentColor, publicationId]
  )

  let updated = 0
  for (const item of manifest.documents) {
    const markdown = await readFile(path.resolve('content', item.file), 'utf8')
    const rendered = renderMarkdown(markdown)
    const html = prefixDocumentIds(rendered.html, item.slug)
    const [docResult] = await connection.execute(
      'UPDATE documents SET markdown=?, title=?, nav_label=? WHERE id=? AND slug=?',
      [markdown, item.title, item.navLabel, item.id, item.slug]
    )
    const [publicationResult] = await connection.execute(
      `UPDATE publication_documents
       SET markdown=?, rendered_html=?, search_text=?, title=?, nav_label=?
       WHERE publication_id=? AND source_document_id=? AND slug=?`,
      [markdown, html, rendered.searchText, item.title, item.navLabel, publicationId, item.id, item.slug]
    )
    updated += Number(docResult.affectedRows) + Number(publicationResult.affectedRows)
  }
  await connection.commit()
  console.log(JSON.stringify({ synced: true, publicationId, documents: manifest.documents.length, rows: updated }))
} catch (error) {
  await connection.rollback().catch(() => undefined)
  throw error
} finally {
  await connection.end()
}
