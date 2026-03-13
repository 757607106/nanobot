import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, Empty, Input, InputNumber, List, Select, Space, Spin, Switch, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import { testIds } from '../testIds'
import type { McpProbeResult, McpRepairPlan, McpServerEntry, McpTestChatData } from '../types'

const { Text } = Typography

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
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const { serverName } = useParams()
  const [entry, setEntry] = useState<McpServerEntry | null>(null)
  const [draft, setDraft] = useState<DetailDraft | null>(null)
  const [probe, setProbe] = useState<McpProbeResult | null>(null)
  const [repairPlan, setRepairPlan] = useState<McpRepairPlan | null>(null)
  const [testChat, setTestChat] = useState<McpTestChatData | null>(null)
  const [testInput, setTestInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [repairingMode, setRepairingMode] = useState<'bounded' | 'dangerous' | null>(null)
  const [sendingTestChat, setSendingTestChat] = useState(false)
  const [clearingTestChat, setClearingTestChat] = useState(false)
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
      const [next, repair, isolatedTestChat] = await Promise.all([
        api.getMcpServer(target),
        api.getMcpRepairPlan(target),
        api.getMcpTestChat(target),
      ])
      setEntry(next)
      setDraft(toDraft(next))
      setRepairPlan(repair)
      setTestChat(isolatedTestChat)
      setProbe(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载 MCP 详情失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleProbe() {
    if (!serverName) {
      return
    }
    try {
      setProbing(true)
      const next = await api.probeMcpServer(serverName)
      setProbe(next)
      if (next.entry) {
        setEntry(next.entry)
        setDraft((current) => (current ? { ...current } : toDraft(next.entry!)))
      }
      const nextPlan = await api.getMcpRepairPlan(serverName)
      setRepairPlan(nextPlan)
      message.success(next.ok ? 'MCP 探测通过' : next.statusLabel)
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
      const nextPlan = await api.getMcpRepairPlan(serverName)
      setRepairPlan(nextPlan)
      message.success(enabled ? 'MCP 已启用' : 'MCP 已停用')
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '切换 MCP 启用状态失败')
    } finally {
      setToggling(false)
    }
  }

  async function handleSave() {
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
      const nextPlan = await api.getMcpRepairPlan(serverName)
      setRepairPlan(nextPlan)
      message.success('MCP 详情已保存')
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '保存 MCP 详情失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleRepair(dangerousMode: boolean) {
    if (!serverName) {
      return
    }
    try {
      setRepairingMode(dangerousMode ? 'dangerous' : 'bounded')
      const next = await api.runMcpRepair(serverName, dangerousMode)
      setRepairPlan(next)
      if (next.entry) {
        const updatedEntry = next.entry
        setEntry(updatedEntry)
        setDraft((current) => (current ? { ...current } : toDraft(updatedEntry)))
      }
      message.success(dangerousMode ? '危险修复任务已触发' : '受限修复任务已触发')
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '触发 MCP 修复失败')
    } finally {
      setRepairingMode(null)
    }
  }

  async function handleSendTestChat() {
    if (!serverName || !testInput.trim()) {
      return
    }
    try {
      setSendingTestChat(true)
      const next = await api.sendMcpTestChatMessage(serverName, testInput.trim())
      setTestChat({
        session: next.session,
        messages: next.messages,
        toolNames: next.toolNames,
        recentToolActivity: next.recentToolActivity,
      })
      setTestInput('')
      const nextPlan = await api.getMcpRepairPlan(serverName)
      setRepairPlan(nextPlan)
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '发送测试消息失败')
    } finally {
      setSendingTestChat(false)
    }
  }

  async function handleClearTestChat() {
    if (!serverName) {
      return
    }
    try {
      setClearingTestChat(true)
      await api.clearMcpTestChat(serverName)
      const isolatedTestChat = await api.getMcpTestChat(serverName)
      setTestChat(isolatedTestChat)
      message.success('隔离测试聊天已清空')
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '清空测试聊天失败')
    } finally {
      setClearingTestChat(false)
    }
  }

  function handleRemove() {
    if (!serverName) {
      return
    }
    modal.confirm({
      title: `移除 MCP ${serverName}`,
      content: '会同时从当前配置中移除该 MCP；如果它是受管安装，也会尝试删除本地 checkout。',
      okText: '确认移除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const next = await api.deleteMcpServer(serverName)
        message.success(
          next.checkoutRemoved ? 'MCP 已移除，受管安装目录也已删除' : 'MCP 已从配置中移除',
        )
        navigate('/mcp', { replace: true })
      },
    })
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

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="MCP Detail"
        title={`维护 ${entry.displayName}`}
        description="在不回退到原始 JSON 的前提下，直接测试、启停、调整连接参数，并查看最近一次工具探测结果。"
        actions={(
          <div className="mcp-hero-actions">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/mcp')}>
              返回列表
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadServer(serverName)}>
              刷新
            </Button>
            <Button onClick={() => void handleProbe()} loading={probing} data-testid={testIds.mcp.detailProbe}>
              探测
            </Button>
            <Button onClick={() => void handleToggle(!entry.enabled)} loading={toggling} data-testid={testIds.mcp.detailToggle}>
              {entry.enabled ? '停用 MCP' : '启用 MCP'}
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void handleSave()}
              loading={saving}
              data-testid={testIds.mcp.detailSave}
            >
              保存
            </Button>
          </div>
        )}
        stats={[
          { label: '启用状态', value: entry.enabled ? '启用' : '停用' },
          { label: '工具缓存', value: entry.toolCountKnown ? entry.toolCount : '待探测' },
          { label: '最近探测', value: entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '--' },
          { label: '探测状态', value: entry.lastProbeStatus || '--' },
        ]}
      />

      {probe ? (
        <Alert
          className="mcp-inline-alert"
          type={probe.ok ? 'success' : probe.status === 'blocked' ? 'warning' : 'error'}
          message={probe.statusLabel}
          description={
            probe.ok
              ? `发现 ${probe.toolCount} 个工具：${probe.toolNames.join(', ') || '无'}`
              : probe.error || '最近一次探测没有返回更多信息。'
          }
        />
      ) : null}

      {entry.lastError ? (
        <Alert className="mcp-entry-alert" type="warning" message="最近一次探测错误" description={entry.lastError} />
      ) : null}

      <div className="page-grid system-dashboard-grid">
        <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>连接详情</Typography.Title>
              <Text type="secondary">编辑 transport、命令、URL、环境变量和请求头；保存后会立即写回配置。</Text>
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
                <Text type="secondary">关闭后不会参与 Agent 运行时加载。</Text>
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
              </>
            ) : (
              <div className="config-field-block">
                <div className="config-field-label-row">
                  <Text>URL</Text>
                </div>
                <Input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
              </div>
            )}

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
          </div>
        </Card>

        <div className="page-stack system-side-stack">
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>修复计划</Typography.Title>
                <Text type="secondary">把常见失败原因翻译成可执行的下一步，并把外部 repair worker 严格限制在显式命令下运行。</Text>
              </div>
              {repairPlan ? <Tag>{repairPlan.diagnosisLabel}</Tag> : null}
            </div>

            {repairPlan ? (
              <div className="page-stack">
                <Alert
                  type={repairPlan.status === 'ready' ? 'success' : repairPlan.status === 'blocked' ? 'warning' : 'error'}
                  message={repairPlan.summary}
                  description={repairPlan.detail}
                />

                {repairPlan.missingEnv.length > 0 ? (
                  <div className="tag-cloud">
                    {repairPlan.missingEnv.map((item) => <Tag key={item}>{item}</Tag>)}
                  </div>
                ) : null}

                <div className="page-scroll-shell mcp-repair-shell">
                  <List
                    dataSource={repairPlan.steps}
                    renderItem={(item) => (
                      <List.Item>
                        <div className="page-stack">
                          <Space wrap>
                            <Text strong>{item.title}</Text>
                            <Tag>{item.safe ? '受限步骤' : '危险步骤'}</Tag>
                          </Space>
                          <Text type="secondary">{item.description}</Text>
                        </div>
                      </List.Item>
                    )}
                  />
                </div>

                <div className="page-meta-grid system-side-grid">
                  <div className="page-meta-card">
                    <span>修复 worker</span>
                    <strong>{repairPlan.worker.configured ? '已配置' : '未配置'}</strong>
                  </div>
                  <div className="page-meta-card">
                    <span>危险模式</span>
                    <strong>{repairPlan.worker.dangerousAvailable ? '可显式启用' : '默认关闭'}</strong>
                  </div>
                  <div className="page-meta-card">
                    <span>最近修复状态</span>
                    <strong>{repairPlan.run.status}</strong>
                  </div>
                  <div className="page-meta-card">
                    <span>最近请求</span>
                    <strong>{formatDateTimeZh(repairPlan.run.lastRequestedAt)}</strong>
                  </div>
                </div>

                {repairPlan.run.commandPreview ? (
                  <div className="mono-block mono-block-large">{repairPlan.run.commandPreview}</div>
                ) : (
                  <Text type="secondary">尚未声明 `NANOBOT_WEB_MCP_REPAIR_COMMAND`，当前只能生成修复计划，不能直接触发外部 worker。</Text>
                )}

                <Space wrap>
                  <Button onClick={() => void handleRepair(false)} disabled={!repairPlan.worker.configured} loading={repairingMode === 'bounded'}>
                    运行受限修复
                  </Button>
                  <Button onClick={() => void handleRepair(true)} disabled={!repairPlan.worker.dangerousAvailable} loading={repairingMode === 'dangerous'}>
                    运行危险修复
                  </Button>
                  <Button onClick={() => void handleProbe()} loading={probing}>
                    修复后重新探测
                  </Button>
                </Space>
              </div>
            ) : (
              <Empty description="当前无法生成修复计划" className="empty-block" />
            )}
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>隔离测试聊天</Typography.Title>
                <Text type="secondary">这里会单独为当前 MCP 维护一条测试会话，只加载这个 MCP，不复用主聊天历史。</Text>
              </div>
              {testChat ? <Tag>{testChat.session.messageCount} 条</Tag> : null}
            </div>

            {testChat ? (
              <div className="page-stack">
                <div className="tag-cloud">
                  {(entry.toolNames && entry.toolNames.length > 0)
                    ? entry.toolNames.map((toolName) => <Tag key={toolName}>{toolName}</Tag>)
                    : <Tag>当前没有缓存工具列表</Tag>}
                </div>

                <div className="mono-block mono-block-large mcp-test-chat-shell">
                  {testChat.messages.length
                    ? testChat.messages.map((message) => `[${message.role}] ${message.content || '--'}`).join('\n\n')
                    : '当前还没有隔离测试聊天记录'}
                </div>

                {testChat.recentToolActivity.length > 0 ? (
                  <div className="page-scroll-shell mcp-activity-shell">
                    <List
                      dataSource={testChat.recentToolActivity}
                      renderItem={(item) => (
                        <List.Item>
                          <div className="page-stack">
                            <Space wrap>
                              <Text strong>{item.toolName}</Text>
                              <Tag>{item.source}</Tag>
                            </Space>
                            <Text type="secondary">{formatDateTimeZh(item.createdAt)}</Text>
                          </div>
                        </List.Item>
                      )}
                    />
                  </div>
                ) : null}

                <Input.TextArea
                  value={testInput}
                  onChange={(event) => setTestInput(event.target.value)}
                  placeholder="输入一条只针对当前 MCP 的测试消息，例如：请只调用这个 MCP 列出可用工具。"
                  style={{ minHeight: 120 }}
                  data-testid={testIds.mcp.detailTestInput}
                />

                <Space wrap>
                  <Button
                    type="primary"
                    onClick={() => void handleSendTestChat()}
                    loading={sendingTestChat}
                    data-testid={testIds.mcp.detailTestSend}
                  >
                    发送测试消息
                  </Button>
                  <Button onClick={() => void handleClearTestChat()} loading={clearingTestChat}>
                    清空测试聊天
                  </Button>
                </Space>
              </div>
            ) : (
              <Empty description="当前无法读取隔离测试聊天" className="empty-block" />
            )}
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>探测摘要</Typography.Title>
                <Text type="secondary">显示最近一次握手和工具发现结果。</Text>
              </div>
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
            <div className="mono-block mono-block-large">
              {(entry.toolNames && entry.toolNames.length > 0) ? entry.toolNames.join('\n') : '最近一次探测还没有缓存工具列表'}
            </div>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>安装元数据</Typography.Title>
                <Text type="secondary">保留仓库来源和受管安装信息，便于后续修复或卸载。</Text>
              </div>
            </div>
            <div className="detail-grid">
              <div className="detail-block">
                <Text type="secondary">来源仓库</Text>
                <div className="mono-block mono-block-large">{entry.repoUrl || '当前没有仓库来源'}</div>
              </div>
              <div className="detail-block">
                <Text type="secondary">安装目录</Text>
                <div className="mono-block mono-block-large">{entry.installDir || '非受管安装'}</div>
              </div>
              <div className="detail-block">
                <Text type="secondary">必填环境变量</Text>
                <div className="mono-block mono-block-large">
                  {(entry.requiredEnv && entry.requiredEnv.length > 0) ? entry.requiredEnv.join('\n') : '无'}
                </div>
              </div>
              <div className="detail-block">
                <Text type="secondary">安装步骤</Text>
                <div className="mono-block mono-block-large">
                  {(entry.installSteps && entry.installSteps.length > 0) ? entry.installSteps.join('\n') : '无'}
                </div>
              </div>
            </div>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>移除 MCP</Typography.Title>
                <Text type="secondary">从当前配置中移除该 MCP；如果它是受管安装，也会尝试清理 checkout。</Text>
              </div>
            </div>
            <Button danger icon={<DeleteOutlined />} onClick={handleRemove}>
              移除当前 MCP
            </Button>
          </Card>
        </div>
      </div>
    </div>
  )
}
