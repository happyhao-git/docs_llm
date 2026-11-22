import { readFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { CATALOG_CACHE_KEY } from '../src/features/models/catalog-cache'
import type { PublicCatalog } from '../src/features/models/types'

// An optional freshly calculated, read-only snapshot lets preview builds run
// against the same rules before the live documentation catalog is refreshed.
const stagedFile = process.env.MODEL_PREVIEW_CATALOG
const catalog = async (request: APIRequestContext): Promise<PublicCatalog> => stagedFile
  ? JSON.parse(await readFile(stagedFile, 'utf8')) : (await request.get('/api/public/models')).json()
test.beforeEach(async ({ page, request }) => {
  if (stagedFile) {
    const value = await catalog(request)
    await page.route('**/api/public/models', route => route.fulfill({ json: value }))
  }
})

test('shows the same per-image prices for all models in the standard subscription and balance groups', async ({ page, request }) => {
  const value = await catalog(request)
  for (const [mode, group] of [['subscription', '12'], ['balance', '26'], ['balance', '63']]) {
    const expectedModels = value.groups.find(g => g.id === group)!.models.filter(m => m.platform === 'openai' && m.kind === 'image')
    expect(expectedModels.length).toBeGreaterThan(0)
    await page.goto(`/models?billing=${mode}&group=${group}&type=image`)
    const rows = page.locator('.image-pricing-table .model-row')
    await expect(rows).toHaveCount(expectedModels.length)
    await expect(rows.locator('.model-name')).toHaveText(expectedModels.map(m => m.id))
    for (const row of await rows.all()) {
      await expect(row.locator('.model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.08', '实际价格 ¥0.10'])
      await expect(row.locator('.row-image-rate')).toHaveText('1x')
    }
    await expect(page.locator('.image-pricing-table thead')).toContainText('1K')
    await expect(page.locator('.image-pricing-table thead')).toContainText('2K')
    await expect(page.locator('.image-pricing-table thead')).toContainText('4K')
    await expect(page.locator('.context-rate')).toHaveText('图片倍率 1x')
    await expect(page.locator('.coefficient-badge')).toHaveCount(0)
    await expect(page.locator('.price-official')).toHaveCount(0)
    await page.getByRole('button', { name: 'gpt-image-2.5', exact: true }).click()
    await expect(page.locator('.image-base-price')).toHaveText(mode === 'subscription' ? ['3', '4', '5'] : ['0.3', '0.4', '0.5'])
    await expect(page.locator('.image-price-details .model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.08', '实际价格 ¥0.1'])
    await expect(page.locator('.model-details')).not.toContainText('token')
    await expect(page.locator('.model-details')).not.toContainText('官方价格')
    await expect(page.locator('.official-link')).toHaveCount(0)
  }
})

test('rounds composite image rows but exposes exact calculations in details', async ({ page }) => {
  await page.goto('/models?group=67&type=image')
  await expect(page.locator('.model-row').first().locator('.model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.08', '实际价格 ¥0.10'])
  await page.getByRole('button', { name: 'gpt-image-2.5', exact: true }).click()
  await expect(page.locator('.image-base-price')).toHaveText(['2', '2.66', '3.33'])
  await expect(page.locator('.image-billing-rate')).toHaveText(['1x', '1x', '1x'])
  await expect(page.locator('.image-price-details .model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.0798', '实际价格 ¥0.0999'])
  await expect(page.locator('.image-price-formula')).toContainText('本表保留准确金额')
  await page.locator('.pricing-explainer summary').click()
  await expect(page.locator('.pricing-explainer')).toContainText('¥3.00 / 100 额度')
  await expect(page.locator('.pricing-explainer')).not.toContainText('0.08x')
})

test('preserves the lower prices of the dedicated image group', async ({ page }) => {
  await page.goto('/models?billing=balance&group=118&type=image')
  await expect(page.locator('.model-row').first().locator('.model-price strong')).toHaveText(['实际价格 ¥0.03', '实际价格 ¥0.06', '实际价格 ¥0.08'])
  await page.getByRole('button', { name: 'gpt-image-2.5', exact: true }).click()
  await expect(page.locator('.image-base-price')).toHaveText(['0.15', '0.3', '0.4'])
})

test('shows an unavailable resolution without inventing a zero or token price', async ({ page, request }) => {
  const value = await catalog(request)
  const item = value.groups.find(g => g.id === '12')!.models.find(m => m.id === 'gpt-image-2')!.items.find(i => i.key === 'image-2k')!
  item.base = null; item.final = null
  await page.route('**/api/public/models', route => route.fulfill({ json: value }))
  await page.goto('/models?group=12&type=image')
  const row = page.locator('.model-row').filter({ has: page.getByRole('button', { name: 'gpt-image-2', exact: true }) })
  await expect(row.locator('.price-unavailable')).toHaveText('待确认')
  await expect(row.locator('.model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.10'])
  await row.locator('.model-name').click()
  await expect(page.locator('.image-price-details .price-unavailable')).toHaveText('待确认')
})

test('discards the old price cache and caches the corrected catalog across reloads', async ({ page, request }) => {
  const old = await catalog(request)
  old.groups.forEach(g => g.models.filter(m => m.kind === 'image').forEach(m => m.items.forEach(i => { i.final = '999' })))
  await page.addInitScript(value => localStorage.setItem('linkapi:model-catalog:v2', JSON.stringify({ savedAt: Date.now(), catalog: value })), old)
  let requests = 0
  page.on('request', req => { if (req.url().endsWith('/api/public/models')) requests++ })
  await page.goto('/models?group=12&type=image')
  await expect(page.locator('.model-row').first().locator('.model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.08', '实际价格 ¥0.10'])
  await page.reload()
  await expect(page.locator('.model-row').first().locator('.model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.08', '实际价格 ¥0.10'])
  expect(requests).toBe(1)
  expect(await page.evaluate(key => localStorage.getItem(key) !== null, CATALOG_CACHE_KEY)).toBe(true)
})

test('keeps resolution prices and their details usable on desktop, tablet and mobile', async ({ page }) => {
  await page.goto('/models?group=67&type=image')
  await page.getByRole('button', { name: 'gpt-image-2.5', exact: true }).click()
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await expect(page.getByRole('region', { name: '图片计费明细', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width <= 800) {
      expect(await page.locator('.image-pricing-table').evaluate(table => table.getBoundingClientRect().right <= innerWidth)).toBe(true)
      expect(await page.locator('.image-calculation-table').evaluate(table => table.getBoundingClientRect().right <= innerWidth)).toBe(true)
    }
    await page.screenshot({ path: `/tmp/linkapi-image-prices-${width}.png`, animations: 'disabled' })
  }
  await page.getByRole('button', { name: '切换到深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.image-price-details .model-price strong').nth(1)).toHaveText('实际价格 ¥0.0798')
  await page.screenshot({ path: '/tmp/linkapi-image-prices-dark.png', animations: 'disabled' })
})
