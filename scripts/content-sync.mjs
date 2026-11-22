import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import mysql from 'mysql2/promise'

const [command, target, ...flags] = process.argv.slice(2)
if (!['export', 'import'].includes(command) || !target) throw new Error('Usage: node scripts/content-sync.mjs export <directory> | import <manifest.json> [--apply]')
const connection = await mysql.createConnection({ host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD ?? '', database: process.env.DB_NAME, charset: 'utf8mb4' })
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const docHash = (d) => hash([d.group_id,d.title,d.nav_label,d.slug,d.markdown,d.sort_order,d.is_visible])
const groupHash = (g) => hash([g.id,g.name,g.anchor,g.sort_order,g.is_visible])
try {
  await connection.beginTransaction()
  // Use the publication mutex, then lock draft rows, so publishing cannot see a partial import.
  await connection.query('SELECT * FROM site_state WHERE id = 1 FOR UPDATE')
  const [groups] = await connection.query('SELECT * FROM nav_groups ORDER BY id FOR UPDATE')
  const [documents] = await connection.query('SELECT * FROM documents ORDER BY id FOR UPDATE')
  if (command === 'export') {
    await fs.mkdir(target, {recursive:true, mode:0o700})
    const manifest = { groups: groups.map(g=>({id:g.id,name:g.name,anchor:g.anchor,sortOrder:g.sort_order,isVisible:!!g.is_visible,baselineHash:groupHash(g)})), documents:[] }
    for (const doc of documents) {
      const file = `document-${doc.id}.md`
      await fs.writeFile(path.join(target,file),doc.markdown,{mode:0o600})
      manifest.documents.push({id:doc.id,slug:doc.slug,title:doc.title,navLabel:doc.nav_label,group:groups.find(g=>g.id===doc.group_id).anchor,file,sortOrder:doc.sort_order,isVisible:!!doc.is_visible,baselineHash:docHash(doc)})
    }
    await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
    await connection.rollback()
    console.log(JSON.stringify({exported:documents.length,directory:target}))
  } else {
    const manifest = JSON.parse(await fs.readFile(target,'utf8'))
    const base = path.dirname(path.resolve(target))
    if (!Array.isArray(manifest.documents) || !Array.isArray(manifest.groups)) throw new Error('Invalid content manifest')
    const ids = new Set(), slugs = new Set()
    const incoming = []
    for (const item of manifest.documents) {
      if (ids.has(item.id) || slugs.has(item.slug)) throw new Error('Duplicate document in manifest')
      ids.add(item.id); slugs.add(item.slug)
      const original = documents.find(d=>d.id===item.id && d.slug===item.slug)
      if (!original || docHash(original)!==item.baselineHash) throw new Error(`Draft changed since export: ${item.slug}. Export and merge the current draft before importing.`)
      const filename = path.resolve(base,item.file)
      if (!filename.startsWith(base+path.sep)) throw new Error('Content file must be inside manifest directory')
      const markdown = await fs.readFile(filename,'utf8')
      if (!markdown.trim() || Buffer.byteLength(markdown)>2_000_000) throw new Error(`Invalid content: ${item.slug}`)
      incoming.push({item,markdown,original})
    }
    const groupIds = new Map()
    for (const [index,item] of manifest.groups.entries()) {
      const existing = item.id ? groups.find(g=>g.id===item.id) : groups.find(g=>g.anchor===item.anchor)
      if (existing) {
        if (!item.baselineHash || item.baselineHash!==groupHash(existing)) throw new Error(`Navigation changed since export: ${item.anchor}`)
        groupIds.set(item.anchor,existing.id)
        await connection.execute('UPDATE nav_groups SET name=?, anchor=?, sort_order=?, is_visible=?, updated_at=NOW() WHERE id=?',[item.name,item.anchor,item.sortOrder??index,item.isVisible===false?0:1,existing.id])
      } else {
        if (item.id) throw new Error(`Missing source group: ${item.id}`)
        const [result] = await connection.execute('INSERT INTO nav_groups (name,anchor,sort_order,is_visible,created_at,updated_at) VALUES (?,?,?,?,NOW(),NOW())',[item.name,item.anchor,item.sortOrder??index,item.isVisible===false?0:1])
        groupIds.set(item.anchor,result.insertId)
      }
    }
    for (const {item,markdown,original} of incoming) {
      const groupId=groupIds.get(item.group)
      if (!groupId) throw new Error(`Unknown target group: ${item.group}`)
      await connection.execute('UPDATE documents SET group_id=?,title=?,nav_label=?,markdown=?,sort_order=?,is_visible=?,updated_at=NOW() WHERE id=?',[groupId,item.title,item.navLabel,markdown,item.sortOrder,item.isVisible===undefined?original.is_visible:Number(item.isVisible),item.id])
    }
    if (flags.includes('--apply')) await connection.commit()
    else await connection.rollback()
    console.log(JSON.stringify({mode:flags.includes('--apply')?'applied to drafts':'dry run rolled back',documents:incoming.map(d=>d.item.slug),groups:[...groupIds.keys()],published:false}))
  }
} catch(error) {await connection.rollback(); throw error} finally {await connection.end()}
