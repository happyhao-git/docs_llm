import { readFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext } from '@playwright/test'
import type { PublicCatalog } from '../src/features/models/types'
import { CATALOG_CACHE_KEY } from '../src/features/models/catalog-cache'

const getCatalog = async (request: APIRequestContext): Promise<PublicCatalog> => process.env.MODEL_PREVIEW_CATALOG
  ? JSON.parse(await readFile(process.env.MODEL_PREVIEW_CATALOG, 'utf8')) : (await request.get('/api/public/models')).json()
test.beforeEach(async ({ page, request }) => {
  if (process.env.MODEL_PREVIEW_CATALOG) {
    const value = await getCatalog(request)
    await page.route('**/api/public/models', route => route.fulfill({ json: value }))
  }
})

test('opens all models as a menu, keeps one row per model, and displays every provider in one table', async ({ page, request }) => {
  const c = await getCatalog(request)
  const count = new Set(c.groups.flatMap(g => g.models.map(m => `${m.platform}:${m.id}`))).size
  await page.goto('/models')
  await page.locator('.platform-all').click()
  await expect(page).toHaveURL(/platform=all/)
  await expect(page.locator('.platform-all')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.directory-table')).toHaveCount(1)
  await expect(page.locator('.model-row')).toHaveCount(count)
  expect(new Set(await page.locator('.directory-table>tbody').evaluateAll(rows => rows.map(r => r.getAttribute('data-model-key')))).size).toBe(count)
  expect(await page.locator('.directory-platform').allTextContents().then(names => c.platforms.every(p => names.some(n => n.includes(p.name))))).toBe(true)
  const providers = await page.locator('.directory-table>tbody').evaluateAll(rows => rows.map(row => row.getAttribute('data-platform')))
  for (const provider of new Set(providers)) expect(providers.lastIndexOf(provider)).toBe(providers.indexOf(provider) + providers.filter(p => p === provider).length - 1)
  await expect(page.locator('.directory-other-mode').first()).toHaveText('查看余额价格')
  await page.getByRole('button', { name: '余额', exact: true }).click()
  await expect(page.locator('.model-row')).toHaveCount(count)
  await expect(page.locator('.directory-other-mode')).toHaveCount(0)
})

test('resets filtered and sorted rows to platform order while keeping billing and row group choices', async ({ page }) => {
  await page.goto('/models?platform=all&billing=balance')
  const model = page.locator('.model-row').filter({ has: page.getByRole('button', { name: 'gpt-image-2.5', exact: true }) })
  await model.getByRole('combobox').selectOption('118')
  await page.getByRole('combobox', { name: '模型厂商', exact: true }).selectOption('deepseek')
  await page.getByRole('combobox', { name: '排序依据' }).selectOption('output')
  await page.getByRole('textbox', { name: '搜索模型' }).fill('deepseek-v4')
  await expect(page.locator('.model-row')).toHaveCount(3)
  await page.getByRole('button', { name: '重置' }).click()
  await expect(page).toHaveURL(/billing=balance/)
  await expect(page.getByRole('combobox', { name: '排序依据' })).toHaveValue('platform')
  await expect(page.getByRole('combobox', { name: '模型厂商', exact: true })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: '搜索模型' })).toHaveValue('')
  await expect(page.locator('.model-row').first().locator('.model-name')).toHaveText('gpt-6.1-terra')
  await expect(model.getByRole('combobox')).toHaveValue('118')
  await expect(page.locator('.directory-table thead th').first()).toHaveText('平台')
  await expect(page.locator('.directory-table thead th').nth(1)).toHaveText('模型 ID')
})

test('combines vendor, type, query, group filters and numeric CNY sorting without extra data requests', async ({ page, request }) => {
  const c = await getCatalog(request)
  const count = new Set(c.groups.flatMap(g => g.models.map(m => `${m.platform}:${m.id}`))).size
  let requests = 0
  page.on('request', r => { if (r.url().endsWith('/api/public/models')) requests++ })
  await page.goto('/models?platform=all&billing=balance')
  await page.getByRole('combobox', { name: '模型厂商', exact: true }).selectOption('deepseek')
  await page.getByRole('combobox', { name: '模型类型', exact: true }).selectOption('text')
  await page.getByRole('combobox', { name: '排序依据' }).selectOption('input')
  await expect(page.locator('.model-row')).toHaveCount(3)
  await expect(page.locator('.model-row').last().locator('.model-name')).toHaveText('deepseek-v4-pro')
  await expect(page.locator('.model-row').last().locator('.price-official').first()).toHaveText('官方价格 ¥9')
  await page.getByRole('button', { name: '排序方向：升序' }).click()
  await expect(page.locator('.model-row').first().locator('.model-name')).toHaveText('deepseek-v4-pro')
  await page.getByRole('textbox', { name: '搜索模型' }).fill('PRO')
  await expect(page.locator('.model-row')).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('combobox', { name: '模型厂商', exact: true })).toHaveValue('deepseek')
  await expect(page.getByRole('combobox', { name: '排序依据' })).toHaveValue('input')
  await expect(page.getByRole('textbox', { name: '搜索模型' })).toHaveValue('PRO')
  expect(requests).toBe(1)
  await page.getByRole('textbox', { name: '搜索模型' }).fill('does-not-exist')
  await expect(page.getByRole('heading', { name: '没有找到匹配的模型' })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(page.locator('.model-row')).toHaveCount(count)
  await page.getByRole('combobox', { name: '使用分组', exact: true }).selectOption('114')
  await expect(page.locator('.model-row')).toHaveCount(3)
  expect(requests).toBe(1)
})

