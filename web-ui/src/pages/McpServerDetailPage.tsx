import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, Empty, Input, InputNumber, Select, Space, Spin, Switch, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import { testIds } from '../testIds'
import type { McpProbeResult, McpServerEntry } from '../types'

const { Text } = Typography
const transportLabels: Record<DetailDraft['type'], string> = {
  stdio: 'stdio',
  sse: 'SSE',
  streamableHttp: 'HTTP',
}

interface DetailDraft {
  displayName: string
  enabled: boolean
  type: 'stdio' | 'sse' | 'streamableHttp'
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  toolTimeout: number
}

function toDraft(entry: McpServerEntry): DetailDraft {
  return {
    displayName: entry.displayName || entry.name,
    enabled: entry.enabled,
    type: entry.transport === 'unknown' ? 'stdio' : entry.transport,
    command: entry.command || '',
    argsText: (entry.args || []).join('\n'),
    envText: JSON.stringify(entry.env || {}, null, 2),
    url: entry.url || '',
    headersText: JSON.stringify(entry.headers || {}, null, 2),
    toolTimeout: Number(entry.toolTimeout || 30),
  }
}

function parseJsonMapping(raw: string, label: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {}
  }
  const payload = JSON.parse(trimmed) as Record<string, unknown>
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error(`${label} 必须是 JSON 对象`)
  }
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value ?? '')]))
}

