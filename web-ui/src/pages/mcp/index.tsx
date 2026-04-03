import { useEffect, useMemo, useState } from 'react'
import { App, Button, Empty, Spin, theme } from 'antd'
import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { ConfigData, McpServerEntry, McpServerListResponse } from '../../types'
import { createEmptyDraft, ServerDraft } from './utils'
import ServerCard from './ServerCard'
import AddServerModal from './AddServerModal'

import PageHeader from '../../components/console/PageHeader'
import MetricCard from '../../components/console/MetricCard'
import SectionCard from '../../components/console/SectionCard'

export default function McpPage() {
  const { message, modal } = App.useApp()
  const { token } = theme.useToken()
  const [data, setData] = useState<McpServerListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actingName, setActingName] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<McpServerEntry | null>(null)
  const [draft, setDraft] = useState<ServerDraft>(createEmptyDraft())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void loadServers()
  }, [])

  const servers = useMemo(() => data?.items ?? [], [data])
  const existingNames = useMemo(() => new Set(servers.map((item) => item.name)), [servers])

  async function loadServers() {
    try {
      setLoading(true)
      const next = await api.getMcpServers()
      setData(next)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 MCP 列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(entry: McpServerEntry) {
    try {
      setActingName(entry.name)
      await api.setMcpServerEnabled(entry.name, !entry.enabled)
      await loadServers()
      message.success(entry.enabled ? '已停用' : '已启用')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setActingName(null)
    }
  }

  function handleDelete(entry: McpServerEntry) {
    modal.confirm({
      title: `删除 ${entry.displayName || entry.name}`,
      content: '确定要删除该 MCP 服务器吗？',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setActingName(entry.name)
        try {
          await api.deleteMcpServer(entry.name)
          await loadServers()
          message.success('已删除')
        } finally {
          setActingName(null)
        }
      },
    })
  }

  function openCreateDialog() {
    setEditingEntry(null)
    setDraft(createEmptyDraft('stdio'))
    setDialogOpen(true)
  }

  function openEditDialog(entry: McpServerEntry) {
    setEditingEntry(entry)
    const type = entry.transport === 'unknown' ? 'stdio' : entry.transport
    setDraft({
      name: entry.name,
      displayName: entry.displayName || entry.name,
      type: type as 'stdio' | 'sse' | 'streamableHttp',
      command: entry.command || '',
      argsText: (entry.args || []).join(' '),
      envText: Object.entries(entry.env || {})
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      url: entry.url || '',
      headersText: Object.entries(entry.headers || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
      toolTimeout: Number(entry.toolTimeout || 30),
    })
    setDialogOpen(true)
  }

  async function handleSave(config: {
    displayName: string | null
    enabled: boolean
    type: 'stdio' | 'sse' | 'streamableHttp'
    command: string
    args: string[]
    env: Record<string, string>
    url: string
    headers: Record<string, string>
    toolTimeout: number
  }) {
    try {
      setSaving(true)
      if (editingEntry) {
        await api.updateMcpServer(editingEntry.name, config)
        message.success('配置已保存')
      } else {
        const serverName = draft.name.trim()
        const currentConfig = await api.getConfig()
        const nextConfig: ConfigData = {
          ...currentConfig,
          tools: {
            ...currentConfig.tools,
            mcpServers: {
              ...(currentConfig.tools.mcpServers ?? {}),
              [serverName]: {
                ...config,
                enabled: true,
              },
            },
          },
        }
        await api.updateConfig(nextConfig)
        message.success('服务器已添加')
      }
      setDialogOpen(false)
      await loadServers()
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ minHeight: 400 }}
      >
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div
      className="page-stack"
      style={{
        maxWidth: 1600,
        marginInline: 'auto',
        paddingInline: 'var(--nb-spacing-lg)',
        paddingBlock: 'var(--nb-spacing-lg)',
      }}
    >
      <PageHeader
        title="MCP 扩展"
        subtitle="管理 Model Context Protocol 服务器配置"
        actions={
          <div className="flex gap-2">
            <Button icon={<UploadOutlined />}>
              导入配置
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDialog}>
              添加服务器
            </Button>
          </div>
        }
      />

      {/* Statistics */}
      {servers.length > 0 && (
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--nb-spacing-md)',
          }}
        >
          <MetricCard label="共计接入" value={servers.length} tone="neutral" />
          <MetricCard label="已启用" value={servers.filter((s) => s.enabled).length} tone="success" />
          <MetricCard label="待维护" value={servers.filter((s) => s.status === 'incomplete').length} tone="warning" />
        </div>
      )}

      {/* Server Grid */}
      <SectionCard>
        {servers.length > 0 ? (
          <div
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
            style={{ gap: 'var(--nb-spacing-md)' }}
          >
            {servers.map((entry) => (
              <ServerCard
                key={entry.name}
                entry={entry}
                loading={actingName === entry.name}
                onToggle={handleToggle}
                onEdit={openEditDialog}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <Empty
            description="暂无 MCP 服务器"
            style={{ paddingBlock: 'var(--nb-spacing-xl)' }}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDialog}>
              添加第一个服务器
            </Button>
          </Empty>
        )}
      </SectionCard>

      {/* Add/Edit Modal */}
      <AddServerModal
        open={dialogOpen}
        editingEntry={editingEntry}
        draft={draft}
        existingNames={existingNames}
        saving={saving}
        onDraftChange={setDraft}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />
    </div>
  )
}
