import { describe, expect, it } from 'vitest'
import { addImageDimensions, documentMetadata, searchDocuments } from './public-content.js'
const html='<p>First &amp; helpful summary.</p><h2 id="step">配置步骤</h2><p>配置 auth.json，排查权限。</p><h3 id="error">网络排错</h3><p>连接超时</p>'
const article = {slug:'guide',title:'安装指南',navLabel:'入门',html,searchText:'First & helpful summary. 配置步骤 配置 auth.json，排查权限。 网络排错 连接超时',...documentMetadata(html)}
describe('public article metadata and search',()=>{
 it('derives summary, outline and reading time from sanitized HTML',()=>{
  expect(article.summary).toBe('First & helpful summary.')
  expect(article.outline).toEqual([{id:'step',text:'配置步骤',level:2},{id:'error',text:'网络排错',level:3}])
  expect(article.readingMinutes).toBe(1)
 })
 it('ranks titles first and locates body matches in the corresponding section',()=>{
  const titleMatch={...article,slug:'auth',title:'auth.json 文件'}
  const results=searchDocuments([article,titleMatch],'auth.json')
  expect(results.map(r=>r.slug)).toEqual(['auth','guide'])
  expect(results[1]).toMatchObject({anchor:'step',heading:'配置步骤'})
  expect(searchDocuments([article],'连接超时')[0].anchor).toBe('error')
  expect(searchDocuments([article],'不存在')).toEqual([])
  expect(searchDocuments([article],'   ')).toEqual([])
  expect(searchDocuments([article],'权限 不存在')).toEqual([])
 })
 it('returns text rather than injected markup in search snippets',()=>{
  const attack={...article,html:'<h2 id="safe">章节</h2><p>&lt;img src=x&gt;</p>',searchText:'&lt;img src=x&gt;',outline:[{id:'safe',text:'章节',level:2}]}
  expect(searchDocuments([attack],'img')[0].snippet).toContain('<img src=x>')
 })
 it('adds known intrinsic dimensions and eagerly loads only the first image',()=>{
  const out=addImageDimensions('<img src="/a" loading="lazy" /><img src="/b" loading="lazy" />',new Map([['/a',{width:100,height:200}]]))
  expect(out).toContain('width="100" height="200"')
  expect(out.match(/loading="eager"/g)).toHaveLength(1)
  expect(out).toContain('src="/b" loading="lazy"')
 })
})
