import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const baseURL = process.env.NANOBOT_UI_BASE_URL || 'http://127.0.0.1:6790'
const outDir = process.env.NANOBOT_UI_REVIEW_DIR || '/tmp/nanobot-ui-review'
const username = process.env.NANOBOT_UI_USERNAME || 'admin'
const password = process.env.NANOBOT_UI_PASSWORD || 'admin123'

await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1200 },
  colorScheme: 'light',
  deviceScaleFactor: 1,
})
const page = await context.newPage()

async function waitStable() {
  await page.waitForLoadState('domcontentloaded')
  try {
    await page.waitForLoadState('networkidle', { timeout: 4000 })
  } catch {}
  for (let index = 0; index < 8; index += 1) {
    const spinning = await page.locator('.ant-spin-spinning').count().catch(() => 0)
    if (!spinning) {
      break
    }
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(700)
}

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

async function api(pathname) {
  const response = await context.request.get(pathname)
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { ok: response.ok(), status: response.status(), text, json }
}

async function capture(name, route) {
  const record = { name, route, errors: [], failed: [] }
  const onPageError = (error) => record.errors.push(`pageerror: ${error.message}`)
  const onConsole = (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      record.errors.push(`console.${msg.type()}: ${msg.text()}`)
    }
  }
  const onRequestFailed = (request) => {
    record.failed.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'failed'}`)
  }
  page.on('pageerror', onPageError)
  page.on('console', onConsole)
  page.on('requestfailed', onRequestFailed)
  try {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await waitStable()
    record.finalUrl = new URL(page.url()).pathname
    record.title = await page.title()
    record.heading = (
      (await page.locator('main h1, [role="main"] h1, h1').first().textContent().catch(() => '')) || ''
    ).trim()
    const bodyText = ((await page.locator('body').textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
    record.textSnippet = bodyText.slice(0, 400)
    const filePath = path.join(outDir, `${safeName(name)}.png`)
    await page.screenshot({ path: filePath, fullPage: true })
    record.screenshot = filePath
  } catch (error) {
    record.captureError = String(error)
    const filePath = path.join(outDir, `${safeName(name)}-error.png`)
    await page.screenshot({ path: filePath, fullPage: true }).catch(() => {})
    record.screenshot = filePath
  } finally {
    page.off('pageerror', onPageError)
    page.off('console', onConsole)
    page.off('requestfailed', onRequestFailed)
  }
  return record
}

const summary = []

await page.goto('/login', { waitUntil: 'domcontentloaded' })
await waitStable()
const loginScreenshot = path.join(outDir, 'login-page.png')
await page.screenshot({ path: loginScreenshot, fullPage: true })
summary.push({
  name: 'login',
  route: '/login',
  finalUrl: new URL(page.url()).pathname,
  screenshot: loginScreenshot,
})

await page.getByTestId('auth-username').fill(username)
await page.getByTestId('auth-password').fill(password)
await Promise.all([
  page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 10000 }),
  page.getByTestId('auth-submit').click(),
])
await waitStable()

const agents = await api('/api/v1/agents')
const knowledge = await api('/api/v1/knowledge-bases')
const mcp = await api('/api/v1/mcp/servers')
const bindings = await api('/api/v1/channel-bindings')
const audit = await api('/api/v1/channel-audit')
const channels = await api('/api/v1/channels')
const runs = await api('/api/v1/runs')

const firstAgentId = agents.json?.data?.[0]?.agentId || null
const firstKbId = knowledge.json?.data?.[0]?.kbId || null
const firstServerName = mcp.json?.data?.items?.[0]?.name || null
const firstBindingId = bindings.json?.data?.[0]?.bindingId || null
const firstAuditId = audit.json?.data?.items?.[0]?.auditId || null
const channelNames = (channels.json?.data?.items || []).map((item) => item.name)
const firstRunId =
  (Array.isArray(runs.json?.data) ? runs.json.data[0]?.runId : null) ||
  runs.json?.data?.items?.[0]?.runId ||
  null

const routes = [
  ['dashboard', '/dashboard'],
  ['chat', '/chat'],
  ['channels-list', '/channels/list'],
  ...channelNames.map((name) => [`channel-${name}`, `/channels/${name}`]),
  ['channel-bindings', '/channels/bindings'],
  ...(firstBindingId ? [[`channel-binding-${firstBindingId}`, `/channels/bindings/${firstBindingId}`]] : []),
  ['channel-audit', '/channels/audit'],
  ['models', '/models'],
  ['knowledge-list', '/knowledge'],
  ...(firstKbId ? [[`knowledge-${firstKbId}`, `/knowledge/${firstKbId}`]] : []),
  ['studio-agents', '/studio/agents'],
  ...(firstAgentId ? [[`studio-agent-${firstAgentId}`, `/studio/agents/${firstAgentId}`]] : []),
  ...(firstAgentId ? [[`studio-agent-chat-${firstAgentId}`, `/studio/agents/${firstAgentId}/chat`]] : []),
  ['studio-memory', '/studio/memory'],
  ...(firstAgentId ? [[`studio-memory-agent-${firstAgentId}`, `/studio/memory/agents/${firstAgentId}`]] : []),
  ['studio-runs', '/studio/runs'],
  ...(firstRunId ? [[`studio-run-${firstRunId}`, `/studio/runs/${firstRunId}`]] : []),
  ['mcp', '/mcp'],
  ...(firstServerName ? [[`mcp-${firstServerName}`, `/mcp/${encodeURIComponent(firstServerName)}`]] : []),
  ['skills', '/skills'],
  ['system', '/system'],
  ['system-preferences', '/system/preferences'],
  ['system-validation', '/system/validation'],
  ['system-automation', '/system/automation'],
  ['system-operations', '/system/operations'],
  ['system-admin', '/system/admin'],
]

for (const [name, route] of routes) {
  const record = await capture(name, route)
  summary.push(record)
}

const payload = {
  baseURL,
  generatedAt: new Date().toISOString(),
  api: {
    agents: { ok: agents.ok, status: agents.status },
    knowledge: { ok: knowledge.ok, status: knowledge.status },
    mcp: { ok: mcp.ok, status: mcp.status },
    bindings: { ok: bindings.ok, status: bindings.status },
    audit: { ok: audit.ok, status: audit.status, firstAuditId },
    channels: { ok: channels.ok, status: channels.status, count: channelNames.length },
    runs: { ok: runs.ok, status: runs.status, textSnippet: runs.text.slice(0, 200) },
  },
  ids: { firstAgentId, firstKbId, firstServerName, firstBindingId, firstRunId },
  pages: summary,
}

await fs.writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(payload, null, 2)}\n`)
console.log(JSON.stringify({ outDir, pageCount: summary.length, channelCount: channelNames.length, ids: payload.ids, runsStatus: runs.status }, null, 2))

await browser.close()
