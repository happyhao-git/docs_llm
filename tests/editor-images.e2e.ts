import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import sharp from 'sharp'
import { renderMarkdown } from '../server/lib/markdown'

// Serve the built editor with intercepted APIs; no production drafts or media are written.
let server: Server
let origin: string
let png: Buffer
const publicationStatus = { activePublicationId: 1, changes: { hasChanges: false, isFirstPublication: false,
  documentCount: 2, added: [], updated: [], removed: [], navigationChanged: false, settingsChanged: false } }

test.beforeAll(async () => {
  png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#6d4aff' } }).png().toBuffer()
  const root = resolve('dist/client')
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, 'http://localhost').pathname
      const file = resolve(root, pathname === '/admin' ? 'index.html' : `.${pathname}`)
      if (!file.startsWith(root + sep)) return response.writeHead(404).end()
      const body = await readFile(file)
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html')
      response.end(body)
    } catch { response.writeHead(404).end() }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing editor fixture port')
  origin = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())) })

async function editorFixture(page: Page) {
  const documents = [1, 2].map(id => ({ id, groupId: 1, title: `教程 ${id}`, navLabel: `教程 ${id}`,
    slug: `guide-${id}`, markdown: id === 1 ? '开头\n结尾' : '另一篇教程', sortOrder: id, isVisible: true,
    createdAt: '2026-11-13T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' }))
  const state = { uploads: [] as string[], saves: [] as { markdown: string }[], fail: false, hold: false, pending: [] as (() => Promise<void>)[] }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.context().addCookies([{ name: 'docs_csrf', value: 'fixture-csrf', url: origin }])
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname.startsWith('/uploads/')) return route.fulfill({ contentType: 'image/png', body: png })
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/admin/content') return json(route, {
      settings: { siteName: 'LinkAPI', subtitle: '', consoleUrl: 'https://example.invalid', accentColor: '#6d4aff' },
      activePublicationId: 1, publicationStatus,
      groups: [{ id: 1, name: '教程', anchor: 'guides', isVisible: true, sortOrder: 0, documents }]
    })
    if (url.pathname === '/api/admin/preview') return json(route, renderMarkdown(request.postDataJSON().markdown))
    if (url.pathname === '/api/admin/publication-status') return json(route, publicationStatus)
    if (url.pathname === '/api/admin/uploads') {
      expect(request.headers()['x-csrf-token']).toBe('fixture-csrf')
      state.uploads.push(request.postDataBuffer()!.toString())
      const number = state.uploads.length
      const finish = () => state.fail ? json(route, { error: '图片超过大小限制' }, 413) : json(route, { url: `/uploads/fixture-${number}.png` })
      if (state.hold) {
        await new Promise<void>(done => state.pending.push(async () => { await finish(); done() }))
        return
      }
      return finish()
    }
    if (/^\/api\/admin\/documents\/\d+$/.test(url.pathname) && request.method() === 'PUT') {
      state.saves.push(request.postDataJSON())
      return json(route, { slug: 'guide-1' })
    }
    return json(route, { error: 'Unexpected fixture request' }, 404)
  })
  await page.goto(`${origin}/admin`)
  const editor = page.getByRole('textbox', { name: 'Markdown 正文' })
  await expect(editor).toHaveValue('开头\n结尾')
  return { state, editor, errors }
}

async function pasteFiles(page: Page, names = ['截图.png']) {
  return page.getByRole('textbox', { name: 'Markdown 正文' }).evaluate((element, names) => {
    const data = new DataTransfer()
    for (const name of names) data.items.add(new File(['fixture'], name, { type: 'image/png' }))
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    return event.defaultPrevented
  }, names)
}

test('pastes multiple images at the caret, renders previews and saves image URLs', async ({ page }) => {
  const { state, editor, errors } = await editorFixture(page)
  await editor.focus()
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 3))
  expect(await pasteFiles(page, ['第一张.png', '第二张.png'])).toBe(true)
  const expected = '开头\n![第一张](/uploads/fixture-1.png)\n![第二张](/uploads/fixture-2.png)\n结尾'
  await expect(editor).toHaveValue(expected)
  await expect(page.locator('.admin-preview img')).toHaveCount(2)
  await expect(page.locator('.admin-preview img').first()).toHaveJSProperty('naturalWidth', 2)
  expect(state.uploads).toHaveLength(2)
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect.poll(() => state.saves.length).toBe(1)
  expect(state.saves[0].markdown).toBe(expected)
  expect(errors).toEqual([])
})

test('keeps the original article and insertion point while upload is pending', async ({ page }) => {
  const { state, editor, errors } = await editorFixture(page)
  state.hold = true
  await editor.focus()
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 3))
  await pasteFiles(page)
  await expect.poll(() => state.pending.length).toBe(1)
  // Edits before the pending image must not shift it into the wrong paragraph.
  await editor.fill('新增\n开头\n结尾')
  await page.locator('[data-document-id="2"] .tree-document-select').click()
  await expect(editor).toHaveValue('另一篇教程')
  await state.pending.shift()!()
  await expect(page.locator('.upload-progress')).toHaveCount(0)
  await expect(editor).toHaveValue('另一篇教程')
  await page.locator('[data-document-id="1"] .tree-document-select').click()
  await expect(editor).toHaveValue('新增\n开头\n![截图](/uploads/fixture-1.png)\n结尾')
  expect(errors).toEqual([])
})

test('failed paste preserves text and file uploads still work after retry', async ({ page }) => {
  const { state, editor, errors } = await editorFixture(page)
  state.fail = true
  await pasteFiles(page)
  await expect(page.getByRole('status')).toContainText('图片超过大小限制')
  await expect(editor).toHaveValue('开头\n结尾')
  await expect(page.locator('.upload-progress')).toHaveCount(0)
  state.fail = false
  await editor.focus()
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 5))
  await page.locator('.toolbar-upload input').setInputFiles({ name: '上传.png', mimeType: 'image/png', buffer: png })
  await expect(editor).toHaveValue('开头\n结尾\n![上传](/uploads/fixture-2.png)\n')
  expect(state.uploads).toHaveLength(2)
  expect(errors).toEqual([])
})

test('supports native screenshot paste and leaves native text paste unchanged', async ({ page, context }) => {
  const { state, editor, errors } = await editorFixture(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await page.evaluate(async base64 => {
    const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([data], { type: 'image/png' }) })])
  }, png.toString('base64'))
  await editor.focus()
  await editor.press('Control+End')
  await editor.press('Control+v')
  await expect(editor).toHaveValue(/!\[.*\]\(\/uploads\/fixture-1.png\)/)
  await page.evaluate(() => navigator.clipboard.writeText('粘贴的普通文字'))
  await editor.press('Control+End')
  await editor.press('Control+v')
  await expect(editor).toHaveValue(/粘贴的普通文字$/)
  expect(state.uploads).toHaveLength(1)
  expect(errors).toEqual([])
})
