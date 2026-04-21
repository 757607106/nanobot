import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { App, Button, Card, Empty, Flex, Input, Skeleton, Space, Switch, Tag, Typography, Tabs, Popconfirm, theme } from 'antd'
import { CodeOutlined, DeleteOutlined, GlobalOutlined, PlusOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { api } from '../../api'
import type { ConfigData, McpRepositoryAnalysis, McpServerEntry, McpServerListResponse } from '../../types'
import { createEmptyDraft, ServerDraft } from './utils'
import AddServerModal from './AddServerModal'
import McpServerDetailPage from './DetailPage'

import PageHeader from '../../components/console/PageHeader'

import { useToast } from '../../toast'
import { formatDateTimeZh } from '../../locale'

const statusTone: Record<string, { label: string; color: string }> = {
  ready: { label: '就绪', color: 'success' },
  incomplete: { label: '待配置', color: 'warning' },
  disabled: { label: '已停用', color: 'default' },
}

function McpCard({
  entry,
  actingName,
  onToggle,
  onDelete,
  onClick,
}: {
  entry: McpServerEntry
  actingName: string | null
  onToggle: (entry: McpServerEntry) => void
  onDelete: (entry: McpServerEntry) => void
  onClick: () => void
}) {
  const { token } = theme.useToken()
  const icon = entry.transport === 'stdio' ? <CodeOutlined /> : <GlobalOutlined />
  const preview =
    entry.transport === 'stdio'
      ? [entry.command || '', ...(entry.args || [])].filter(Boolean).join(' ')
      : entry.url || '未配置地址'
  const statusInfo = statusTone[entry.status] ?? { label: entry.status, color: 'default' }

  // Use the same avatar color logic as SkillCard
  const avatarColor = `hsl(${(entry.name.charCodeAt(0) || 65) * 137 % 360}, 65%, 55%)`

  return (
    <motion.div
      className="skill-card"
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    >
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: avatarColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text strong style={{ fontSize: 16, display: 'block', letterSpacing: '-0.01em' }}>
              {entry.displayName || entry.name}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4, fontFamily: 'monospace' }}>
              {entry.name}
            </Typography.Text>
            <Flex gap={6} wrap="wrap">
              <Tag bordered={false} style={{ margin: 0, borderRadius: 6, fontSize: 12 }}>
                {entry.transport === 'stdio' ? 'LOCAL' : 'REMOTE'}
              </Tag>
              <Tag
                color={entry.enabled ? 'green' : 'default'}
                bordered={false}
                style={{ margin: 0, borderRadius: 6, fontSize: 12 }}
              >
                {entry.enabled ? '已启用' : '已停用'}
              </Tag>
              <Tag
                color={statusInfo.color}
                bordered={false}
                style={{ margin: 0, borderRadius: 6, fontSize: 12 }}
              >
                {statusInfo.label}
              </Tag>
            </Flex>
          </div>
        </div>

        {/* Actions */}
        <Flex gap={12} align="center" onClick={(e) => e.stopPropagation()}>
          <Switch
            size="small"
            checked={entry.enabled}
            loading={actingName === entry.name}
            onChange={() => onToggle(entry)}
          />
          <Popconfirm title="确定删除这个连接吗？" onConfirm={() => onDelete(entry)} okButtonProps={{ danger: true }}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Flex>
      </Flex>

      <Typography.Paragraph
        type="secondary"
        ellipsis={{ rows: 2 }}
        style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20, fontFamily: 'monospace' }}
      >
        {preview}
      </Typography.Paragraph>

      <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
        <Flex justify="space-between" align="center">
          <Typography.Text type="secondary" style={{ fontSize: 12, opacity: 0.6 }}>
            {entry.toolCountKnown ? `${entry.toolCount || 0} Tools` : '未同步工具'}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, opacity: 0.6 }}>
            {entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '尚未测试'}
          </Typography.Text>
        </Flex>
      </div>
    </motion.div>
  )
}

