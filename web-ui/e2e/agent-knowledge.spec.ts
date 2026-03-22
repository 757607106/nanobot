import { expect, test } from '@playwright/test'
import { bootstrapAndSetup, uniqueE2EName } from './helpers'

async function waitForKnowledgeJob(page: import('@playwright/test').Page, kbId: string, jobId: string) {
  const deadline = Date.now() + 10000
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

test.describe.serial('agent knowledge binding e2e', () => {
  test.setTimeout(120_000)

  test('agent test run answers from bound knowledge base', async ({ page }) => {
    await bootstrapAndSetup(page)
    const kbName = uniqueE2EName('Ops E2E KB')
    const agentName = uniqueE2EName('Ops E2E Agent')

    const kbCreated = await page.request.post('/api/v1/knowledge-bases', {
      data: {
        name: kbName,
        description: 'Knowledge used by the agent test run.',
        kbType: 'milvus',
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

    const agentCreated = await page.request.post('/api/v1/agents', {
      data: {
        name: agentName,
        description: 'Answers with bound knowledge.',
        systemPrompt: 'You are an operations agent. Use the bound knowledge when relevant.',
        rules: ['Use the bound knowledge when relevant.', 'Answer clearly and briefly.'],
        model: 'deepseek/deepseek-chat',
        knowledgeBindingIds: [kbId],
      },
    })
    expect(agentCreated.ok()).toBeTruthy()
    const agentPayload = await agentCreated.json()
    const agentId = agentPayload.data.agentId as string

    await page.goto(`/studio/agents/${encodeURIComponent(agentId)}`)
    await expect(page).toHaveURL(new RegExp(`/studio/agents/${agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await expect(page.getByText('知识库 (1)')).toBeVisible()

    const runCard = page.locator('.studio-agent-run-card')
    await expect(runCard).toBeVisible()
    await runCard.locator('textarea').fill('请告诉我如何重启 nanobot。')
    await runCard.getByRole('button', { name: '开始试运行' }).click()

    await expect(page.getByText(/测试运行已完成，并命中 1 条知识证据/)).toBeVisible()
    await expect(runCard).toContainText('根据绑定知识库，应先检查 service health，再执行 supervisorctl restart nanobot。')
    await expect(runCard).not.toContainText('NO_KNOWLEDGE')
  })
})
