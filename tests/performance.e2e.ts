import { expect, test } from '@playwright/test'

test('requests the article alongside navigation and avoids webfont downloads', async ({ page, request }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const requests: string[] = []
  page.on('request', req => requests.push(req.url()))
  await page.route('**/api/public/navigation', async route => { await gate; await route.continue() })
  await page.goto('/docs/windows-install-codex', { waitUntil: 'domcontentloaded' })
  try {
    await expect.poll(() => requests.some(url => url.endsWith('/api/public/documents/windows-install-codex'))).toBe(true)
  } finally { release() }
  await expect(page.locator('.doc-section h1')).toHaveText('Windows 安装与配置 Codex')
  await page.evaluate(() => document.fonts.ready)
  expect(requests.filter(url => /\.woff2?(?:\?|$)/.test(url))).toEqual([])
  const css = requests.find(url => /\/assets\/[^/]+\.css/.test(url))!
  expect((await request.get(css)).headers()['cache-control']).toContain('max-age=31536000')
  expect((await request.get('/docs/windows-install-codex')).headers()['cache-control']).toContain('no-cache')
})

test('prefetches adjacent articles and returns to cached articles without a request', async ({ page }) => {
  const requests: string[] = []
  page.on('request', req => { if (req.url().includes('/api/public/documents/')) requests.push(req.url().split('/').pop()!) })
  const prefetched = page.waitForResponse(res => res.url().endsWith('/api/public/documents/mac-install-codex'))
  await page.goto('/docs/windows-install-codex')
  await expect(page.locator('.doc-section h1')).toHaveText('Windows 安装与配置 Codex')
  await (await prefetched).finished()
  await page.route('**/api/public/documents/mac-install-codex', route => route.abort())
  await page.locator('.sidebar-link[href="/docs/mac-install-codex"]').click()
  await expect(page.locator('.doc-section h1')).toHaveText('Mac / Linux 安装与配置 Codex')
  await expect(page.locator('.article-skeleton')).toHaveCount(0)
  await page.locator('.sidebar-link[href="/docs/windows-install-codex"]').click()
  await expect(page.locator('.doc-section h1')).toHaveText('Windows 安装与配置 Codex')
  expect(requests.filter(slug => slug === 'windows-install-codex')).toHaveLength(1)
  expect(requests.filter(slug => slug === 'mac-install-codex')).toHaveLength(1)
})

test('refreshes cached articles after a publication changes and removes withdrawn content', async ({ page, request }) => {
  const navigation = await (await request.get('/api/public/navigation')).json()
  const original = await (await request.get('/api/public/documents/windows-install-codex')).json()
  let revision = 0
  await page.route('**/api/public/navigation', route => {
    const nav = structuredClone(navigation)
    nav.publication.id += revision
    if (revision === 2) nav.groups.forEach((group: any) => { group.documents = group.documents.filter((doc: any) => doc.slug !== 'windows-install-codex') })
    return route.fulfill({ json: nav })
  })
  await page.route('**/api/public/documents/windows-install-codex', route => {
    const payload = structuredClone(original)
    payload.publication.id += revision
    if (revision === 2) return route.fulfill({ status: 404, json: { publication: payload.publication, error: '已下线' } })
    if (revision === 1) payload.document.title = '更新后的 Windows 教程'
    return route.fulfill({ json: payload })
  })
  await page.goto('/docs/windows-install-codex')
  await expect(page.locator('.doc-section h1')).toHaveText(original.document.title)
  revision = 1
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('.doc-section h1')).toHaveText('更新后的 Windows 教程')
  revision = 2
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('.empty-docs h1')).toHaveText('没有找到这篇教程')
  await expect(page.locator('.sidebar-link[href="/docs/windows-install-codex"]')).toHaveCount(0)
})

test('keeps the latest selected tutorial when an earlier request finishes late', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/public/documents/mac-install-codex', async route => { await gate; await route.continue() })
  await page.goto('/docs/windows-install-codex')
  await expect(page.locator('.doc-section h1')).toBeVisible()
  await page.locator('.sidebar-link[href="/docs/mac-install-codex"]').click()
  const claudeGroup = page.locator('.sidebar-group').filter({ has: page.locator('a[href="/docs/windows-install-claude"]') }).locator('.sidebar-group-label')
  if (await claudeGroup.getAttribute('aria-expanded') === 'false') await claudeGroup.click()
  await page.locator('.sidebar-link[href="/docs/windows-install-claude"]').click()
  await expect(page.locator('.doc-section h1')).toHaveText('Windows 安装与配置 Claude')
  const late = page.waitForResponse(res => res.url().endsWith('/api/public/documents/mac-install-codex'))
  release()
  await (await late).finished()
  await expect(page.locator('.doc-section h1')).toHaveText('Windows 安装与配置 Claude')
  await expect(page).toHaveURL(/windows-install-claude$/)
})

test('respects data-saving connections without disabling normal navigation', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } }))
  const articles: string[] = []
  page.on('request', req => { if (req.url().includes('/api/public/documents/')) articles.push(req.url()) })
  await page.goto('/docs/windows-install-codex')
  await expect(page.locator('.doc-section h1')).toBeVisible()
  await page.locator('.sidebar-link[href="/docs/mac-install-codex"]').hover()
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)))
  expect(articles).toHaveLength(1)
  await page.locator('.sidebar-link[href="/docs/mac-install-codex"]').click()
  await expect(page.locator('.doc-section h1')).toHaveText('Mac / Linux 安装与配置 Codex')
  expect(articles).toHaveLength(2)
})
