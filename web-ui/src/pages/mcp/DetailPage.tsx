import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Flex,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  theme,
} from 'antd'
import {
  EyeInvisibleOutlined,
  EyeOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { Drawer } from 'antd'
import { api } from '../../api'
import { formatDateTimeZh } from '../../locale'
import { testIds } from '../../testIds'
import type { McpProbeResult, McpServerEntry } from '../../types'
import { maskSensitiveMapping, transportLabels } from './utils'
import SectionCard from '../../components/console/SectionCard'
import { useToast } from '../../toast'

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

function parseJsonMapping(raw: string): Record<string, string> {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  const payload = JSON.parse(trimmed) as Record<string, unknown>
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('必须是 JSON 对象')
  }
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value ?? '')]))
}

function maskMappingText(raw: string) {
  try {
    return JSON.stringify(maskSensitiveMapping(parseJsonMapping(raw)), null, 2)
  } catch {
    return raw
  }
}

export default function McpServerDetailDrawer({
  serverName,
  open = true,
  onClose = () => {},
}: {
  serverName?: string
  open?: boolean
  onClose?: () => void
}) {
  const message = useToast()
  const { token } = theme.useToken()
  const [entry, setEntry] = useState<McpServerEntry | null>(null)
  const [draft, setDraft] = useState<DetailDraft | null>(null)
  const draftRef = useRef<DetailDraft | null>(null)
  const [probe, setProbe] = useState<McpProbeResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSensitive, setShowSensitive] = useState(false)

  useEffect(() => {
    if (!serverName || !open) {
      setLoading(false)
      setError('缺少连接名称')
      return
    }
    void loadServer(serverName)
  }, [serverName, open])

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

  const visibleHeaders = useMemo(
    () => showSensitive ? (entry?.headers || {}) : maskSensitiveMapping(entry?.headers || {}),
    [entry?.headers, showSensitive],
  )
  const visibleEnv = useMemo(
    () => showSensitive ? (entry?.env || {}) : maskSensitiveMapping(entry?.env || {}),
    [entry?.env, showSensitive],
  )

  if (loading) {
    return (
      <Drawer open={open} onClose={onClose} width={720} destroyOnClose title="正在加载...">
        <Flex justify="center" align="center" style={{ minHeight: 200 }}>
          <Spin size="large" />
        </Flex>
      </Drawer>
    )
  }

  if (!serverName || !entry || !draft) {
    return (
      <Drawer open={open} onClose={onClose} width={720} destroyOnClose title="加载失败">
        <div style={{ padding: 24 }}>
          {error ? (
            <Alert type="error" message="加载失败" description={error} />
          ) : (
            <Empty description="连接不存在" />
          )}
        </div>
      </Drawer>
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
    <Drawer
      open={open}
      onClose={onClose}
      title={entry.displayName || entry.name}
      width={780}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadServer(serverName!)}>
            刷新
          </Button>
        </Space>
      }
      styles={{ body: { background: 'var(--nb-bg)', padding: 'var(--nb-spacing-lg)' } }}
      destroyOnClose
    >
      <Flex vertical gap={16}>
        {/* Probe alert */}
        {showProbeAlert && probeAlertMessage && (
          <Alert type={probeAlertType} message={probeAlertMessage} showIcon />
        )}

        {/* Status summary */}
        <Descriptions
          size="small"
          column={2}
          bordered
          style={{ background: token.colorBgContainer, borderRadius: 8 }}
        >
          <Descriptions.Item label="服务 ID">
            <Text code>{entry.name}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={entry.enabled ? 'success' : 'default'}>
              {entry.enabled ? '已启用' : '已停用'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="传输方式">
            <Text code>{transportLabels[entry.transport] || entry.transport}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="工具数">
            {entry.toolCountKnown ? `${entry.toolCount} 个` : '待探测'}
          </Descriptions.Item>
          <Descriptions.Item label="最近探测">
            {entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '尚未探测'}
          </Descriptions.Item>
          <Descriptions.Item label="探测状态">
            {entry.lastProbeStatus || '--'}
          </Descriptions.Item>
        </Descriptions>

        {/* Config form */}
        <SectionCard
          title="连接配置"
          action={
            <Button
              size="small"
              icon={showSensitive ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => setShowSensitive((current) => !current)}
            >
              {showSensitive ? '隐藏敏感值' : '查看敏感值'}
            </Button>
          }
        >
          <Flex vertical gap={16}>
            {/* Row 1: name + enable */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="mcp-detail-display-name" style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)', color: token.colorTextSecondary }}>展示名称</label>
                <Input
                  id="mcp-detail-display-name"
                  value={draft.displayName}
                  onChange={(e) => applyDraftPatch({ displayName: e.target.value })}
                  data-testid={testIds.mcp.detailDisplayName}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'var(--nb-card-subtle-bg)',
                  height: 40,
                }}
              >
                <Text style={{ fontSize: 'var(--nb-text-sm)', whiteSpace: 'nowrap' }}>聊天中启用</Text>
                <Switch
                  checked={draft.enabled}
                  onChange={(checked) => applyDraftPatch({ enabled: checked })}
                  size="small"
                  aria-label="聊天中启用"
                />
              </div>
            </div>

            {/* Row 2: transport + timeout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="mcp-detail-transport" style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)', color: token.colorTextSecondary }}>传输方式</label>
                <Select
                  id="mcp-detail-transport"
                  value={draft.type}
                  onChange={(value) => applyDraftPatch({ type: value })}
                  aria-label="传输方式"
                  options={[
                    { label: 'stdio（本地进程）', value: 'stdio' },
                    { label: 'SSE', value: 'sse' },
                    { label: 'HTTP（Streamable）', value: 'streamableHttp' },
                  ]}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="mcp-detail-timeout" style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)', color: token.colorTextSecondary }}>超时时间（秒）</label>
                <InputNumber
                  id="mcp-detail-timeout"
                  min={1}
                  style={{ width: '100%' }}
                  value={draft.toolTimeout}
                  onChange={(value) => applyDraftPatch({ toolTimeout: Number(value || 30) })}
                  aria-label="超时时间（秒）"
                />
              </div>
            </div>

            {/* Conditional: stdio vs http */}
            {draft.type === 'stdio' ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="mcp-detail-command" style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)', color: token.colorTextSecondary }}>命令</label>
                  <Input
                    id="mcp-detail-command"
                    value={draft.command}
                    onChange={(e) => applyDraftPatch({ command: e.target.value })}
                    placeholder="例：uvx mcp-server-name"
                    style={{ fontFamily: 'monospace' }}
                    aria-label="命令"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="mcp-detail-args" style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)', color: token.colorTextSecondary }}>参数（每行一个）</label>
                  <Input.TextArea
                    id="mcp-detail-args"
                    rows={3}
                    value={draft.argsText}
                    onChange={(e) => applyDraftPatch({ argsText: e.target.value })}
                    style={{ fontFamily: 'monospace' }}
                    aria-label="参数（每行一个）"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="mcp-detail-env" style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)', color: token.colorTextSecondary }}>环境变量（JSON）</label>
                  <Input.TextArea
                    id="mcp-detail-env"
                    rows={5}
                    value={showSensitive ? draft.envText : maskMappingText(draft.envText)}
                    onChange={(e) => applyDraftPatch({ envText: e.target.value })}
                    style={{ fontFamily: 'monospace', fontSize: 'var(--nb-text-xs)' }}
                    data-testid={testIds.mcp.detailEnv}
                    readOnly={!showSensitive}
                    placeholder='{"KEY": "VALUE"}'
                    aria-label="环境变量（JSON）"
                  />
                </div>
                {Object.keys(visibleEnv).length > 0 && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      background: 'var(--nb-card-subtle-bg)',
                      border: '1px solid var(--nb-card-subtle-border)',
                      fontFamily: 'var(--nb-font-mono)',
                      fontSize: 'var(--nb-text-2xs)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: token.colorTextSecondary,
                    }}
                  >
                    {JSON.stringify(visibleEnv, null, 2)}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="mcp-detail-url" style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)', color: token.colorTextSecondary }}>URL</label>
                  <Input
                    id="mcp-detail-url"
                    value={draft.url}
                    onChange={(e) => applyDraftPatch({ url: e.target.value })}
                    placeholder="https://example.com/mcp"
                    aria-label="URL"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="mcp-detail-headers" style={{ fontSize: 'var(--nb-text-sm)', fontWeight: 'var(--nb-font-weight-medium)', color: token.colorTextSecondary }}>请求头（JSON）</label>
                  <Input.TextArea
                    id="mcp-detail-headers"
                    rows={5}
                    value={showSensitive ? draft.headersText : maskMappingText(draft.headersText)}
                    onChange={(e) => applyDraftPatch({ headersText: e.target.value })}
                    style={{ fontFamily: 'monospace', fontSize: 'var(--nb-text-xs)' }}
                    readOnly={!showSensitive}
                    placeholder='{"Authorization": "Bearer ..."}'
                    aria-label="请求头（JSON）"
                  />
                </div>
                {Object.keys(visibleHeaders).length > 0 && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      background: 'var(--nb-card-subtle-bg)',
                      border: '1px solid var(--nb-card-subtle-border)',
                      fontFamily: 'var(--nb-font-mono)',
                      fontSize: 'var(--nb-text-2xs)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: token.colorTextSecondary,
                    }}
                  >
                    {JSON.stringify(visibleHeaders, null, 2)}
                  </div>
                )}
              </>
            )}

            {/* Sensitive info hint */}
            <Alert
              type="info"
              showIcon
              icon={<SafetyCertificateOutlined />}
              message="敏感值默认遮罩，点击【查看敏感值】后短暂显示，降低管理页泄漏风险。"
            />

            {/* Action buttons */}
            <Flex gap={8} wrap="wrap" style={{ paddingTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
              <Button
                onClick={() => void handleToggle(!entry.enabled)}
                loading={toggling}
                disabled={actionBusy}
              >
                {entry.enabled ? '立即停用' : '立即启用'}
              </Button>
              <Button
                icon={<SaveOutlined />}
                onClick={() => void handleSave()}
                loading={saving}
                disabled={actionBusy}
              >
                保存配置
              </Button>
              <Button
                onClick={() => void handleProbe()}
                loading={probing}
                disabled={actionBusy}
              >
                立即探测
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={() => void handleSave(true)}
                loading={saving || probing}
                disabled={actionBusy}
              >
                保存并探测
              </Button>
            </Flex>
          </Flex>
        </SectionCard>

        {/* Tool list */}
        <SectionCard
          title="可用工具"
          action={<Tag>{entry.toolCountKnown ? `${entry.toolCount} 个` : '待探测'}</Tag>}
        >
          {probe && !probe.ok && probe.missingEnv.length > 0 && (
            <Alert
              type="warning"
              message="缺失环境变量"
              description={
                <Flex wrap="wrap" gap={4} style={{ marginTop: 8 }}>
                  {probe.missingEnv.map((item) => <Tag key={item}>{item}</Tag>)}
                </Flex>
              }
              style={{ marginBottom: 16 }}
            />
          )}
          {toolNames.length > 0 ? (
            <Flex wrap="wrap" gap={6}>
              {toolNames.map((toolName) => (
                <Tag key={toolName} style={{ fontFamily: 'monospace' }}>
                  {toolName}
                </Tag>
              ))}
            </Flex>
          ) : (
            <Empty
              description="暂无工具，请保存配置后探测"
              image={false} className="minimal-empty"
            />
          )}
        </SectionCard>
      </Flex>
    </Drawer>
  )
}