export default function McpPage() {
  const { serverName } = useParams()
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const { modal } = App.useApp()
  const message = useToast()
  const [data, setData] = useState<McpServerListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actingName, setActingName] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<ServerDraft>(createEmptyDraft())
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'connections' | 'repository'>('connections')
  const [repoSource, setRepoSource] = useState('')
  const [repoAnalysis, setRepoAnalysis] = useState<McpRepositoryAnalysis | null>(null)
  const [repoInspecting, setRepoInspecting] = useState(false)
  const [repoInstalling, setRepoInstalling] = useState(false)

  useEffect(() => {
    void loadServers()
  }, [])

  const servers = useMemo(() => data?.items ?? [], [data])
  const existingNames = useMemo(() => new Set(servers.map((item) => item.name)), [servers])
  const filteredServers = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return servers.filter((entry) => {
      if (!normalized) return true
      const haystack = `${entry.displayName || ''} ${entry.name} ${entry.url || ''}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [search, servers])

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

  async function handleInspectRepository() {
    const source = repoSource.trim()
    if (!source) {
      message.error('请先填写仓库地址')
      return
    }
    try {
      setRepoInspecting(true)
      const result = await api.inspectMcpRepository(source)
      setRepoAnalysis(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '检查失败')
    } finally {
      setRepoInspecting(false)
    }
  }

  async function handleInstallRepository() {
    const source = repoSource.trim()
    if (!source) {
      message.error('请先填写仓库地址')
      return
    }
    try {
      setRepoInstalling(true)
      const result = await api.installMcpRepository(source)
      message.success('安装完成')
      await loadServers()
      setViewMode('connections')
      navigate(`/mcp/${encodeURIComponent(result.serverName)}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '安装失败')
    } finally {
      setRepoInstalling(false)
    }
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
      <div className="page-stack" style={{ paddingInline: token.paddingLG }}>
        <div style={{ paddingTop: token.paddingLG }}>
          <PageHeader title="服务集成" />
          <div style={{ borderBottom: `1px solid ${token.colorBorderSecondary}`, marginBottom: 24 }}>
            <Tabs items={[{ key: 'loading', label: '加载中...' }]} />
          </div>
        </div>
        <Skeleton active paragraph={{ rows: 6 }} title={false} />
      </div>
    )
  }

  if (serverName) {
    return (
      <McpServerDetailPage
        serverName={serverName}
        onClose={() => {
          navigate('/mcp')
          void loadServers()
        }}
      />
    )
  }

  return (
    <div className="page-stack" style={{ paddingInline: token.paddingLG }}>
      <div style={{ paddingTop: token.paddingLG }}>
        <PageHeader title="服务集成" />
        <div style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Tabs
            activeKey={viewMode}
            onChange={(key) => setViewMode(key as any)}
            items={[
              { key: 'connections', label: '已接入' },
              { key: 'repository', label: '仓库安装' },
            ]}
            style={{ marginBottom: -1 }}
            tabBarStyle={{ marginBottom: 0, borderBottom: 'none' }}
          />
        </div>
      </div>

      <div style={{ paddingTop: 24, paddingBottom: 60 }}>
        {viewMode === 'connections' ? (
          <div>
            <Flex justify="space-between" align="center" style={{ marginBottom: 20 }}>
              <Input.Search
                allowClear
                placeholder="搜索名称、地址..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 280 }}
                variant="filled"
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDialog}>
                添加连接
              </Button>
            </Flex>

            {filteredServers.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                {filteredServers.map((entry) => (
                  <McpCard
                    key={entry.name}
                    entry={entry}
                    actingName={actingName}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onClick={() => navigate(`/mcp/${encodeURIComponent(entry.name)}`)}
                  />
                ))}
              </div>
            ) : (
              <Empty description="暂无匹配的服务连接" style={{ paddingBlock: 48 }}>
                {!search && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDialog}>
                    添加第一个连接
                  </Button>
                )}
              </Empty>
            )}
          </div>
        ) : (
          <div style={{ maxWidth: 640, margin: '40px auto 0' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <Typography.Title level={4} style={{ marginBottom: 8, fontWeight: 600 }}>从生态仓库安装 MCP</Typography.Title>
              <Typography.Text type="secondary">输入 Git 仓库地址或可识别的来源字符串进行检查与安装</Typography.Text>
            </div>
            
            <Space.Compact style={{ width: '100%' }}>
              <Input
                size="large"
                value={repoSource}
                onChange={(e) => setRepoSource(e.target.value)}
                placeholder="例如：https://github.com/abc/xyz"
                prefix={<GlobalOutlined style={{ color: token.colorTextTertiary, marginRight: 8 }} />}
              />
              <Button size="large" onClick={() => setRepoSource('')} disabled={!repoSource}>清除</Button>
              <Button size="large" type="primary" loading={repoInspecting} onClick={() => void handleInspectRepository()} style={{ paddingInline: 24 }}>
                检查
              </Button>
            </Space.Compact>

            {repoAnalysis && (
              <Card
                title={repoAnalysis.displayName || repoAnalysis.title}
                style={{ marginTop: 24, borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}
                styles={{ header: { paddingInline: 20 }, body: { padding: 20 } }}
                extra={
                  <Button
                    type="primary"
                    loading={repoInstalling}
                    disabled={!repoAnalysis?.canInstall}
                    onClick={() => void handleInstallRepository()}
                  >
                    立即安装
                  </Button>
                }
              >
                <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{ marginBottom: 16 }}>
                  <Typography.Text type="secondary" ellipsis>{repoAnalysis.repoUrl}</Typography.Text>
                  <Space size={6} wrap>
                    <Tag bordered={false}>{repoAnalysis.transport === 'stdio' ? '本地 (stdio)' : '远程 (SSE)'}</Tag>
                    <Tag bordered={false} color={repoAnalysis.canInstall ? 'success' : 'error'}>
                      {repoAnalysis.canInstall ? '可直接安装' : '环境或配置存在风险'}
                    </Tag>
                  </Space>
                </Flex>

                <div style={{ display: 'grid', gap: 16 }}>
                  {repoAnalysis.commandPreview && (
                    <div>
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                        预演命令
                      </Typography.Text>
                      <div style={{ background: token.colorFillAlter, padding: '8px 12px', borderRadius: 6 }}>
                        <Typography.Text style={{ fontFamily: token.fontFamilyCode, fontSize: 13 }}>
                          {repoAnalysis.commandPreview}
                        </Typography.Text>
                      </div>
                    </div>
                  )}

                  {repoAnalysis.requiredEnv.length > 0 && (
                     <div>
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>需要提供以下环境变量</Typography.Text>
                      <Space size={6} wrap>
                        {repoAnalysis.requiredEnv.map(key => <Tag bordered={false} color="warning" key={key}>{key}</Tag>)}
                      </Space>
                    </div>
                  )}

                  <div>
                     <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>后续步骤向导</Typography.Text>
                     <Typography.Text>{repoAnalysis.nextStep}</Typography.Text>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

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
    </div>
  )
}
