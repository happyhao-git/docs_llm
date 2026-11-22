import { expect, test } from '@playwright/test'
import { CATALOG_CACHE_KEY, CATALOG_CACHE_TTL, CATALOG_FRESH_TTL, CATALOG_REQUEST_TIMEOUT } from '../src/features/models/catalog-cache'

test('shows an HTML fallback and requests models before the application runtime arrives', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.route(/\/assets\/main-[^/]+\.js$/, async route => { await gate; await route.continue() })
  await page.goto('/models', { waitUntil: 'commit' })
  try {
    await expect(page.locator('#app-loading')).toBeVisible()
    await expect.poll(() => requests.some(url => url.endsWith('/api/public/models'))).toBe(true)
    expect(requests.some(url => /\/assets\/DocsView-[^/]+\.js$/.test(url))).toBe(false)
    expect(requests.some(url => /\/api\/public\/(navigation|documents)/.test(url))).toBe(false)
    await expect(page.locator('.model-row')).toHaveCount(0)
  } finally { release() }
  await expect(page.locator('.model-row').first()).toBeVisible()
  await expect(page.locator('#app-loading')).toHaveCount(0)
  expect(requests.filter(url => url.endsWith('/api/public/models'))).toHaveLength(1)
})

test('keeps a usable fallback if a route asset fails, preserving the exact retry URL', async ({ page }) => {
  await page.route(/\/assets\/ModelsView-[^/]+\.js$/, route => route.abort())
  await page.goto('/models?billing=balance&q=gpt-5.5', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#app-loading')).toHaveAttribute('data-failed', 'true')
  await expect(page.locator('#app-loading-status')).toHaveText('加载较慢，请重试。')
  await expect(page.locator('#app-loading-retry')).toHaveAttribute('href', '/models?billing=balance&q=gpt-5.5')
  await page.unroute(/\/assets\/ModelsView-[^/]+\.js$/)
  await page.locator('#app-loading-retry').click()
  await expect(page.locator('.model-row')).toHaveCount(1)
})

test('renders cached rows during slow reloads and applies changed prices without collapsing details', async ({ page, request }) => {
  const original = await (await request.get('/api/public/models')).json()
  const changed = structuredClone(original)
  for (const group of changed.groups) for (const model of group.models) {
    if (model.id === 'gpt-5.5') model.items.find((item: any) => item.key === 'input' && !item.condition).final = '99'
  }
  await page.route('**/api/public/models', route => route.fulfill({ json: original }))
  await page.goto('/models?q=gpt-5.5')
  await expect(page.locator('.model-row')).toHaveCount(1)
  const before = await page.locator('.model-row .model-price strong').first().textContent()
  await page.evaluate(({ key, ttl }) => {
    const cached = JSON.parse(localStorage.getItem(key)!)
    cached.savedAt = Date.now() - ttl - 1
    localStorage.setItem(key, JSON.stringify(cached))
  }, { key: CATALOG_CACHE_KEY, ttl: CATALOG_FRESH_TTL })
  await page.unroute('**/api/public/models')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/public/models', async route => { await gate; await route.fulfill({ json: changed }) })
  await page.reload()
  try {
    await expect(page.locator('.model-row')).toHaveCount(1)
    await expect(page.locator('.models-skeleton')).toHaveCount(0)
    await expect(page.locator('.model-row .model-price strong').first()).toHaveText(before!)
    await page.getByRole('button', { name: 'gpt-5.5', exact: true }).click()
    await expect(page.locator('.model-details')).toBeVisible()
  } finally { release() }
  await expect(page.locator('.model-row .model-price strong').first()).toHaveText('实际价格 ¥99')
  await expect(page.locator('.model-details')).toBeVisible()
})

test('shows a recoverable timeout instead of an endless loading skeleton', async ({ page, request }) => {
  const catalog = await (await request.get('/api/public/models')).json()
  await page.route('**/api/public/models/refresh', route => route.fulfill({ json: { catalog, status: 'updated', retryAfterSeconds: 60 } }))
  await page.clock.install()
  await page.route('**/api/public/models', () => { /* Intentionally leave the request unanswered. */ })
  await page.goto('/models')
  await expect(page.locator('.models-skeleton')).toBeVisible()
  await page.clock.fastForward(CATALOG_REQUEST_TIMEOUT + 100)
  await expect(page.getByRole('heading', { name: '目录暂时不可用' })).toBeVisible()
  await expect(page.locator('.models-empty')).toContainText('加载超时')
  await page.unroute('**/api/public/models')
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.locator('.model-row').first()).toBeVisible()
})

