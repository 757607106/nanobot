import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Descriptions, Empty, Flex, Input, InputNumber, Select, Space, Spin, Switch, Tag, Typography, theme } from 'antd'
import { ArrowLeftOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { formatDateTimeZh } from '../../locale'
import { testIds } from '../../testIds'
import type { McpProbeResult, McpServerEntry } from '../../types'
import { transportLabels } from './utils'
import PageHeader from '../../components/console/PageHeader'
import SectionCard from '../../components/console/SectionCard'

const { Title, Text } = Typography

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

function parseJsonMapping(raw: string): Record<string, string> {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  const payload = JSON.parse(trimmed) as Record<string, unknown>
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('必须是 JSON 对象')
  }
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value ?? '')]))
}

export default function DetailPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { serverName } = useParams()
  const [entry, setEntry] = useState<McpServerEntry | null>(null)
  const [draft, setDraft] = useState<DetailDraft | null>(null)
  const draftRef = useRef<DetailDraft | null>(null)
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

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  function applyDraftPatch(patch: Partial<DetailDraft>) {
    draftRef.current = draftRef.current ? { ...draftRef.current, ...patch } : draftRef.current
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }

  async function loadServer(target: string) {
    try {
      setLoading(true)
      setError(null)
      const next = await api.getMcpServer(target)
      setEntry(next)
      setDraft(toDraft(next))
      setProbe(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function runProbe(target: string) {
    const next = await api.probeMcpServer(target)
    setProbe(next)
    if (next.entry) {
      setEntry(next.entry)
      setDraft(toDraft(next.entry))
    }
    message.success(next.ok ? '探测通过' : next.statusLabel)
    return next
  }

  async function handleProbe() {
    if (!serverName) return
    try {
      setProbing(true)
      await runProbe(serverName)
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '探测失败')
    } finally {
      setProbing(false)
    }
  }

  async function handleToggle(enabled: boolean) {
    if (!serverName) return
    try {
      setToggling(true)
      const next = await api.setMcpServerEnabled(serverName, enabled)
      if (next.entry) {
        setEntry(next.entry)
        setDraft((current) => (current ? { ...current, enabled } : toDraft(next.entry!)))
      }
      message.success(enabled ? '已启用' : '已停用')
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '操作失败')
    } finally {
      setToggling(false)
    }
  }

  async function handleSave(probeAfterSave = false) {
    const activeDraft = draftRef.current
    if (!serverName || !activeDraft) return
    try {
      setSaving(true)
      const next = await api.updateMcpServer(serverName, {
        displayName: activeDraft.displayName.trim() || null,
        enabled: activeDraft.enabled,
        type: activeDraft.type,
        command: activeDraft.command.trim() || null,
        args: activeDraft.argsText.split('\n').map((item) => item.trim()).filter(Boolean),
        env: parseJsonMapping(activeDraft.envText),
        url: activeDraft.url.trim() || null,
        headers: parseJsonMapping(activeDraft.headersText),
        toolTimeout: Number(activeDraft.toolTimeout || 30),
      })
      if (next.entry) {
        setEntry(next.entry)
        setDraft(toDraft(next.entry))
      }
      if (!probeAfterSave) {
        message.success('配置已保存')
        return
      }
      try {
        setProbing(true)
        const nextProbe = await runProbe(serverName)
        message.success(nextProbe.ok ? '配置已保存并完成探测' : `配置已保存，${nextProbe.statusLabel}`)
      } catch (probeError) {
        message.warning(probeError instanceof Error ? `配置已保存，但探测失败：${probeError.message}` : '配置已保存，但探测失败')
      } finally {
        setProbing(false)
      }
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin size="large" />
      </div>
    )
  }

  if (!serverName || !entry || !draft) {
    return (
      <div className="page-card">
        {error ? (
          <Alert type="error" message="加载失败" description={error} />
        ) : (
          <Empty description="MCP 不存在" />
        )}
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
  const actionBusy = saving || probing || toggling

  return (
    <div className="page-stack max-w-[1600px] mx-auto" style={{ padding: 'var(--nb-panel-padding)' }}>
      <PageHeader
        title={entry.displayName || entry.name}
        subtitle={`${transportLabels[draft.type]} · ${draft.enabled ? '已启用' : '已停用'}`}
        actions={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/mcp')}>
              返回
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadServer(serverName)}>
              刷新
            </Button>
          </Space>
        }
      />

      {showProbeAlert && probeAlertMessage && (
        <Alert type={probeAlertType} message={probeAlertMessage} showIcon />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(260px, 320px)', gap: 24, alignItems: 'start' }}>
        <SectionCard
          title="连接配置"
          action={
            <Flex gap={6}>
              <Tag>{transportLabels[draft.type]}</Tag>
              <Tag color={draft.enabled ? 'success' : 'default'}>
                {draft.enabled ? '已启用' : '已停用'}
              </Tag>
            </Flex>
          }
        >

          <Descriptions column={2} size="small" style={{ marginBottom: 24 }}>
            <Descriptions.Item label="服务 ID">
              <Text code>{entry.name}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="最近探测">
              {entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '--'}
            </Descriptions.Item>
            <Descriptions.Item label="工具缓存">
              {entry.toolCountKnown ? entry.toolCount : '待探测'}
            </Descriptions.Item>
            <Descriptions.Item label="最后状态">
              {entry.lastProbeStatus || '--'}
            </Descriptions.Item>
          </Descriptions>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {/* 展示名称 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 14, fontWeight: 500 }}>展示名称</label>
              <Input
                value={draft.displayName}
                onChange={(e) => applyDraftPatch({ displayName: e.target.value })}
                data-testid={testIds.mcp.detailDisplayName}
              />
            </div>

            {/* 启用开关 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 8, background: 'var(--nb-card-subtle-bg)' }}>
              <Text strong>聊天中启用</Text>
              <Switch
                checked={draft.enabled}
                onChange={(checked) => applyDraftPatch({ enabled: checked })}
              />
            </div>

            {/* 传输方式 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 14, fontWeight: 500 }}>传输方式</label>
              <Select
                value={draft.type}
                onChange={(value) => applyDraftPatch({ type: value })}
                options={[
                  { label: 'stdio', value: 'stdio' },
                  { label: 'SSE', value: 'sse' },
                  { label: 'HTTP', value: 'streamableHttp' },
                ]}
              />
            </div>

            {/* 超时时间 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 14, fontWeight: 500 }}>超时时间（秒）</label>
              <InputNumber
                min={1}
                style={{ width: '100%' }}
                value={draft.toolTimeout}
                onChange={(value) => applyDraftPatch({ toolTimeout: Number(value || 30) })}
              />
            </div>

            {draft.type === 'stdio' ? (
              <>
                {/* 命令 */}
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label style={{ fontSize: 14, fontWeight: 500 }}>命令</label>
                  <Input
                    value={draft.command}
                    onChange={(e) => applyDraftPatch({ command: e.target.value })}
                  />
                </div>

                {/* 参数 */}
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label style={{ fontSize: 14, fontWeight: 500 }}>参数（每行一个）</label>
                  <Input.TextArea
                    rows={4}
                    value={draft.argsText}
                    onChange={(e) => applyDraftPatch({ argsText: e.target.value })}
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>

                {/* 环境变量 */}
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label style={{ fontSize: 14, fontWeight: 500 }}>环境变量 JSON</label>
                  <Input.TextArea
                    rows={6}
                    value={draft.envText}
                    onChange={(e) => applyDraftPatch({ envText: e.target.value })}
                    style={{ fontFamily: 'monospace' }}
                    data-testid={testIds.mcp.detailEnv}
                  />
                </div>
              </>
            ) : (
              <>
                {/* URL */}
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label style={{ fontSize: 14, fontWeight: 500 }}>URL</label>
                  <Input
                    value={draft.url}
                    onChange={(e) => applyDraftPatch({ url: e.target.value })}
                  />
                </div>

                {/* 请求头 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 14, fontWeight: 500 }}>请求头 JSON</label>
                  <Input.TextArea
                    rows={6}
                    value={draft.headersText}
                    onChange={(e) => applyDraftPatch({ headersText: e.target.value })}
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>
              </>
            )}
          </div>

          <Flex gap={8} style={{ flexWrap: 'wrap', marginTop: 24, paddingTop: 16, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
            <Button onClick={() => void handleToggle(!entry.enabled)} loading={toggling} disabled={actionBusy}>
              {entry.enabled ? '立即停用' : '立即启用'}
            </Button>
            <Button icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving} disabled={actionBusy}>
              保存配置
            </Button>
            <Button onClick={() => void handleProbe()} loading={probing} disabled={actionBusy}>
              立即探测
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave(true)} loading={saving || probing} disabled={actionBusy}>
              保存并探测
            </Button>
          </Flex>
        </SectionCard>

        <SectionCard
          title="可用工具"
          action={<Tag>{entry.toolCountKnown ? `${entry.toolCount} 个` : '待探测'}</Tag>}
        >

          {probe && !probe.ok && probe.missingEnv.length > 0 && (
            <Alert
              type="warning"
              message="缺失环境变量"
              description={
                <div className="flex flex-wrap gap-1" style={{ marginTop: 8 }}>
                  {probe.missingEnv.map((item) => <Tag key={item}>{item}</Tag>)}
                </div>
              }
              style={{ marginBottom: 16 }}
            />
          )}

          {toolNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {toolNames.map((toolName) => (
                <Tag key={toolName} style={{ fontFamily: 'monospace' }}>
                  {toolName}
                </Tag>
              ))}
            </div>
          ) : (
            <Empty
              description="暂无工具，请保存配置后探测"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </SectionCard>
      </div>
    </div>
  )
}
