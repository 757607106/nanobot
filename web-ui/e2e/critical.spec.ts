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

  test('reaches dashboard after isolated bootstrap and setup completion', async ({ page }) => {
    await bootstrapAndSetup(page)
    await expect(page.getByTestId(testIds.app.navDashboard)).toBeVisible()
    await expect(page.getByText('nanobot', { exact: true })).toBeVisible()
  })

  test('persists profile changes across logout and login', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navProfile).click()
    await expect(page).toHaveURL(/\/profile$/)

    await page.getByTestId(testIds.profile.displayName).fill('Console Owner')
    await page.getByTestId(testIds.profile.email).fill('owner@example.com')
    await page.getByTestId(testIds.profile.saveProfile).click()
    await expect(page.getByTestId(testIds.profile.displayName)).toHaveValue('Console Owner')

    await page.getByTestId(testIds.app.logout).click()
    await expect(page).toHaveURL(/\/login$/)

    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByTestId(testIds.auth.username).fill('owner')
    await page.getByTestId(testIds.auth.password).fill('bootstrap-pass-123')
    await page.getByTestId(testIds.auth.submit).click()

    await page.getByTestId(testIds.app.navProfile).click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByTestId(testIds.profile.displayName)).toHaveValue('Console Owner')
    await expect(page.getByTestId(testIds.profile.email)).toHaveValue('owner@example.com')
  })

  test('supports chat upload and deterministic mock replies', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navChat).click()
    await expect(page).toHaveURL(/\/chat$/)

    await page.getByTestId(testIds.chat.newSession).click()
    await page.getByTestId(testIds.chat.fileInput).setInputFiles(BRIEF_FIXTURE_PATH)
    await page.getByTestId(testIds.chat.uploadFile).click()
    await expect(page.locator('text=/brief\\.txt/').first()).toBeVisible()

    await composerInput(page).fill('review the uploaded file')
    await composerSubmit(page).click()
    await expect(page.getByTestId(testIds.chat.bubbleList)).toContainText('E2E mock 已收到：review the uploaded file')
  })

  test('updates MCP detail and keeps isolated test chat separate', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navMcp).click()
    await expect(page).toHaveURL(/\/mcp$/)

    await page.getByTestId(`${testIds.mcp.detailLinkPrefix}fixture-mcp`).click()
    await expect(page).toHaveURL(/\/mcp\/fixture-mcp$/)

    await page.getByTestId(testIds.mcp.detailDisplayName).fill('Fixture MCP Ready')
    await page.getByTestId(testIds.mcp.detailEnv).fill('{\n  "FIXTURE_TOKEN": "demo-token"\n}')
    await page.getByTestId(testIds.mcp.detailSave).click()
    await page.getByTestId(testIds.mcp.detailToggle).click()

    await page.getByTestId(testIds.mcp.detailTestInput).fill('只测试这个 MCP')
    await page.getByTestId(testIds.mcp.detailTestSend).click()

    await expect(page.getByText('fixture-mcp fixture 回应：只测试这个 MCP')).toBeVisible()
    await page.getByTestId(testIds.app.navMcp).click()
    await page.getByTestId(`${testIds.mcp.detailLinkPrefix}fixture-mcp`).click()
    await expect(page.getByTestId(testIds.mcp.detailDisplayName)).toHaveValue('Fixture MCP Ready')
  })
})