export default function McpServerDetailPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { serverName } = useParams()
  const [entry, setEntry] = useState<McpServerEntry | null>(null)
  const [draft, setDraft] = useState<DetailDraft | null>(null)
  const [probe, setProbe] = useState<McpProbeResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!serverName) {
      setLoading(false)
      setError('缺少 MCP 名称')
      return
    }
    void loadServer(serverName)
  }, [serverName])

  async function loadServer(target: string) {
    try {
      setLoading(true)
      setError(null)
      const next = await api.getMcpServer(target)
      setEntry(next)
      setDraft(toDraft(next))
      setProbe(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载 MCP 详情失败')
    } finally {
      setLoading(false)
    }
  }

  async function runProbe(target: string, options?: { notify?: boolean }) {
    const next = await api.probeMcpServer(target)
    setProbe(next)
    if (next.entry) {
      setEntry(next.entry)
      setDraft(toDraft(next.entry))
    }
    if (options?.notify !== false) {
      message.success(next.ok ? 'MCP 探测通过' : next.statusLabel)
    }
    return next
  }

  async function handleProbe() {
    if (!serverName) {
      return
    }
    try {
      setProbing(true)
      await runProbe(serverName)
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : 'MCP 探测失败')
    } finally {
      setProbing(false)
    }
  }

  async function handleToggle(enabled: boolean) {
    if (!serverName) {
      return
    }
    try {
      setToggling(true)
      const next = await api.setMcpServerEnabled(serverName, enabled)
      if (next.entry) {
        setEntry(next.entry)
        setDraft((current) => (current ? { ...current, enabled } : toDraft(next.entry!)))
      }
      message.success(enabled ? 'MCP 已启用' : 'MCP 已停用')
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '切换 MCP 启用状态失败')
    } finally {
      setToggling(false)
    }
  }

  async function handleSave(probeAfterSave = false) {
    if (!serverName || !draft) {
      return
    }
    try {
      setSaving(true)
      const next = await api.updateMcpServer(serverName, {
        displayName: draft.displayName.trim() || null,
        enabled: draft.enabled,
        type: draft.type,
        command: draft.command.trim() || null,
        args: draft.argsText
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        env: parseJsonMapping(draft.envText, '环境变量'),
        url: draft.url.trim() || null,
        headers: parseJsonMapping(draft.headersText, '请求头'),
        toolTimeout: Number(draft.toolTimeout || 30),
      })
      if (next.entry) {
        setEntry(next.entry)
        setDraft(toDraft(next.entry))
      }
      if (!probeAfterSave) {
        message.success('MCP 配置已保存')
        return
      }
      try {
        setProbing(true)
        const nextProbe = await runProbe(serverName, { notify: false })
        message.success(nextProbe.ok ? '配置已保存并完成探测' : `配置已保存，${nextProbe.statusLabel}`)
      } catch (probeError) {
        message.warning(probeError instanceof Error ? `配置已保存，但探测失败：${probeError.message}` : '配置已保存，但探测失败')
      } finally {
        setProbing(false)
      }
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '保存 MCP 配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!serverName || !entry || !draft) {
    return (
      <div className="page-stack">
        <Card className="config-panel-card">
          {error ? <Alert type="error" message="无法加载 MCP 详情" description={error} /> : <Empty description="MCP 不存在" />}
        </Card>
      </div>
    )
  }

  const toolNames = entry.toolNames || []
  const showProbeAlert = probe || entry.lastError
  const probeAlertType = probe
    ? (probe.ok ? 'success' : probe.status === 'blocked' ? 'warning' : 'error')
    : 'warning'
  const probeAlertMessage = probe
    ? (probe.ok ? `${probe.statusLabel} · ${probe.toolCount} 个工具` : probe.error || probe.statusLabel)
    : entry.lastError || null

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        title={`配置 ${entry.displayName}`}
        actions={(
          <div className="mcp-hero-actions">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/mcp')}>
              返回列表
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadServer(serverName)}>
              刷新
            </Button>
          </div>
        )}
      />

      {showProbeAlert && probeAlertMessage ? (
        <Alert
          className="mcp-inline-alert"
          type={probeAlertType}
          message={probeAlertMessage}
        />
      ) : null}

      <div className="page-grid system-dashboard-grid mcp-detail-page-grid">
        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>连接配置</Typography.Title>
            </div>
            <Space wrap>
              <Tag>{transportLabels[draft.type]}</Tag>
              <Tag color={draft.enabled ? 'success' : 'default'}>{draft.enabled ? '已启用' : '已停用'}</Tag>
            </Space>
          </div>

          <div className="page-meta-grid system-side-grid">
            <div className="page-meta-card">
              <span>服务 ID</span>
              <strong>{entry.name}</strong>
            </div>
            <div className="page-meta-card">
              <span>最近探测</span>
              <strong>{entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '--'}</strong>
            </div>
            <div className="page-meta-card">
              <span>工具缓存</span>
              <strong>{entry.toolCountKnown ? entry.toolCount : '待探测'}</strong>
            </div>
          </div>

          <div className="detail-grid mcp-detail-form-grid">
            <div className="config-field-block">
              <div className="config-field-label-row">
                <Text>展示名称</Text>
              </div>
              <Input
                value={draft.displayName}
                onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                data-testid={testIds.mcp.detailDisplayName}
              />
            </div>

            <div className="channel-flag-card">
              <div>
                <Text strong>聊天中启用</Text>
              </div>
              <Switch checked={draft.enabled} onChange={(checked) => setDraft({ ...draft, enabled: checked })} />
            </div>

            <div className="config-field-block">
              <div className="config-field-label-row">
                <Text>传输方式</Text>
              </div>
              <Select
                value={draft.type}
                options={[
                  { label: 'stdio', value: 'stdio' },
                  { label: 'SSE', value: 'sse' },
                  { label: 'Streamable HTTP', value: 'streamableHttp' },
                ]}
                onChange={(value) => setDraft({ ...draft, type: value as DetailDraft['type'] })}
              />
            </div>

            <div className="config-field-block">
              <div className="config-field-label-row">
                <Text>工具超时（秒）</Text>
              </div>
              <InputNumber
                min={1}
                value={draft.toolTimeout}
                style={{ width: '100%' }}
                onChange={(value) => setDraft({ ...draft, toolTimeout: Number(value || 30) })}
              />
            </div>

            {draft.type === 'stdio' ? (
              <>
                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>命令</Text>
                  </div>
                  <Input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} />
                </div>

                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>参数（每行一个）</Text>
                  </div>
                  <Input.TextArea
                    className="config-json-editor"
                    value={draft.argsText}
                    spellCheck={false}
                    onChange={(event) => setDraft({ ...draft, argsText: event.target.value })}
                    style={{ height: 180, resize: 'none' }}
                  />
                </div>

                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>环境变量 JSON</Text>
                  </div>
                  <Input.TextArea
                    className="config-json-editor"
                    value={draft.envText}
                    spellCheck={false}
                    onChange={(event) => setDraft({ ...draft, envText: event.target.value })}
                    style={{ height: 220, resize: 'none' }}
                    data-testid={testIds.mcp.detailEnv}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>URL</Text>
                  </div>
                  <Input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
                </div>

                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>请求头 JSON</Text>
                  </div>
                  <Input.TextArea
                    className="config-json-editor"
                    value={draft.headersText}
                    spellCheck={false}
                    onChange={(event) => setDraft({ ...draft, headersText: event.target.value })}
                    style={{ height: 220, resize: 'none' }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="mcp-detail-action-row">
            <Button onClick={() => void handleToggle(!entry.enabled)} loading={toggling} data-testid={testIds.mcp.detailToggle}>
              {entry.enabled ? '立即停用' : '立即启用'}
            </Button>
            <Button
              icon={<SaveOutlined />}
              onClick={() => void handleSave()}
              loading={saving}
              data-testid={testIds.mcp.detailSave}
            >
              保存配置
            </Button>
            <Button onClick={() => void handleProbe()} loading={probing} data-testid={testIds.mcp.detailProbe}>
              立即探测
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void handleSave(true)}
              loading={saving || probing}
            >
              保存并探测
            </Button>
          </div>
        </Card>

        <div className="page-stack">
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>当前可用工具</Typography.Title>
              </div>
              <Tag>{entry.toolCountKnown ? `${entry.toolCount} 个` : '待探测'}</Tag>
            </div>

            <div className="page-meta-grid system-side-grid">
              <div className="page-meta-card">
                <span>最后状态</span>
                <strong>{entry.lastProbeStatus || '--'}</strong>
              </div>
              <div className="page-meta-card">
                <span>最近探测</span>
                <strong>{entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '--'}</strong>
              </div>
              <div className="page-meta-card">
                <span>工具缓存</span>
                <strong>{entry.toolCountKnown ? entry.toolCount : '待探测'}</strong>
              </div>
              <div className="page-meta-card">
                <span>最近同步</span>
                <strong>{entry.lastToolSyncAt ? formatDateTimeZh(entry.lastToolSyncAt) : '--'}</strong>
              </div>
            </div>
            {probe && !probe.ok && probe.missingEnv.length > 0 ? (
              <div className="tag-cloud">
                {probe.missingEnv.map((item) => <Tag key={item}>{item}</Tag>)}
              </div>
            ) : null}

            {toolNames.length > 0 ? (
              <div className="tag-cloud mcp-tool-cloud">
                {toolNames.map((toolName) => <Tag key={toolName}>{toolName}</Tag>)}
              </div>
            ) : (
              <Empty description="还没有可用工具，保存配置后点一次“立即探测”即可。" className="empty-block" />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
