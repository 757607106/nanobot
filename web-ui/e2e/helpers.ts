import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { testIds } from '../src/testIds'

export const E2E_USERNAME = 'owner'
export const E2E_PASSWORD = 'bootstrap-pass-123'
export const BRIEF_FIXTURE_PATH = path.resolve(process.cwd(), 'e2e/fixtures/brief.txt')

export async function bootstrapAndSetup(page: Page) {
  await page.goto('/login')
  await expect(page.getByTestId(testIds.auth.username)).toBeVisible()

  const bootstrap = await page.request.post('/api/v1/auth/bootstrap', {
    data: {
      username: E2E_USERNAME,
      password: E2E_PASSWORD,
    },
  })
  expect(bootstrap.ok()).toBeTruthy()

  const provider = await page.request.put('/api/v1/setup/provider', {
    data: {
      provider: 'deepseek',
      model: 'deepseek/deepseek-chat',
      apiKey: 'sk-e2e-setup',
      apiBase: 'https://api.deepseek.com',
    },
  })
  expect(provider.ok()).toBeTruthy()

  const channel = await page.request.put('/api/v1/setup/channel', {
    data: {
      mode: 'skip',
    },
  })
  expect(channel.ok()).toBeTruthy()

  const agent = await page.request.put('/api/v1/setup/agent-defaults', {
    data: {
      workspace: '/tmp/nanobot-playwright-workspace',
      maxTokens: 4096,
      contextWindowTokens: 128000,
      temperature: 0.4,
      maxToolIterations: 18,
      reasoningEffort: 'medium',
    },
  })
  expect(agent.ok()).toBeTruthy()

  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard$/)
}

export async function login(page: Page, targetPath = '/dashboard') {
  await page.goto(targetPath)
  await expect(page).toHaveURL(/\/login$/)
  await page.getByTestId(testIds.auth.username).fill(E2E_USERNAME)
  await page.getByTestId(testIds.auth.password).fill(E2E_PASSWORD)
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByTestId(testIds.auth.submit).click(),
  ])
}

export function composerInput(page: Page): Locator {
  return page.getByTestId(testIds.chat.composer).locator('textarea, [contenteditable="true"]').first()
}

export function composerSubmit(page: Page): Locator {
  return page.getByTestId(testIds.chat.composer).locator('button').last()
}
