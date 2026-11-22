import { expect, test } from '@playwright/test'
import { MODEL_PLAZA_ENTRY } from '../src/lib/model-entry'

test('opens OpenAI on Plus and preserves explicitly chosen balance groups', async ({ page }) => {
  let syncs = 0
  page.on('request', request => { if (request.url().endsWith('/api/public/models/refresh')) syncs++ })
  await page.goto('/models')
  const openai = page.locator('.platform-list button').filter({ hasText: 'OpenAI' })
  await openai.click()
  const group = page.getByRole('combobox', { name: '使用分组', exact: true })
  await expect(page.getByRole('button', { name: '余额', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(group).toHaveValue('26')
  expect(await group.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))).toEqual(['26', '63', '119', '118'])
  for (const id of ['63', '119', '118']) {
    await group.selectOption(id)
    await expect(page).toHaveURL(new RegExp(`group=${id}(?:&|$)`))
    await expect(page.locator('.model-row').first()).toBeVisible()
    await page.reload()
    await expect(group).toHaveValue(id)
  }
  await page.getByRole('button', { name: '订阅', exact: true }).click()
  await expect(page.getByRole('button', { name: '订阅', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(group).not.toHaveValue('26')
  await openai.click()
  await expect(group).toHaveValue('26')
  expect(syncs).toBe(0)
})

test('orders OpenAI balance groups in the full directory and individual model selectors', async ({ page }) => {
  await page.goto('/models?billing=balance&platform=all&vendor=openai')
  const group = page.getByRole('combobox', { name: '使用分组', exact: true })
  await expect(group.locator('option[value="119"]')).toHaveText('ChatGPT【官Key】')
  const ids = await group.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))
  expect(ids.filter(id => ['', '26', '63', '119', '118'].includes(id))).toEqual(['', '26', '63', '119', '118'])
  const order = ['26', '63', '119', '118']
  const rowGroups = await page.locator('.directory-row-group select').evaluateAll(selects => selects.map(s => Array.from((s as HTMLSelectElement).options, o => o.value)))
  expect(rowGroups.length).toBeGreaterThan(0)
  for (const ids of rowGroups) expect(ids).toEqual(order.filter(id => ids.includes(id)))
  await group.selectOption('119')
  await expect(page.locator('.directory-group-name').first()).toHaveText('ChatGPT【官Key】')
  await expect(page.locator('.model-row').first()).toBeVisible()
})

test('opens the subscription all-model directory with group 67 from a bare URL', async ({ page }) => {
  let reads = 0, syncs = 0
  page.on('request', request => {
    if (request.url().endsWith('/api/public/models')) reads++
    if (request.url().endsWith('/api/public/models/refresh')) syncs++
  })
  await page.goto('/models')
  await expect(page).toHaveURL(new RegExp(MODEL_PLAZA_ENTRY.replace('?', '\\?') + '$'))
  await expect(page.locator('.directory-table')).toBeVisible()
  await expect(page.getByRole('button', { name: '订阅', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('combobox', { name: '使用分组', exact: true })).toHaveValue('67')
  await expect(page.locator('.platform-all')).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByRole('combobox', { name: '使用分组', exact: true })).toHaveValue('67')
  expect(reads).toBe(1); expect(syncs).toBe(0)
})

test('preserves explicit filters and makes the main navigation return to the default selection', async ({ page }) => {
  const explicit = '/models?platform=all&billing=balance&vendor=deepseek&sort=input'
  await page.goto(explicit)
  await expect(page.getByRole('combobox', { name: '模型厂商', exact: true })).toHaveValue('deepseek')
  expect(new URL(page.url()).search).toBe(new URL(explicit, 'http://localhost').search)
  await expect(page.getByRole('button', { name: '余额', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const link = page.locator('.site-nav').getByRole('link', { name: '模型广场', exact: true })
  await expect(link).toHaveAttribute('href', MODEL_PLAZA_ENTRY)
  await link.click()
  await expect(page.getByRole('combobox', { name: '使用分组', exact: true })).toHaveValue('67')
  await expect(page.getByRole('combobox', { name: '模型厂商', exact: true })).toHaveValue('')
  expect(new URL(page.url()).search).toBe('?billing=subscription&platform=all&group=67')
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '使用分组', exact: true })).toHaveValue('')
})
