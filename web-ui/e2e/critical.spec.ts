import { expect, test } from '@playwright/test'
import { testIds } from '../src/testIds'
import {
  BRIEF_FIXTURE_PATH,
  bootstrapAndSetup,
  composerInput,
  composerSubmit,
  login,
} from './helpers'

test.describe.serial('critical gui flows @critical', () => {
  test.setTimeout(60_000)

  test('reaches chat workspace after isolated bootstrap and setup completion', async ({ page }) => {
    await bootstrapAndSetup(page)
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.getByTestId(testIds.app.navChat)).toBeVisible()
    await expect(page.getByTestId(testIds.chat.newSession)).toBeVisible()
  })

  test('persists profile changes across logout and login', async ({ page }) => {
    await login(page, '/system/admin')
    await expect(page).toHaveURL(/\/system\/admin$/)

    await page.getByRole('button', { name: '编辑资料' }).first().click()
    const profileDialog = page.getByRole('dialog', { name: '编辑账户资料' })
    await profileDialog.getByTestId(testIds.profile.displayName).fill('Console Owner')
    await profileDialog.getByTestId(testIds.profile.email).fill('owner@example.com')
    await profileDialog.getByRole('button', { name: /保\s*存/ }).click()
    await expect(profileDialog).toHaveCount(0)
    await expect(page.locator('.account-admin-user-secondary').filter({ hasText: 'Console Owner' })).toBeVisible()

    await page.locator(`[data-testid="${testIds.app.logout}"]:visible`).first().click()
    await expect(page).toHaveURL(/\/login$/)

    await login(page, '/system/admin')
    await expect(page).toHaveURL(/\/system\/admin$/)
    await page.getByRole('button', { name: '编辑资料' }).first().click()
    const reopenedProfileDialog = page.getByRole('dialog', { name: '编辑账户资料' })
    await expect(reopenedProfileDialog.getByTestId(testIds.profile.displayName)).toHaveValue('Console Owner')
    await expect(reopenedProfileDialog.getByTestId(testIds.profile.email)).toHaveValue('owner@example.com')
  })

  test('supports chat upload and deterministic mock replies', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navChat).click()
    await expect(page).toHaveURL(/\/chat$/)

    await page.getByTestId(testIds.chat.newSession).click()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId(testIds.chat.uploadFile).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(BRIEF_FIXTURE_PATH)
    await expect(page.locator('text=/brief\\.txt/').first()).toBeVisible()

    await composerInput(page).fill('review the uploaded file')
    await composerSubmit(page).click()
    const bubbleList = page.getByTestId(testIds.chat.bubbleList)
    await expect(bubbleList).toContainText('E2E mock 已收到：[附加文件]')
    await expect(bubbleList).toContainText(/brief\.txt/)
    await expect(bubbleList).toContainText('review the uploaded file')
  })

  test('enables MCP detail and shows current tools', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navMcp).click()
    await expect(page).toHaveURL(/\/mcp$/)

    await page.getByTestId(`${testIds.mcp.detailLinkPrefix}fixture-mcp`).click()
    await expect(page).toHaveURL(/\/mcp\/fixture-mcp$/)

    const toggleResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/v1/mcp/servers/fixture-mcp/enabled') &&
      response.request().method() === 'POST'
    ))
    await page.getByTestId(testIds.mcp.detailToggle).click()
    const toggleResponse = await toggleResponsePromise
    expect(toggleResponse.ok()).toBeTruthy()
    const togglePayload = await toggleResponse.json()
    expect(togglePayload.data.entry.enabled).toBe(true)
    await expect(page.getByText('fixture_search')).toBeVisible()
    await expect(page.getByText('fixture_read')).toBeVisible()
    await page.getByTestId(testIds.app.navMcp).click()
    await page.getByTestId(`${testIds.mcp.detailLinkPrefix}fixture-mcp`).click()
    await expect(page.getByTestId(testIds.mcp.detailToggle)).toContainText('立即停用')
  })
})
