import { expect, test } from '@playwright/test'

const names = ['ChatGPT【稳定】', 'ChatGPT-Pro【企业稳定】', 'ChatGPT【官Key】']

test('switches subscription pool prices, retains selection across plans and reloads without source reads', async ({ page }) => {
  let reads = 0, syncs = 0
  page.on('request', request => {
    if (request.url().endsWith('/api/public/models')) reads++
    if (request.url().endsWith('/api/public/models/refresh')) syncs++
  })
  await page.goto('/models?billing=subscription&platform=openai&group=12&q=gpt-6.1-terra')
  const pool = page.getByRole('combobox', { name: '账号池', exact: true })
  const group = page.getByRole('combobox', { name: '使用分组', exact: true })
  await expect(pool.locator('option')).toHaveText(names)
  await expect(pool.locator('option:checked')).toHaveText(names[0])
  for (const [index, name] of names.entries()) {
    await group.selectOption('12')
    await pool.selectOption({ label: name })
    await expect(page.locator('.coefficient-badge')).toHaveText(`折算 ${['0.08', '0.16', '0.3'][index]}x`)
    const prices = await page.locator('.model-row .model-price strong').allTextContents()
    expect(prices.length).toBeGreaterThan(0)
    await group.selectOption('67')
    await expect(pool.locator('option:checked')).toHaveText(name)
    await expect(page.locator('.model-row .model-price strong')).toHaveText(prices)
    await page.reload()
    await expect(pool.locator('option:checked')).toHaveText(name)
  }
  await page.getByRole('button', { name: '余额', exact: true }).click()
  await expect(pool).toHaveCount(0)
  await page.getByRole('button', { name: '订阅', exact: true }).click()
  await expect(pool.locator('option:checked')).toHaveText(names[0])
  expect(reads).toBe(1)
  expect(syncs).toBe(0)
})

test('uses selected pools in the all-model directory, export and reset', async ({ page }) => {
  await page.goto('/models')
  const pool = page.getByRole('combobox', { name: '账号池', exact: true })
  await expect(pool).toHaveCount(0)
  await page.getByRole('combobox', { name: '模型厂商', exact: true }).selectOption('openai')
  await expect(pool.locator('option:checked')).toHaveText(names[0])
  await pool.selectOption({ label: names[2] })
  await page.getByRole('textbox', { name: '搜索模型', exact: true }).fill('gpt-6.1-terra')
  const key = await pool.inputValue()
  await expect(page.locator('.model-row')).toHaveCount(1)
  await expect(page.locator('.directory-row-rate')).toContainText('0.3x')
  const exporting = page.waitForRequest('**/api/public/models/export.pdf')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const body = (await exporting).postDataJSON()
  expect(body.rows).toHaveLength(1)
  expect(body.rows[0]).toMatchObject({ poolKey: key, groupId: '67' })
  expect(await (await downloaded).failure()).toBeNull()
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(pool).toHaveCount(0)
  expect(new URL(page.url()).searchParams.has('pool')).toBe(false)
})

test('keeps subscription pool controls usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/models?billing=subscription&platform=openai&group=67')
  const pool = page.getByRole('combobox', { name: '账号池', exact: true })
  await expect(pool).toBeVisible()
  await pool.selectOption({ label: names[1] })
  const group = await page.getByRole('combobox', { name: '使用分组', exact: true }).boundingBox()
  const box = await pool.boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(group!.y + group!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.reload()
  await expect(pool.locator('option:checked')).toHaveText(names[1])
})
