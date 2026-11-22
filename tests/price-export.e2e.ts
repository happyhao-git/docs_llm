import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test, type Download } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { CATALOG_CACHE_KEY } from '../src/features/models/catalog-cache'
import type { PublicCatalog } from '../src/features/models/types'

async function pdfText(download: Download) {
  const bytes = await readFile((await download.path())!)
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)) })
  const pdf = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) pages.push((await (await pdf.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '))
    return pages.join(' ')
  } finally { await task.destroy() }
}

test('exports the filtered and sorted directory with per-model group choices', async ({ page }) => {
  let sourceReads = 0
  page.on('request', r => { if (r.url().endsWith('/models/refresh')) sourceReads++ })
  await page.goto('/models?platform=all&billing=balance&vendor=openai&type=image&sort=image-2k')
  const row = page.locator('.model-row').filter({ has: page.getByRole('button', { name: 'gpt-image-2.5', exact: true }) })
  await row.getByRole('combobox').selectOption('118')
  const ids = await page.locator('.model-row .model-name').allTextContents()
  const sent = page.waitForRequest(r => r.url().endsWith('/models/export.pdf'))
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const request = (await sent).postDataJSON(), download = await downloaded
  expect(request.rows.map((r: { modelId: string }) => r.modelId)).toEqual(ids)
  expect(request.rows.find((r: { modelId: string }) => r.modelId === 'gpt-image-2.5').groupId).toBe('118')
  expect(request.billing).toBe('balance')
  expect(request.showPlatform).toBe(true)
  expect(download.suggestedFilename()).toMatch(/^LinkAPI-价格表-余额-\d{8}\.pdf$/)
  const text = await pdfText(download)
  expect(text).toContain('¥0.03'); expect(text).toContain('¥0.06'); expect(text).toContain('1K'); expect(text).not.toContain('gpt-6.1-terra')
  expect(sourceReads).toBe(0)
  await download.saveAs('/tmp/linkapi-pdf/images.pdf')
})

test('reuses the same PDF in a tab and still checks that prices have not changed', async ({ page }) => {
  await page.goto('/models?platform=all&billing=balance&q=gpt-6.1-terra')
  await expect(page.locator('.model-row')).toHaveCount(1)
  const responses: Array<{ status: number; state: string | null; duration: string | null }> = []
  page.on('response', response => {
    if (response.url().endsWith('/models/export.pdf')) responses.push({ status: response.status(), state: response.headers()['x-price-pdf-cache'] || null,
      duration: response.headers()['server-timing'] || null })
  })
  const button = page.getByRole('button', { name: '导出 PDF', exact: true })
  for (let i = 0; i < 2; i++) {
    const downloaded = page.waitForEvent('download')
    await button.click()
    expect((await downloaded).suggestedFilename()).toMatch(/^LinkAPI-价格表-余额-/)
  }
  await expect.poll(() => responses.length).toBe(2)
  expect(responses[1].status).toBe(204)
  expect(responses[1].state).toBe('client')
  expect(responses[0].duration).toMatch(/^pdf;dur=/)
})

test('downloads a subscription price sheet from a provider view and keeps the controls compact', async ({ page }) => {
  await page.goto('/models?platform=openai&billing=subscription')
  await expect(page.locator('.model-row').first()).toBeVisible()
  const ids = await page.locator('.model-row .model-name').allTextContents()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const download = await downloaded, text = await pdfText(download)
  expect(ids.length).toBeGreaterThan(5)
  for (const id of ids) expect(text).toContain(id)
  expect(text).toContain('0.08x'); expect(text).toContain('LinkAPI')
  await download.saveAs('/tmp/linkapi-pdf/subscription.pdf')
  await page.screenshot({ path: '/tmp/linkapi-pdf/desktop.png', animations: 'disabled' })
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 850 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '导出 PDF', exact: true })).toBeVisible()
    await page.screenshot({ path: `/tmp/linkapi-pdf/mobile-${width}.png`, animations: 'disabled' })
  }
})

test('refreshes a changed cached snapshot with GET and asks the user to check before exporting again', async ({ page, request }) => {
  const old: PublicCatalog = await (await request.get('/api/public/models')).json()
  old.groups[0].name += ' 旧缓存'
  await page.addInitScript(({ key, catalog }) => localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), catalog })), { key: CATALOG_CACHE_KEY, catalog: old })
  let gets = 0, sourceReads = 0
  page.on('request', r => { if (r.url().endsWith('/api/public/models')) gets++; if (r.url().endsWith('/models/refresh')) sourceReads++ })
  await page.goto('/models?platform=openai&billing=subscription&q=gpt-6.1-terra')
  await expect(page.locator('.model-row')).toHaveCount(1)
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '价格表已更新，请核对后重新导出。' })).toBeVisible()
  expect(gets).toBe(1); expect(sourceReads).toBe(0)
  let downloaded: Download | undefined
  page.on('download', file => { downloaded = file })
  for (let attempt = 0; attempt < 3 && !downloaded; attempt++) {
    const response = page.waitForResponse(r => r.url().endsWith('/models/export.pdf'))
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
    const result = await response
    if (result.status() === 409) {
      await expect(page.getByRole('status').filter({ hasText: '价格表已更新，请核对后重新导出。' })).toBeVisible()
      continue
    }
    expect(result.status()).toBe(200)
    await expect.poll(() => downloaded).toBeDefined()
  }
  expect(downloaded).toBeDefined()
  expect(await pdfText(downloaded!)).toContain('gpt-6.1-terra')
})

test('disables empty and in-progress exports and reports a retryable rate limit', async ({ page }) => {
  await page.goto('/models?platform=all&billing=balance&q=not-an-available-model')
  await expect(page.getByRole('button', { name: '导出 PDF', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: '搜索模型' }).fill('gpt-6.1-terra')
  let finish: () => void = () => {}
  const held = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/api/public/models/export.pdf', async route => { await held; await route.fulfill({ status: 429, json: { error: 'Too many requests' } }) })
  const sent = page.waitForRequest(r => r.url().endsWith('/models/export.pdf'))
  const button = page.getByRole('button', { name: '导出 PDF', exact: true })
  await button.click(); await sent
  await expect(button).toBeDisabled(); await expect(button).toHaveAttribute('aria-busy', 'true')
  finish()
  await expect(page.getByRole('status').filter({ hasText: '导出较频繁，请稍后重试。' })).toBeVisible()
  await expect(button).toBeEnabled()
})
