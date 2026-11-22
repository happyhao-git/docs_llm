import mysql from 'mysql2/promise'
import argon2 from 'argon2'
import fs from 'node:fs/promises'
// Deliberately fixed to the disposable database; cannot inherit production DB settings.
const db=await mysql.createConnection({host:'127.0.0.1',port:13367,user:'root',password:'',database:'docs_test'})
const backup=JSON.parse(await fs.readFile(process.argv[2],'utf8'))
try{
 for(const table of ['publication_documents','publication_groups','publications','documents','nav_groups','media_assets','audit_logs'])await db.query(`DELETE FROM ${table}`)
 for(const table of ['nav_groups','documents','media_assets'])for(const row of backup[table]){
  const keys=Object.keys(row), values=keys.map(k=>/_at$/.test(k)&&row[k]?new Date(row[k]):row[k]);
  await db.execute(`INSERT INTO ${table} (${keys.map(k=>'`'+k+'`').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,values)
 }
 const s=backup.site_settings[0];await db.execute('UPDATE site_settings SET site_name=?,subtitle=?,console_url=?,accent_color=? WHERE id=1',[s.site_name,s.subtitle,s.console_url,s.accent_color])
 await db.query('UPDATE site_state SET active_publication_id=NULL WHERE id=1')
 const password=await argon2.hash('docs-verification-only');await db.execute('UPDATE admin_users SET username=?, password_hash=? WHERE id=1',['verification',password])
 console.log('Disposable database seeded with six current drafts and media metadata')
}finally{await db.end()}
