import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// This suite creates/deletes drafts only in the disposable server on port 8091.
test.describe.serial('Document actions in the navigation tree', () => {
  let groupId: number
  let headers: Record<string, string>
  let request: APIRequestContext
  let cookies: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies']

  test.beforeAll(async ({ playwright, baseURL }) => {
    expect(baseURL).toBe('http://127.0.0.1:8091')
    request = await playwright.request.newContext({ baseURL })
    const login = await request.post('/api/admin/login', {
      data: { username: 'verification', password: 'docs-verification-only' }
    })
    expect(login.ok()).toBeTruthy()
    cookies = (await request.storageState()).cookies
    headers = { 'X-CSRF-Token': decodeURIComponent(cookies.find(cookie => cookie.name === 'docs_csrf')!.value) }
  })

  test.beforeEach(async ({ context }) => {
    groupId = 0
    await context.addCookies(cookies)
    const group = await request.post('/api/admin/groups', { headers, data: { name: '目录操作验证', isVisible: true } })
    expect(group.ok()).toBeTruthy()
    groupId = (await group.json()).id
  })

  test.afterEach(async () => {
    if (groupId) expect((await request.delete(`/api/admin/groups/${groupId}`, { headers })).ok()).toBeTruthy()
  })
  test.afterAll(async () => { await request?.dispose() })

  const group = (page: Page) => page.locator(`[data-group-id="${groupId}"]`)
  const row = (page: Page, id: number) => page.locator(`[data-document-id="${id}"]`)
  const dialog = (page: Page) => page.getByRole('dialog', { name: '删除文档草稿' })
  const create = async (page: Page) => {
    const response = page.waitForResponse(response => response.url().endsWith('/api/admin/documents') && response.request().method() === 'POST')
    await group(page).locator('.group-add-document').click()
    const id = (await (await response).json()).id as number
    await expect(row(page, id)).toHaveClass(/active/)
    await expect(group(page).locator('.group-add-document')).toBeEnabled()
    return id
  }
  const remove = async (page: Page, id: number) => {
    await row(page, id).locator('.document-delete').click()
    await dialog(page).getByRole('button', { name: '确认', exact: true }).click()
    await expect(row(page, id)).toHaveCount(0)
    await expect(group(page).locator('.group-add-document')).toBeEnabled()
  }

  test('creates from the group, cancels deletion, then deletes a blank unnamed draft', async ({ page }) => {
    const published = await (await request.get('/api/public/navigation')).json()
    await page.goto('/admin')
    const plus = group(page).locator('.group-add-document')
    await expect(plus).toBeVisible()
    expect(await plus.evaluate(el => el.previousElementSibling?.getAttribute('title'))).toBe('删除分组')
    await expect(page.locator('.add-document')).toHaveCount(0)
    const id = await create(page)
    await expect(page.locator('#article-title')).toHaveValue('未命名文档')
    await expect(page.getByRole('textbox', { name: 'Markdown 正文' })).toHaveValue('')
    const trash = row(page, id).locator('.document-delete')
    await expect(trash).toHaveCSS('opacity', '1')
    await trash.focus()
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toContainText('未命名文档')
    await dialog(page).getByRole('button', { name: '取消', exact: true }).click()
    await expect(trash).toBeFocused()
    await expect(row(page, id)).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: '/tmp/linkapi-navigation-actions/desktop.png' })
    await remove(page, id)
    await expect(page.locator('.admin-editor')).toBeVisible()
    const content = await (await request.get('/api/admin/content')).json()
    expect(content.groups.flatMap((item: any) => item.documents).some((doc: any) => doc.id === id)).toBe(false)
    expect(await (await request.get('/api/public/navigation')).json()).toEqual(published)
    await page.reload()
    await expect(row(page, id)).toHaveCount(0)
  })

  test('deletes another document without selecting it or losing unsaved edits', async ({ page }) => {
    await page.goto('/admin')
    const first = await create(page)
    const second = await create(page)
    await row(page, first).locator('.tree-document-select').click()
    const editor = page.getByRole('textbox', { name: 'Markdown 正文' })
    await editor.fill('保留这篇文档尚未保存的内容。')
    await remove(page, second)
    await expect(row(page, first)).toHaveClass(/active/)
    await expect(editor).toHaveValue('保留这篇文档尚未保存的内容。')
    await expect(row(page, first).locator('.dirty-dot')).toBeVisible()
    // An empty, unsaved title must not force a save before deletion.
    await page.locator('#article-title').fill('')
    await row(page, first).locator('.document-delete').click()
    await expect(dialog(page)).toContainText('未命名文档')
    await expect(dialog(page)).toContainText('未保存的修改也会删除')
    await dialog(page).getByRole('button', { name: '确认', exact: true }).click()
    await expect(row(page, first)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '请先保存草稿', exact: true })).toHaveCount(0)
  })

  test('keeps a draft on failed deletion and allows retry', async ({ page }) => {
    await page.goto('/admin')
    const id = await create(page)
    await page.route(`**/api/admin/documents/${id}`, async route => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '删除失败，请重试' }) })
      } else await route.continue()
    })
    await row(page, id).locator('.document-delete').click()
    await dialog(page).getByRole('button', { name: '确认', exact: true }).click()
    await expect(page.getByText('删除失败，请重试', { exact: true })).toBeVisible()
    await expect(row(page, id)).toBeVisible()
    await expect(row(page, id).locator('.document-delete')).toBeEnabled()
    await page.unroute(`**/api/admin/documents/${id}`)
    await remove(page, id)
  })

  test('prevents duplicate drafts during repeated create clicks', async ({ page }) => {
    let count = 0
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/admin/documents', async route => {
      if (route.request().method() === 'POST') { count += 1; await pending }
      await route.continue()
    })
    await page.goto('/admin')
    const plus = group(page).locator('.group-add-document')
    await plus.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); el.click() })
    await expect(plus).toBeDisabled()
    await expect.poll(() => count).toBe(1)
    release()
    await expect(group(page).locator('.tree-document')).toHaveCount(1)
    await expect(plus).toBeEnabled()
    const content = await (await request.get('/api/admin/content')).json()
    expect(content.groups.find((item: any) => item.id === groupId).documents).toHaveLength(1)
  })

  test('shows mobile actions and keeps confirmation focus within the dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin')
    await page.getByRole('button', { name: '打开内容导航' }).click()
    const id = await create(page)
    await expect(page.locator('.admin-sidebar')).not.toBeVisible()
    await page.getByRole('button', { name: '打开内容导航' }).click()
    const trash = row(page, id).locator('.document-delete')
    await expect(trash).toBeVisible()
    await expect(trash).toHaveCSS('opacity', '1')
    await expect(page.locator('.admin-sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: '/tmp/linkapi-navigation-actions/mobile.png', animations: 'disabled' })
    await trash.click()
    await expect(page.locator('.admin-sidebar')).not.toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    const confirm = dialog(page).getByRole('button', { name: '确认', exact: true })
    await confirm.focus()
    await page.keyboard.press('Tab')
    expect(await dialog(page).evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.screenshot({ path: '/tmp/linkapi-navigation-actions/mobile-confirmation.png' })
    await confirm.click()
    await expect(dialog(page)).not.toBeVisible()
    await page.getByRole('button', { name: '打开内容导航' }).click()
    await expect(row(page, id)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test('still reorders documents using their drag handles', async ({ page }) => {
    await page.goto('/admin')
    const first = await create(page)
    const second = await create(page)
    const handle = row(page, second).locator('.doc-drag-handle')
    await handle.scrollIntoViewIfNeeded()
    const from = (await handle.boundingBox())!
    const to = (await row(page, first).boundingBox())!
    const reordered = page.waitForResponse(response => response.url().endsWith('/api/admin/reorder') && response.request().method() === 'PUT')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + 20, to.y + 5, { steps: 20 })
    await page.mouse.up()
    expect((await reordered).ok()).toBeTruthy()
    await expect(group(page).locator('.tree-document').first()).toHaveAttribute('data-document-id', String(second))
    const content = await (await request.get('/api/admin/content')).json()
    expect(content.groups.find((item: any) => item.id === groupId).documents.map((doc: any) => doc.id)).toEqual([second, first])
  })
})