test('switches row groups with correct image details and sorts each resolution separately', async ({ page }) => {
  await page.goto('/models?platform=all&billing=balance&vendor=openai&type=image&sort=image-2k')
  const row = page.locator('.model-row').filter({ has: page.getByRole('button', { name: 'gpt-image-2.5', exact: true }) })
  await expect(row.locator('.model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.08', '实际价格 ¥0.10'])
  await row.getByRole('combobox').selectOption('118')
  await expect(row.locator('.model-price strong')).toHaveText(['实际价格 ¥0.03', '实际价格 ¥0.06', '实际价格 ¥0.08'])
  await expect(page.locator('.model-row').first().locator('.model-name')).toHaveText('gpt-image-2.5')
  await row.locator('.model-name').click()
  await expect(page.locator('.image-base-price')).toHaveText(['0.15', '0.3', '0.4'])
  await expect(page.locator('.image-price-details .model-price strong')).toHaveText(['实际价格 ¥0.03', '实际价格 ¥0.06', '实际价格 ¥0.08'])
  await page.getByRole('button', { name: '订阅', exact: true }).click()
  await row.getByRole('combobox').selectOption('67')
  await row.locator('.model-name').click()
  await expect(page.locator('.image-price-details .model-price strong')).toHaveText(['实际价格 ¥0.06', '实际价格 ¥0.0798', '实际价格 ¥0.0999'])
})

test('sorts verified launch dates and keeps undated models last in either direction', async ({ page, request }) => {
  const catalog = await getCatalog(request)
  const released = catalog.groups.flatMap(g => g.models).find(m => m.releasedAt && m.releaseSource)!
  await page.goto('/models?platform=all&billing=balance&sort=released')
  const times = () => page.locator('.model-row time').evaluateAll(nodes => nodes.map(n => n.getAttribute('datetime')!))
  const descending = await times()
  expect(descending.length).toBeGreaterThan(3)
  expect(descending).toEqual([...descending].sort().reverse())
  await expect(page.locator('.model-row').last().locator('time')).toHaveCount(0)
  const row = page.locator('.model-row').filter({ has: page.getByRole('button', { name: released.id, exact: true }) })
  await expect(row.locator('time')).toHaveText(released.releasedAt!)
  await row.locator('.model-name').click()
  await expect(page.getByRole('link', { name: `发布于 ${released.releasedAt}` })).toHaveAttribute('href', released.releaseSource!)
  await page.getByRole('button', { name: '排序方向：从新到旧' }).click()
  expect(await times()).toEqual([...descending].sort())
  await expect(page.locator('.model-row').last().locator('time')).toHaveCount(0)
  await page.getByRole('combobox', { name: '排序依据' }).selectOption('version')
  await page.getByRole('combobox', { name: '模型厂商', exact: true }).selectOption('openai')
  await expect(page.locator('.model-row').first().locator('.model-name')).toHaveText('gpt-6.1-terra')
  await expect(page.locator('.model-row').last().locator('.model-name')).toHaveText('codex-auto-review')
})

test('keeps the directory compact and usable on mobile and in dark mode', async ({ page, request }) => {
  const c = await getCatalog(request)
  const count = new Set(c.groups.flatMap(g => g.models.map(m => `${m.platform}:${m.id}`))).size
  await page.goto('/models?platform=all&billing=balance')
  await expect(page.locator('.model-row')).toHaveCount(count)
  await page.screenshot({ path: '/tmp/linkapi-directory-desktop.png', animations: 'disabled' })
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 960 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('.models-platform-trigger').click()
    await page.locator('.platform-all').click()
    await expect(page.getByRole('dialog', { name: '模型平台' })).toHaveCount(0)
    await expect(page.locator('.models-platform-trigger')).toBeFocused()
    await page.screenshot({ path: `/tmp/linkapi-directory-${width}.png`, animations: 'disabled' })
  }
  await page.getByRole('combobox', { name: '模型厂商', exact: true }).selectOption('kimi')
  await page.getByRole('button', { name: 'kimi-k3', exact: true }).click()
  await expect(page.locator('.model-details')).toContainText('实际价格 ¥ / 官方价格 ¥')
  await page.getByRole('button', { name: '切换到深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/linkapi-directory-dark.png', animations: 'disabled' })
})

test('replaces older directory caches with release metadata', async ({ page, request }) => {
  const old = await getCatalog(request)
  old.groups.forEach(g => g.models.forEach(m => { delete m.releasedAt; delete m.releaseSource }))
  await page.addInitScript(value => localStorage.setItem('linkapi:model-catalog:v5', JSON.stringify({ savedAt: Date.now(), catalog: value })), old)
  await page.goto('/models?platform=all&billing=balance&sort=released')
  await expect(page.locator('.model-row time').first()).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key) !== null, CATALOG_CACHE_KEY)).toBe(true)
})
