import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderMarkdown, prefixDocumentIds } from './markdown.js'
import { documentMetadata } from './public-content.js'
const manifest=JSON.parse(fs.readFileSync('content/manifest.json','utf8'))
describe('maintained customer tutorials',()=>{
 for(const item of manifest.documents) it(`${item.slug}: structured, linkable and valid examples`,()=>{
   const source=fs.readFileSync('content/'+item.file,'utf8')
   const {html}=renderMarkdown(source)
   const prefixed=prefixDocumentIds(html,item.slug)
   expect(source).toContain('::: support ')
   expect(source).toContain('## 常见问题')
   expect(source).not.toMatch(/^# /m)
   expect(documentMetadata(html).summary.length).toBeGreaterThan(15)
   const ids=[...prefixed.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1])
   expect(new Set(ids).size).toBe(ids.length)
   for(const match of source.matchAll(/```json\n([\s\S]*?)```/g)) expect(()=>JSON.parse(match[1])).not.toThrow()
   for(const match of source.matchAll(/\]\(\/docs\/([^\s)#]+)/g)) expect(manifest.documents.some((doc:{slug:string})=>doc.slug===match[1])).toBe(true)
   expect(prefixed).not.toContain('<script')
 })
})

const reference=JSON.parse(fs.readFileSync('tests/fixtures/tutorial-reference.json','utf8'))
const readTutorial=(file:string)=>fs.readFileSync('content/'+file,'utf8')
describe('customer-requested tutorial priorities',()=>{
 for(const item of manifest.documents) it(`${item.slug}: keeps every original image directly in the article`,()=>{
  const source=readTutorial(item.file)
  const html=renderMarkdown(source).html
  for(const url of reference.images[item.slug]) expect(html).toContain(`src="${url}"`)
  expect(source).not.toContain('nano ')
  const prose=source.replace(/^```[^\n]*\n[\s\S]*?^```/gm,'')
  expect(prose).toContain('::: support 微信技术支持')
  expect(prose).not.toMatch(/请勿发送密钥|不要发送密钥|不会显示密钥|无需打开编辑器/)
  expect(prose).not.toContain('遇到问题可扫码联系，点击二维码放大')
 })
 for(const platform of ['windows','mac']) it(`${platform}: desktop Claude comes before Code settings with original configuration`,()=>{
  const source=readTutorial(`${platform}-install-claude.md`)
  const desktop=source.indexOf('## 3. 配置 Claude 桌面客户端')
  const settings=source.indexOf('## 4. VS Code / CLI：配置 settings.json')
  expect(desktop).toBeGreaterThan(0)
  expect(settings).toBeGreaterThan(desktop)
  const desktopSteps=source.slice(desktop,settings)
  for(const image of ['4485f6d5-8c41-4fc4-9620-d3ebaac0d7b9','9b58598e-0d9f-4f6a-bda0-035adf3e7139','b0793545-7d9b-4613-9ad1-90bb5dafa293','91950017-e89a-40ae-8430-5df7ebdc35d0']) expect(desktopSteps).toContain(image)
  expect(desktopSteps).not.toContain('settings.json')
  expect(source).toContain('`settings.json` 用于 VS Code 中的 Claude Code 插件或 Claude Code CLI')
  if(platform==='mac') expect(source.match(/```bash\n([\s\S]*?)```/)?.[1].trim()).toBe(reference.claudeMacCommand)
  else expect(JSON.parse(source.match(/```json\n([\s\S]*?)```/)![1])).toEqual(reference.claudeSettings)
 })
 it('preserves the original Codex TOML fields and the full universal model configuration',()=>{
  const win=readTutorial('windows-install-codex.md')
  const mac=readTutorial('mac-install-codex.md')
  expect(win.match(/```toml\n([\s\S]*?)```/)?.[1].trim()).toBe(reference.codexToml)
  expect(mac.match(/cat > "\$codex_dir\/config.toml" <<'EOF'\n([\s\S]*?)\nEOF/)?.[1]).toBe(reference.codexToml)
  const universal=readTutorial('universal-api-access.md')
  expect(JSON.parse(universal.match(/```json\n([\s\S]*?)```/)![1])).toEqual(reference.universalSettings)
 })
})
