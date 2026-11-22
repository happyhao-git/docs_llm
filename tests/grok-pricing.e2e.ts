import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  if (process.env.MODEL_PREVIEW_CATALOG) {
    const catalog = JSON.parse(await readFile(process.env.MODEL_PREVIEW_CATALOG, 'utf8'))
    await page.route('**/api/public/models', route => route.fulfill({ json: catalog }))
  }
})

test('shows Grok 4.7 standard and long-context prices in each billing group', async ({ page }) => {
  for (const [mode, group] of [['subscription', '65'], ['subscription', '67'], ['balance', '64']]) {
    const balance = mode === 'balance'
    await page.goto(`/models?platform=grok&billing=${mode}&group=${group}&q=grok-4.7`)
    await expect(page.locator('.model-row')).toHaveCount(1)
    await expect(page.locator('.model-row .model-price strong')).toHaveText(balance
      ? ['实际价格 ¥0.56', '实际价格 ¥1.68', '实际价格 ¥0.14'] : ['实际价格 ¥0.42', '实际价格 ¥1.26', '实际价格 ¥0.105'])
    await expect(page.locator('.model-row .price-official')).toHaveText(['官方价格 $2', '官方价格 $6', '官方价格 $0.5'])
    await expect(page.locator('.model-row .price-unavailable')).toHaveCount(0)
    await page.getByRole('button', { name: 'grok-4.7', exact: true }).click()
    await expect(page.locator('.scenario-heading strong')).toHaveText(['标准', '长上下文'])
    await expect(page.locator('.scenario-heading small')).toHaveText(['输入 < 200K token', '输入 ≥ 200K token'])
    await expect(page.locator('.comparison-table tbody tr').nth(0).locator('.model-price strong')).toHaveText(balance
      ? ['实际价格 ¥0.56', '实际价格 ¥1.12'] : ['实际价格 ¥0.42', '实际价格 ¥0.84'])
    await expect(page.locator('.comparison-table tbody tr').nth(1).locator('.model-price strong')).toHaveText(balance
      ? ['实际价格 ¥1.68', '实际价格 ¥3.36'] : ['实际价格 ¥1.26', '实际价格 ¥2.52'])
    await expect(page.locator('.comparison-table tbody tr').nth(2).locator('.model-price strong')).toHaveText(balance
      ? ['实际价格 ¥0.14', '实际价格 ¥0.28'] : ['实际价格 ¥0.105', '实际价格 ¥0.21'])
    await expect(page.locator('.official-link')).toHaveAttribute('href', 'https://docs.x.ai/developers/models/grok-4.7')
  }
})

test('keeps the compact platform navigation usable on mobile without a title bar', async ({ page }) => {
  await page.goto('/models?platform=grok&q=grok-4.7')
  await expect(page.locator('.model-row')).toHaveCount(1)
  await expect(page.locator('.models-sidebar-heading')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '关闭平台导航' })).toHaveCount(0)
  await page.screenshot({ path: '/tmp/linkapi-grok-sidebar-desktop.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  const trigger = page.locator('.models-platform-trigger')
  await trigger.click()
  await expect(page.getByRole('dialog', { name: '模型平台' })).toBeVisible()
  await page.screenshot({ path: '/tmp/linkapi-grok-sidebar-mobile.png', animations: 'disabled' })
  await page.locator('.sidebar-backdrop').click({ position: { x: 370, y: 100 } })
  await expect(page.getByRole('dialog', { name: '模型平台' })).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.locator('.platform-list button').filter({ hasText: 'OpenAI' }).click()
  await expect(page.getByRole('dialog', { name: '模型平台' })).toHaveCount(0)
  await expect(trigger).toContainText('OpenAI')
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
