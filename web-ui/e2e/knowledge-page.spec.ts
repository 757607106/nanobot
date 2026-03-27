import { expect, test } from '@playwright/test'
import { bootstrapAndSetup, uniqueE2EName } from './helpers'

async function waitForKnowledgeJob(page: import('@playwright/test').Page, kbId: string, jobId: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const response = await page.request.get(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/jobs`)
    expect(response.ok()).toBeTruthy()
    const payload = await response.json()
    const job = (payload.data || []).find((item: { jobId: string }) => item.jobId === jobId)
    if (job && (job.status === 'succeeded' || job.status === 'failed')) {
      return job
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`Timed out waiting for knowledge job ${jobId}`)
}

test.describe.serial('knowledge workspace e2e', () => {
  test.setTimeout(120_000)

  test('knowledge page loads detail, file preview, query, and graph tab', async ({ page }) => {
    await bootstrapAndSetup(page)
    const kbName = uniqueE2EName('Knowledge Page E2E')

    const kbCreated = await page.request.post('/api/v1/knowledge-bases', {
      data: {
        name: kbName,
        description: 'Knowledge workspace smoke test.',
      },
    })
    expect(kbCreated.ok()).toBeTruthy()
    const kbPayload = await kbCreated.json()
    const kbId = kbPayload.data.kbId as string

    const sourceCreated = await page.request.post(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/sources`, {
      data: {
        sourceType: 'faq_table',
        title: 'Ops FAQ',
        items: [
          {
            question: 'How do we restart nanobot?',
            answer: 'Use supervisorctl restart nanobot after checking service health.',
          },
          {
            question: 'How do we clear the cache?',
            answer: 'Run cache warmup first, then trigger the cache reset task.',
          },
        ],
      },
    })
    expect(sourceCreated.ok()).toBeTruthy()
    const sourcePayload = await sourceCreated.json()
    const fileId = sourcePayload.data.fileId as string

    const parseCreated = await page.request.post(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/files/parse`, {
      data: { fileIds: [fileId] },
    })
    expect(parseCreated.status()).toBe(202)
    const parsePayload = await parseCreated.json()
    const parseJob = await waitForKnowledgeJob(page, kbId, parsePayload.data.job.jobId)
    expect(parseJob.status).toBe('succeeded')

    const indexCreated = await page.request.post(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/files/index`, {
      data: { fileIds: [fileId] },
    })
    expect(indexCreated.status()).toBe(202)
    const indexPayload = await indexCreated.json()
    const indexJob = await waitForKnowledgeJob(page, kbId, indexPayload.data.job.jobId)
    expect(indexJob.status).toBe('succeeded')

    await page.goto('/knowledge')
    await expect(page).toHaveURL(/\/knowledge$/)
    await expect(page.getByText(kbName)).toBeVisible()
    await page.getByRole('button', { name: kbName }).click()

    await expect(page).toHaveURL(new RegExp(`/knowledge/${kbId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await expect(page.getByText(kbName)).toBeVisible()
    const fileRow = page.locator('tr').filter({ hasText: 'Ops FAQ.json' }).first()
    await expect(fileRow).toBeVisible()

    await fileRow.getByRole('button', { name: 'file-search' }).first().click()
    const fileDetailDialog = page.getByRole('dialog', { name: /文件详情/ })
    await expect(fileDetailDialog).toBeVisible()
    await expect(fileDetailDialog.getByText('Use supervisorctl restart nanobot after checking service health.')).toBeVisible()
    await fileDetailDialog.getByRole('button', { name: 'Close' }).click()
    await expect(fileDetailDialog).toHaveCount(0)

    await page.getByRole('tab', { name: '检索测试' }).click()
    const queryInput = page.getByPlaceholder('输入你要验证的知识库问题...')
    await queryInput.fill('How do we clear the cache?')
    await page.getByRole('button', { name: '查询知识库' }).click()
    await expect(page.getByText('Run cache warmup first, then trigger the cache reset task.')).toBeVisible()

    const graphStatsResponse = await page.request.get(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/graph/stats`)
    expect(graphStatsResponse.ok()).toBeTruthy()
    const graphStatsPayload = await graphStatsResponse.json()
    const nodeCount = Number(graphStatsPayload.data?.nodeCount || 0)

    await page.getByRole('tab', { name: '知识图谱' }).click()
    await expect(page.getByRole('button', { name: '刷新图谱' })).toBeVisible()
    await expect(page.getByText('知识图谱渲染失败')).toHaveCount(0)
    if (nodeCount > 0) {
      await expect(page.locator('.knowledge-graph-canvas canvas, .knowledge-graph-canvas svg').first()).toBeVisible()
    } else {
      await expect(page.getByText('知识图谱暂时为空')).toBeVisible()
    }
  })
})
