import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { bootstrapAndSetup } from './helpers'

async function waitForMotionToSettle(page: Page) {
  for (const selector of ['.app-sider-panel', '.app-content-motion']) {
    const locator = page.locator(selector).first()
    if (await locator.count()) {
      await expect
        .poll(async () => locator.evaluate((node) => Math.round(Number.parseFloat(getComputedStyle(node).opacity || '1') * 100)))
        .toBe(100)
    }
  }
  await page.waitForTimeout(100)
}

async function expectNoSeriousViolations(page: Page) {
  await waitForMotionToSettle(page)
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

test.describe.serial('accessibility smoke @a11y', () => {
  test('login and setup entry screens have no serious violations', async ({ page }) => {
    await page.goto('/login')
    await expectNoSeriousViolations(page)
  })

  test('chat landing and mcp detail have no serious violations', async ({ page }) => {
    await bootstrapAndSetup(page)
    await expectNoSeriousViolations(page)

    await page.goto('/chat')
    await expectNoSeriousViolations(page)

    await page.goto('/mcp/fixture-mcp')
    await expectNoSeriousViolations(page)
  })
})