test('retains cached rows on failure, then accepts an empty catalog when access changes', async ({ page, request }) => {
  const original = await (await request.get('/api/public/models')).json()
  await page.goto('/models')
  await expect(page.locator('.model-row').first()).toBeVisible()
  await page.route('**/api/public/models', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.evaluate(({ key, ttl }) => {
    const cached = JSON.parse(localStorage.getItem(key)!)
    cached.savedAt = Date.now() - ttl - 1
    localStorage.setItem(key, JSON.stringify(cached))
  }, { key: CATALOG_CACHE_KEY, ttl: CATALOG_FRESH_TTL })
  await page.reload()
  await expect(page.locator('.model-row').first()).toBeVisible()
  await expect(page.locator('.models-notice')).toContainText('上次更新')
  await page.unroute('**/api/public/models')
  await page.route('**/api/public/models', route => route.fulfill({ json: { ...original, platforms: [], groups: [] } }))
  await page.route('**/api/public/models/refresh', route => route.fulfill({ json: { catalog: { ...original, platforms: [], groups: [] }, status: 'updated', retryAfterSeconds: 60 } }))
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('.model-row')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '当前付费方式暂无可用模型' })).toBeVisible()
})

test('does not display expired or corrupted prices when the API is unavailable', async ({ page, request }) => {
  const original = await (await request.get('/api/public/models')).json()
  await page.addInitScript(({ key, catalog, ttl }) => {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now() - ttl - 1, catalog }))
  }, { key: CATALOG_CACHE_KEY, catalog: original, ttl: CATALOG_CACHE_TTL })
  await page.route('**/api/public/models', route => route.fulfill({ status: 503, json: {} }))
  await page.goto('/models')
  await expect(page.getByRole('heading', { name: '目录暂时不可用' })).toBeVisible()
  await expect(page.locator('.model-row')).toHaveCount(0)
})

test('returns from documentation using cached rows without another catalog request', async ({ page }) => {
  const catalogs: string[] = []
  page.on('request', request => { if (request.url().endsWith('/api/public/models')) catalogs.push(request.url()) })
  await page.goto('/models')
  await expect(page.locator('.model-row').first()).toBeVisible()
  await page.locator('.site-nav').getByRole('link', { name: '使用文档' }).click()
  await expect(page.locator('.home-heading')).toBeVisible()
  await page.locator('.site-nav').getByRole('link', { name: '模型广场' }).click()
  await expect(page.locator('.model-row').first()).toBeVisible()
  await expect(page.locator('.models-skeleton')).toHaveCount(0)
  expect(catalogs).toHaveLength(1)
})

test('reuses local model and site data across reloads and new tabs; manual refresh bypasses it', async ({ page, context, request }) => {
  const catalog = await (await request.get('/api/public/models')).json()
  let refreshRequests = 0
  await context.route('**/api/public/models/refresh', route => { refreshRequests++; return route.fulfill({ json: { catalog, status: 'updated', retryAfterSeconds: 60 } }) })
  const requests: string[] = []
  context.on('request', request => { if (/\/api\/public\/(models|site-config)$/.test(request.url())) requests.push(request.url()) })
  await page.goto('/models')
  await expect(page.locator('.model-row').first()).toBeVisible()
  await expect(page.locator('.console-link')).toBeVisible()
  expect(requests.filter(url => url.endsWith('/models'))).toHaveLength(1)
  expect(requests.filter(url => url.endsWith('/site-config'))).toHaveLength(1)
  await page.reload()
  await expect(page.locator('.model-row').first()).toBeVisible()
  await expect(page.locator('.console-link')).toBeVisible()
  const other = await context.newPage()
  await other.goto('/models?billing=balance')
  await expect(other.locator('.model-row').first()).toBeVisible()
  await expect(other.locator('.console-link')).toBeVisible()
  expect(requests).toHaveLength(2)
  await other.getByRole('button', { name: '刷新模型目录' }).click()
  await expect.poll(() => refreshRequests).toBe(1)
  await expect(other.getByRole('button', { name: '刷新模型目录' })).toBeDisabled()
  expect(requests.filter(url => url.endsWith('/models'))).toHaveLength(1)
  await other.close()
})

