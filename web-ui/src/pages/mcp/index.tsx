import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { App, Button, Card, Empty, Skeleton } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { ConfigData, McpServerEntry, McpServerListResponse } from '../../types'
import { createEmptyDraft, ServerDraft } from './utils'
import ServerCard from './ServerCard'
import AddServerModal from './AddServerModal'
import McpServerDetailDrawer from './DetailPage'

import PageHeader from '../../components/console/PageHeader'
import SectionCard from '../../components/console/SectionCard'
import { useToast } from '../../toast'

export default function McpPage() {
  const { serverName } = useParams()
  const navigate = useNavigate()
  const { modal } = App.useApp()
  const message = useToast()
  const [data, setData] = useState<McpServerListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actingName, setActingName] = useState<string | null>(null)
  // Create dialog state (edit is done in the Drawer)
  const [dialogOpen, setDialogOpen] = useState(false)
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
      message.error(error instanceof Error ? error.message : '加载服务连接失败')
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
      content: '确定要删除该服务连接吗？',
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
    setDraft(createEmptyDraft('stdio'))
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
      // Only create new server (edit goes through DetailPage Drawer)
      const newServerName = draft.name.trim()
      const currentConfig = await api.getConfig()
      const nextConfig: ConfigData = {
        ...currentConfig,
        tools: {
          ...currentConfig.tools,
          mcpServers: {
            ...(currentConfig.tools.mcpServers ?? {}),
            [newServerName]: {
              ...config,
              enabled: true,
            },
          },
        },
      }
      await api.updateConfig(nextConfig)
      message.success('连接已添加')
      setDialogOpen(false)
      await loadServers()
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="page-stack" style={{ paddingInline: 'var(--nb-spacing-lg)', paddingBlock: 'var(--nb-spacing-lg)' }}>
        <PageHeader title="服务集成" />
        <SectionCard title="连接列表">
          <div style={{ display: 'grid', gap: 'var(--nb-spacing-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {[1, 2, 3].map((key) => (
              <Card
                key={key}
                style={{ borderRadius: 16, borderColor: 'var(--nb-card-subtle-border)', boxShadow: 'none', background: 'var(--nb-card-subtle-bg)' }}
              >
                <Skeleton active avatar={{ shape: 'square', size: 44, style: { borderRadius: 12 } }} title={{ width: 120 }} paragraph={{ rows: 2 }} />
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--nb-border)' }}>
                  <Skeleton.Button active size="small" shape="round" block style={{ height: 28 }} />
                </div>
              </Card>
            ))}
          </div>
        </SectionCard>
      </div>
    )
  }

  return (
    <div className="page-stack" style={{ paddingInline: 'var(--nb-spacing-lg)', paddingBlock: 'var(--nb-spacing-lg)' }}>
      <PageHeader
        title="服务集成"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDialog}>
            添加连接
          </Button>
        }
      />

      <SectionCard title={`连接列表（${servers.length}）`}>
        {servers.length > 0 ? (
          <div style={{ display: 'grid', gap: 'var(--nb-spacing-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {servers.map((entry) => (
              <ServerCard
                key={entry.name}
                entry={entry}
                loading={actingName === entry.name}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <Empty description="暂无服务连接" style={{ paddingBlock: 'var(--nb-spacing-xl)' }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDialog}>
              添加第一个连接
            </Button>
          </Empty>
        )}
      </SectionCard>

      {/* Create-only modal (edit is done in the detail Drawer) */}
      <AddServerModal
        open={dialogOpen}
        editingEntry={null}
        draft={draft}
        existingNames={existingNames}
        saving={saving}
        onDraftChange={setDraft}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />

      <McpServerDetailDrawer
        serverName={serverName}
        open={!!serverName}
        onClose={() => {
          navigate('/mcp')
          void loadServers()
        }}
      />
    </div>
  )
}
