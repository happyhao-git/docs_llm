import { expect, test } from '@playwright/test'
import type { PublicCatalog } from '../src/features/models/types'
import { CATALOG_CACHE_KEY, CATALOG_REFRESH_TIMEOUT } from '../src/features/models/catalog-cache'

test('manual refresh removes withdrawn models, updates local and other-tab caches, and shows the cooldown', async ({ page, context, request }) => {
  const original: PublicCatalog = await (await request.get('/api/public/models')).json()
  const updated = structuredClone(original), removed = 'gpt-5.5'
  for (const group of updated.groups) group.models = group.models.filter(m => m.id !== removed)
  const unique = new Set(updated.groups.flatMap(g => g.models.filter(m => m.platform === 'openai').map(m => m.id)))
  updated.platforms.find(p => p.id === 'openai')!.count = unique.size
  updated.updatedAt = new Date().toISOString()
  await page.clock.install()
  let refreshes = 0
  let current = original
  await context.route('**/api/public/models', route => route.fulfill({ json: current }))
  await context.route('**/api/public/models/refresh', route => {
    refreshes++
    current = updated
    expect(route.request().method()).toBe('POST')
    return route.fulfill({ json: { catalog: updated, status: refreshes === 1 ? 'updated' : 'cooldown', retryAfterSeconds: 60 } })
  })
  await page.goto('/models?platform=all&billing=balance')
  await expect(page.getByRole('button', { name: removed, exact: true })).toBeVisible()
  const other = await context.newPage()
  await other.goto('/models?platform=all&billing=balance')
  await expect(other.getByRole('button', { name: removed, exact: true })).toBeVisible()
  await page.bringToFront()
  await page.getByRole('button', { name: '刷新模型目录' }).click()
  await expect(page.getByRole('button', { name: removed, exact: true })).toHaveCount(0)
  await expect(page.locator('.model-refresh-feedback')).toContainText('列表已更新')
  await expect(page.getByRole('button', { name: '刷新模型目录' })).toBeDisabled()
  const expected = new Set(updated.groups.flatMap(g => g.models.map(m => `${m.platform}:${m.id}`))).size
  await expect(page.locator('.platform-all small')).toHaveText(String(expected))
  await other.bringToFront()
  await expect(other.getByRole('button', { name: removed, exact: true })).toHaveCount(0)
  await other.reload()
  await expect(other.getByRole('button', { name: removed, exact: true })).toHaveCount(0)
  expect(refreshes).toBe(1)
  await page.bringToFront()
  await page.clock.fastForward(59_000)
  await expect(page.getByRole('button', { name: '刷新模型目录' })).toBeDisabled()
  await page.clock.fastForward(1000)
  await expect(page.getByRole('button', { name: '刷新模型目录' })).toBeEnabled()
  await page.getByRole('button', { name: '刷新模型目录' }).click()
  await expect(page.locator('.model-refresh-feedback')).toContainText('60 秒后可再次刷新')
  expect(refreshes).toBe(2)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).catalog.groups.every((g: any) => g.models.every((m: any) => m.id !== 'gpt-5.5')), CATALOG_CACHE_KEY)).toBe(true)
  await other.close()
})

test('preserves readable prices after a failed or timed-out manual refresh', async ({ page, request }) => {
  const catalog: PublicCatalog = await (await request.get('/api/public/models')).json()
  await page.clock.install()
  await page.route('**/api/public/models', route => route.fulfill({ json: catalog }))
  await page.route('**/api/public/models/refresh', route => route.fulfill({ json: { catalog: { ...catalog, stale: true }, status: 'failed', retryAfterSeconds: 60 } }))
  await page.goto('/models?q=gpt-5.5')
  await expect(page.locator('.model-row')).toHaveCount(1)
  const original = await page.locator('.model-row .model-price strong').allTextContents()
  await page.getByRole('button', { name: '刷新模型目录' }).click()
  await expect(page.locator('.models-notice')).toContainText('更新失败，已保留上次结果')
  expect(await page.locator('.model-row .model-price strong').allTextContents()).toEqual(original)
  await page.clock.fastForward(60_000)
  await page.route('**/api/public/models/refresh', () => { /* A stalled, isolated test response. */ })
  await page.getByRole('button', { name: '刷新模型目录' }).click()
  await page.clock.fastForward(CATALOG_REFRESH_TIMEOUT + 100)
  await expect(page.locator('.models-notice')).toContainText('更新超时')
  expect(await page.locator('.model-row .model-price strong').allTextContents()).toEqual(original)
  await expect(page.getByRole('button', { name: '刷新模型目录' })).toBeEnabled()
})

test('ordinary reloads and online events only read the saved catalog', async ({ page, request }) => {
  const catalog: PublicCatalog = await (await request.get('/api/public/models')).json()
  let reads = 0, refreshes = 0
  await page.route('**/api/public/models', route => { reads++; return route.fulfill({ json: catalog }) })
  await page.route('**/api/public/models/refresh', route => { refreshes++; return route.fulfill({ json: { catalog, status: 'cooldown', retryAfterSeconds: 30 } }) })
  await page.goto('/models')
  await expect(page.locator('.model-row').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('.model-row').first()).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => reads).toBe(2)
  expect(refreshes).toBe(0)
})
