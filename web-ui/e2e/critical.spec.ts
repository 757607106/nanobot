import { expect, test } from '@playwright/test'
import { PLATFORM_BRAND_NAME } from '../src/branding'
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

  test('reaches dashboard after isolated bootstrap and setup completion', async ({ page }) => {
    await bootstrapAndSetup(page)
    await expect(page.getByTestId(testIds.app.navChat)).toBeVisible()
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.getByRole('heading', { name: PLATFORM_BRAND_NAME, level: 2 })).toBeVisible()
  })

  test('persists profile changes across logout and login', async ({ page }) => {
    await login(page)
    await page.goto('/system/admin')
    await expect(page).toHaveURL(/\/system\/admin$/)

    await page.getByTestId(testIds.profile.displayName).fill('Console Owner')
    await page.getByTestId(testIds.profile.email).fill('owner@example.com')
    await page.getByTestId(testIds.profile.saveProfile).click()
    await expect(page.getByTestId(testIds.profile.displayName)).toHaveValue('Console Owner')

    await page.locator(`[data-testid="${testIds.app.logout}"]:visible`).click()
    await expect(page).toHaveURL(/\/login$/)

    await login(page, '/system/admin')
    await expect(page).toHaveURL(/\/system\/admin$/)
    await expect(page.getByTestId(testIds.profile.displayName)).toHaveValue('Console Owner')
    await expect(page.getByTestId(testIds.profile.email)).toHaveValue('owner@example.com')
  })

  test('supports chat upload and deterministic mock replies', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navChat).click()
    await expect(page).toHaveURL(/\/chat$/)

    await page.getByTestId(testIds.chat.newSession).click()
    await page
      .getByTestId(testIds.chat.fileInput)
      .locator('input[type="file"]')
      .first()
      .setInputFiles(BRIEF_FIXTURE_PATH)
    await expect(page.locator('text=/brief\\.txt/').first()).toBeVisible()

    await composerInput(page).fill('review the uploaded file')
    await composerSubmit(page).click()
    await expect(page.getByTestId(testIds.chat.bubbleList)).toContainText('E2E mock 已收到：[附加文件]')
    await expect(page.getByTestId(testIds.chat.bubbleList)).toContainText('[用户问题]')
    await expect(page.getByTestId(testIds.chat.bubbleList)).toContainText('review the uploaded file')
  })

  test('updates MCP detail and keeps isolated test chat separate', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navMcp).click()
    await expect(page).toHaveURL(/\/mcp$/)

    await page.getByTestId(`${testIds.mcp.detailLinkPrefix}fixture-mcp`).click()
    await expect(page).toHaveURL(/\/mcp\/fixture-mcp$/)
    const displayNameInput = page.getByTestId(testIds.mcp.detailDisplayName)
    await expect(displayNameInput).toHaveValue('Fixture MCP')

    await displayNameInput.fill('Fixture MCP Ready')
    await expect(displayNameInput).toHaveValue('Fixture MCP Ready')
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/mcp/servers/fixture-mcp') &&
        response.request().method() === 'PUT',
    )
    await page.getByTestId(testIds.mcp.detailSave).click()
    expect((await saveResponsePromise).ok()).toBeTruthy()
    await page.getByTestId(testIds.mcp.detailToggle).click()

    await page.getByTestId(testIds.mcp.detailTestInput).fill('只测试这个 MCP')
    await page.getByTestId(testIds.mcp.detailTestSend).click()

    await expect(page.getByText('fixture-mcp fixture 回应：只测试这个 MCP')).toBeVisible()
    await page.getByTestId(testIds.app.navMcp).click()
    await page.getByTestId(`${testIds.mcp.detailLinkPrefix}fixture-mcp`).click()
    await expect(page.getByText('fixture-mcp fixture 回应：只测试这个 MCP')).toBeVisible()
  })
})
