import { readFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { CATALOG_CACHE_KEY } from '../src/features/models/catalog-cache'
import type { PublicCatalog } from '../src/features/models/types'

const catalog = async (request: APIRequestContext): Promise<PublicCatalog> => process.env.MODEL_PREVIEW_CATALOG
  ? JSON.parse(await readFile(process.env.MODEL_PREVIEW_CATALOG, 'utf8')) : (await request.get('/api/public/models')).json()
test.beforeEach(async ({ page, request }) => {
  if (process.env.MODEL_PREVIEW_CATALOG) {
    const value = await catalog(request)
    await page.route('**/api/public/models', route => route.fulfill({ json: value }))
  }
})

test('compares CNY official and actual prices across domestic balance and subscription groups', async ({ page }) => {
  const cases = [
    { platform: 'deepseek', group: '114', model: 'deepseek-v4-pro', official: ['9', '27', '0.3'], balance: ['1.8', '5.4', '0.06'], subscription: ['1.08', '3.24', '0.036'] },
    { platform: 'zhipu', group: '113', model: 'glm-5.3', official: ['8', '28', '2'], balance: ['1.6', '5.6', '0.4'], subscription: ['0.96', '3.36', '0.24'] },
    { platform: 'kimi', group: '112', model: 'kimi-k3', official: ['20', '100', '2'], balance: ['4', '20', '0.4'], subscription: ['2.4', '12', '0.24'] },
    { platform: 'kimi', group: '112', model: 'k3', official: ['20', '100', '2'], balance: ['4', '20', '0.4'], subscription: ['2.4', '12', '0.24'] }
  ]
  for (const c of cases) for (const billing of ['balance', 'subscription'] as const) {
    await page.goto(`/models?platform=${c.platform}&billing=${billing}&group=${billing === 'balance' ? c.group : '67'}&q=${c.model}`)
    const row = page.locator('.model-row').filter({ has: page.getByRole('button', { name: c.model, exact: true }) })
    await expect(row.locator('.model-price strong')).toHaveText(c[billing].map(n => `实际价格 ¥${n}`))
    await expect(row.locator('.price-official')).toHaveText(c.official.map(n => `官方价格 ¥${n}`))
    await expect(row.locator('.row-coefficient')).toHaveText(billing === 'balance' ? '0.2x' : '0.12x')
    for (const item of await row.locator('.price-official').all()) await expect(item).toHaveAttribute('title', '官方价格（CNY）')
    await row.locator('.model-name').click()
    await expect(page.locator('.comparison-legend').first()).toContainText('实际价格 ¥ / 官方价格 ¥')
    await expect(page.locator('.comparison-table .price-official').first()).toHaveText(`官方价格 ¥${c.official[0]}`)
    await page.locator('.calculation-details summary').click()
    await expect(page.locator('.calculation-table tbody tr').first().locator('td').nth(2)).toHaveText(c.official[0])
    await page.locator('.pricing-explainer summary').click()
    await expect(page.locator('.pricing-explainer')).toContainText('实际价格为人民币（CNY），划线官方价格为人民币（CNY）。')
    await expect(page.locator('.model-details')).not.toContainText('$')
    await expect(page.locator('.official-link')).toHaveCount(0)
  }
})

test('keeps CNY prices readable across desktop tablet mobile and dark mode', async ({ page }) => {
  await page.goto('/models?platform=kimi&billing=balance&group=112&q=kimi-k3')
  await page.getByRole('button', { name: 'kimi-k3', exact: true }).click()
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await expect(page.locator('.model-details')).toBeVisible()
    await expect(page.locator('.model-row .price-official')).toHaveText(['官方价格 ¥20', '官方价格 ¥100', '官方价格 ¥2'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/linkapi-cny-prices-${width}.png`, animations: 'disabled' })
  }
  await page.getByRole('button', { name: '切换到深色模式' }).click()
  await expect(page.locator('.comparison-legend s')).toHaveText('¥')
  await page.screenshot({ path: '/tmp/linkapi-cny-prices-dark.png', animations: 'disabled' })
})

test('drops old USD reference caches and reuses the corrected local snapshot', async ({ page, request }) => {
  const old = await catalog(request)
  old.groups.forEach(g => g.models.forEach(m => m.items.forEach(i => { i.officialCurrency = 'USD'; i.official = '999' })))
  await page.addInitScript(value => localStorage.setItem('linkapi:model-catalog:v4', JSON.stringify({ savedAt: Date.now(), catalog: value })), old)
  let requests = 0
  page.on('request', req => { if (req.url().endsWith('/api/public/models')) requests++ })
  await page.goto('/models?platform=deepseek&billing=balance&group=114&q=deepseek-v4-pro')
  await expect(page.locator('.model-row .price-official')).toHaveText(['官方价格 ¥9', '官方价格 ¥27', '官方价格 ¥0.3'])
  await page.reload()
  await expect(page.locator('.model-row .price-official')).toHaveText(['官方价格 ¥9', '官方价格 ¥27', '官方价格 ¥0.3'])
  expect(requests).toBe(1)
  expect(await page.evaluate(key => localStorage.getItem(key) !== null, CATALOG_CACHE_KEY)).toBe(true)
})