test('refreshes an open page when another tab invalidates saved model settings', async ({ page, context, request }) => {
  const original = await (await request.get('/api/public/models')).json()
  await page.goto('/models')
  await expect(page.locator('.model-row').first()).toBeVisible()
  await page.route('**/api/public/models', route => route.fulfill({ json: { ...original, platforms: [], groups: [] } }))
  const adminTab = await context.newPage()
  await adminTab.goto('/models')
  await page.bringToFront()
  await adminTab.evaluate(key => localStorage.removeItem(key), CATALOG_CACHE_KEY)
  await expect(page.locator('.model-row')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '当前付费方式暂无可用模型' })).toBeVisible()
  await adminTab.close()
})

test('loads only local resources and reuses versioned scripts and styles from the browser cache', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('/models')
  await expect(page.locator('.model-row').first()).toBeVisible()
  await expect.poll(() => page.locator('.platform-icon').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  const origin = new URL(page.url()).origin
  expect(requests.filter(url => !url.startsWith(origin + '/'))).toEqual([])
  expect(await page.locator('script[src*="cloudflareinsights"]').count()).toBe(0)
  await page.reload()
  await expect(page.locator('.model-row').first()).toBeVisible()
  const assets = await page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .filter(entry => new URL(entry.name).pathname.startsWith('/assets/') && /\.(js|css)$/.test(entry.name))
    .map(entry => ({ name: entry.name, bytes: entry.transferSize })))
  expect(assets.length).toBeGreaterThan(0)
  expect(assets.filter(asset => asset.bytes !== 0)).toEqual([])
})

test('prefetches the models page on navigation intent without reading the source', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('/')
  await expect(page.locator('.home-heading')).toBeVisible()
  expect(requests.some(url => url.endsWith('/api/public/models'))).toBe(false)
  const ready = page.waitForResponse(response => response.url().endsWith('/api/public/models'))
  await page.locator('.site-nav').getByRole('link', { name: '模型广场' }).hover()
  await (await ready).finished()
  await expect.poll(() => requests.some(url => /\/assets\/ModelsView-[^/]+\.js$/.test(url))).toBe(true)
  await page.locator('.site-nav').getByRole('link', { name: '模型广场' }).click()
  await expect(page.locator('.model-row').first()).toBeVisible()
  expect(requests.filter(url => url.endsWith('/api/public/models'))).toHaveLength(1)
  expect(requests.some(url => url.includes('/api/admin/models/sync'))).toBe(false)
})

test('skips speculative model downloads on data-saving connections', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } }))
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('/')
  await expect(page.locator('.home-heading')).toBeVisible()
  await page.locator('.site-nav').getByRole('link', { name: '模型广场' }).hover()
  await page.waitForTimeout(150)
  expect(requests.some(url => url.endsWith('/api/public/models') || /\/assets\/ModelsView-[^/]+\.js$/.test(url))).toBe(false)
  await page.locator('.site-nav').getByRole('link', { name: '模型广场' }).click()
  await expect(page.locator('.model-row').first()).toBeVisible()
})

test('uses immutable caching for versioned icons while keeping entry HTML updateable', async ({ request }) => {
  const icon = await request.get('/platform-icons/openai.svg?v=hourly-cache-policy')
  expect(icon.headers()['cache-control']).toContain('max-age=31536000')
  expect(icon.headers()['cache-control']).toContain('immutable')
  const unversioned = await request.get('/platform-icons/openai.svg')
  expect(unversioned.headers()['cache-control']).not.toContain('immutable')
  const html = await request.get('/models')
  expect(html.headers()['cache-control']).toContain('no-cache')
  expect(html.headers()['cache-control']).not.toContain('immutable')
})
