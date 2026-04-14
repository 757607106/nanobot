import { expect, test } from '@playwright/test'
import { testIds } from '../src/testIds'
import {
  BRIEF_FIXTURE_PATH,
  bootstrapAndSetup,
  composerInput,
  composerSubmit,
  login,
  uniqueE2EName,
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
    await expect(page.getByText('Console Owner', { exact: true }).first()).toBeVisible()

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
    await page.getByRole('button', { name: '添加附件' }).click()
    await page.locator('input[type="file"]').first().setInputFiles(BRIEF_FIXTURE_PATH)
    await expect(page.locator('text=/brief\\.txt/').first()).toBeVisible()

    await composerInput(page).fill('review the uploaded file')
    await composerSubmit(page).click()
    const bubbleList = page.getByTestId(testIds.chat.bubbleList)
    await expect(bubbleList).toContainText('E2E mock 已收到：[附加文件]')
    await expect(bubbleList).toContainText(/brief\.txt/)
    await expect(bubbleList).toContainText('review the uploaded file')
  })

  test('switches to custom agent and keeps chat UX parity', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navChat).click()
    await expect(page).toHaveURL(/\/chat$/)

    const agentName = uniqueE2EName('E2E Agent')
    const createdAgent = await page.request.post('/api/v1/agents', {
      data: {
        name: agentName,
        systemPrompt: 'You are an E2E agent.',
      },
    })
    expect(createdAgent.ok()).toBeTruthy()
    const createdPayload = await createdAgent.json()
    const agentId = createdPayload.data.agentId as string
    expect(agentId).toBeTruthy()

    await page.goto(`/chat/agent/${agentId}`)
    await expect(page).toHaveURL(new RegExp(`/chat/agent/${agentId}$`))

    await expect(page.getByTestId(testIds.chat.newSession)).toBeVisible()
    await page.getByTestId(testIds.chat.newSession).click()
    await page.getByRole('button', { name: '添加附件' }).click()
    await page.locator('input[type="file"]').first().setInputFiles(BRIEF_FIXTURE_PATH)
    await expect(page.locator('text=/brief\\.txt/').first()).toBeVisible()

    await composerInput(page).fill('review the uploaded file')
    await composerSubmit(page).click()
    const bubbleList = page.getByTestId(testIds.chat.bubbleList)
    await expect(bubbleList).toContainText('review the uploaded file')
    await expect(bubbleList).toContainText('E2E mock 已收到：[附加文件]')
  })

  test('enables MCP detail and shows current tools', async ({ page }) => {
    await login(page)
    await page.getByTestId(testIds.app.navMcp).click()
    await expect(page).toHaveURL(/\/mcp$/)

    await page.locator('.server-card').filter({ hasText: 'fixture-mcp' }).first().click()
    await expect(page).toHaveURL(/\/mcp\/fixture-mcp$/)

    const toggleResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/v1/mcp/servers/fixture-mcp/enabled') &&
      response.request().method() === 'POST'
    ))
    const toggleButton = page.getByRole('button', { name: /立即启用|立即停用/ }).first()
    await toggleButton.click()
    const toggleResponse = await toggleResponsePromise
    expect(toggleResponse.ok()).toBeTruthy()
    const togglePayload = await toggleResponse.json()
    expect(togglePayload.data.entry.enabled).toBe(true)
    await expect(page.getByText('fixture_search').first()).toBeVisible()
    await expect(page.getByText('fixture_read').first()).toBeVisible()
    await expect(toggleButton).toContainText('立即停用')
  })
})
