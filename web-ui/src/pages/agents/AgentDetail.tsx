import { CopyOutlined, DeleteOutlined, EditOutlined, EllipsisOutlined, MessageOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { Alert, Button, Dropdown, Empty, Flex, Modal, Popover, Space, Spin, Tabs, Tag, Switch, Tooltip, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../components/console/PageHeader'
import SectionCard from '../../components/console/SectionCard'
import type {
  AgentDefinition,
  AgentMemorySnapshot,
  AgentRunSummary,
  AgentTemplateTool,
  ConfigData,
  ConfigMeta,
  InstalledSkill,
  KnowledgeBaseDefinition,
  MemoryCandidate,
  McpServerEntry,
} from '../../types'
import AgentEditor from './AgentEditor'
import CapabilitiesTab from './CapabilitiesTab'
import MemoryTab from './MemoryTab'
import type { AgentFormState, AgentTab } from './types'
import { memoryScopeLabel } from './utils'
import { getAgentAvatar, AVATAR_PRESETS, setAgentAvatarOverride, type AvatarPreset } from '../../avatarConfig'

interface AgentDetailProps {
  isCreateRoute: boolean
  selectedAgentId: string | null
  currentAgent: AgentDefinition | null
  form: AgentFormState
  agentMemory: AgentMemorySnapshot | null
  agentMemoryCandidates: MemoryCandidate[]
  recentRuns: AgentRunSummary[]
  validTools: AgentTemplateTool[]
  skills: InstalledSkill[]
  mcpServers: McpServerEntry[]
  knowledgeBases: KnowledgeBaseDefinition[]
  globalConfig: ConfigData | null
  globalConfigMeta: ConfigMeta | null
  loadingDetail: boolean
  loadingMemory: boolean
  loadingRuns: boolean
  saving: boolean
  copying: boolean
  deleting: boolean
  error: string | null
  memoryError: string | null
  runError: string | null
  detailRequestAgentId: string | null
  onUpdateForm: <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => void
  onToggleArrayItem: (
    key: 'toolAllowlist' | 'skillIds' | 'mcpServerIds' | 'knowledgeBindingIds',
    item: string,
  ) => void
  onSave: () => void
  onCopy: () => void
  onDelete: () => void
  onRefreshWorkspace: () => void
  onRefreshMemory: (agentId: string) => void
  onSaveMemory: (agentId: string, content: string) => void
  onCreateCandidate: (agentId: string, content: string) => void
  onApplyCandidate: (agentId: string, candidateId: string) => void
  onRejectCandidate: (agentId: string, candidateId: string) => void
  onTestRun: (agentId: string, prompt: string) => Promise<string>
  onRefreshRuns: (agentId: string) => void
}

export default function AgentDetail({
  isCreateRoute,
  selectedAgentId,
  currentAgent,
  form,
  agentMemory,
  agentMemoryCandidates,
  recentRuns,
  validTools,
  skills,
  mcpServers,
  knowledgeBases,
  globalConfig,
  globalConfigMeta,
  loadingDetail,
  loadingMemory,
  loadingRuns,
  saving,
  copying,
  deleting,
  error,
  memoryError,
  runError,
  detailRequestAgentId,
  onUpdateForm,
  onToggleArrayItem,
  onSave,
  onCopy,
  onDelete,
  onRefreshWorkspace,
  onRefreshMemory,
  onSaveMemory,
  onCreateCandidate,
  onApplyCandidate,
  onRejectCandidate,
  onTestRun,
  onRefreshRuns,
}: AgentDetailProps) {
  const navigate = useNavigate()
  const [detailTab, setDetailTab] = useState<AgentTab>('basic')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const capabilityCount = form.toolAllowlist.length + form.skillIds.length + form.mcpServerIds.length + form.knowledgeBindingIds.length
  const pendingMemoryCount = agentMemoryCandidates.filter((item) => item.status === 'proposed').length

  const isDetailPending = Boolean(selectedAgentId) && !isCreateRoute && (
    loadingDetail || detailRequestAgentId !== selectedAgentId
  )

  const detailTitle = isCreateRoute
    ? '新建员工'
    : currentAgent?.name || form.name || '选择数字员工'

  const detailSubtitle = isCreateRoute
    ? undefined
    : currentAgent?.description || form.description || undefined

  if (isDetailPending) {
    return (
      <SectionCard title="员工详情">
        <Flex justify="center" align="center" style={{ minHeight: 220 }}>
          <Spin tip="正在加载员工详情..." />
        </Flex>
      </SectionCard>
    )
  }

  if (!isCreateRoute && !selectedAgentId) {
    return (
      <SectionCard title="员工详情">
        <Flex justify="center" align="center" style={{ minHeight: 260 }}>
          <Empty
            image={false} className="minimal-empty"
            description="未选择员工"
          >
            <Space wrap size={[8, 8]}>
              <Button type="primary" onClick={() => navigate('/studio/agents/new')}>
                创建新员工
              </Button>
            </Space>
          </Empty>
        </Flex>
      </SectionCard>
    )
  }

  const agentId = currentAgent?.agentId || ''
  const avatar = getAgentAvatar(
    agentId,
    form.name || detailTitle,
    form.description,
    form.tags,
  )

  function handleSelectAvatar(preset: AvatarPreset) {
    if (agentId) {
      setAgentAvatarOverride(agentId, preset.key)
    }
    setAvatarPickerOpen(false)
  }

  const avatarPickerContent = (
    <div style={{ width: 340 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
        选择数字员工形象
      </Typography.Text>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
      }}>
        {AVATAR_PRESETS.map((preset) => (
          <Tooltip key={preset.key} title={preset.label}>
            <div
              onClick={() => handleSelectAvatar(preset)}
              style={{
                cursor: 'pointer',
                borderRadius: 14,
                padding: 3,
                background: avatar.key === preset.key ? preset.gradient : 'transparent',
                border: avatar.key === preset.key ? `2px solid ${preset.color}` : '2px solid transparent',
                transition: 'all 0.2s ease',
                aspectRatio: '1',
              }}
            >
              <img
                src={preset.src}
                alt={preset.label}
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 11,
                  objectFit: 'cover',
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  )

  return (
    <Flex vertical gap={24} style={{ padding: '32px max(24px, calc((100% - var(--nb-content-max-width)) / 2))', minHeight: '100vh', background: 'var(--nb-body-bg)' }}>
      
      <div style={{
        background: 'var(--nb-surface-strong)',
        borderRadius: 24,
        padding: '32px',
        border: '1px solid var(--nb-card-border)',
        boxShadow: 'var(--nb-shadow-soft)',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Subtle background glow */}
        <div style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 300,
          height: 300,
          background: avatar.gradient,
          filter: 'blur(80px)',
          opacity: 0.3,
          zIndex: 0,
          borderRadius: '50%'
        }} />

        <Flex justify="space-between" align="flex-start" style={{ position: 'relative', zIndex: 1 }}>
          <Flex gap={24} align="center">
            <Popover
              content={avatarPickerContent}
              trigger="click"
              open={avatarPickerOpen}
              onOpenChange={setAvatarPickerOpen}
              placement="bottomLeft"
            >
              <div style={{
                width: 80,
                height: 80,
                borderRadius: 24,
                background: avatar.gradient,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 10px 30px -5px ${avatar.color}33`,
                flexShrink: 0,
                padding: 4,
                cursor: 'pointer',
                position: 'relative',
              }}>
                <img
                  src={avatar.src}
                  alt={avatar.label}
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 20,
                    objectFit: 'cover',
                  }}
                />
                {/* 悬浮编辑提示 */}
                <div style={{
                  position: 'absolute',
                  bottom: -4,
                  right: -4,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--nb-surface-strong)',
                  border: '2px solid var(--nb-card-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: 'var(--nb-muted)',
                }}>
                  <EditOutlined />
                </div>
              </div>
            </Popover>
            <Flex vertical gap={8}>
              <Typography.Title level={2} style={{ margin: 0, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 12 }}>
                {detailTitle}
                {!isCreateRoute && (
                  <Tag color={form.enabled ? 'processing' : 'default'} style={{ borderRadius: 12, padding: '2px 10px', fontSize: 13, border: 'none', margin: 0 }}>
                    {form.enabled ? 'Active' : 'Inactive'}
                  </Tag>
                )}
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 15, maxWidth: 600 }}>
                {detailSubtitle || '设定该数字员工的基础行为准则与响应模型'}
              </Typography.Text>
            </Flex>
          </Flex>

          <Flex gap={12} align="center" wrap="wrap">
            <Button onClick={() => navigate('/studio/agents')} style={{ borderRadius: 12 }}>
              返回大厅
            </Button>
            <Switch
              checked={form.enabled}
              onChange={(checked) => onUpdateForm('enabled', checked)}
              checkedChildren="ON"
              unCheckedChildren="OFF"
            />
            {currentAgent && (
              <>
                <Button type="dashed" icon={<MessageOutlined />} onClick={() => navigate(`/studio/agents/${currentAgent.agentId}/chat`)} style={{ borderRadius: 12 }}>
                  发起会话
                </Button>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'copy',
                        icon: <CopyOutlined />,
                        label: '复制员工',
                        onClick: onCopy,
                        disabled: copying,
                      },
                      { type: 'divider' },
                      {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: '辞退员工 (删除)',
                        danger: true,
                        onClick: () => setDeleteDialogOpen(true),
                      },
                    ],
                  }}
                  placement="bottomRight"
                >
                  <Button icon={<EllipsisOutlined />} style={{ borderRadius: 12 }} />
                </Dropdown>
              </>
            )}
            <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={saving} style={{ borderRadius: 12, fontWeight: 500 }}>
              保存变更
            </Button>
          </Flex>
        </Flex>

        {error ? <Alert type="error" message={error} showIcon style={{ borderRadius: 12 }} /> : null}
      </div>

      <div style={{ padding: '0 8px' }}>
        <Tabs
          activeKey={detailTab}
          onChange={(value) => setDetailTab(value as AgentTab)}
          type="line"
          size="large"
          tabBarStyle={{ marginBottom: 24 }}
          items={[
            {
              key: 'basic',
              label: <span style={{ fontWeight: 500, fontSize: 15 }}>核心配置 (Engine & Rules)</span>,
              children: (
                <AgentEditor
                  form={form}
                  currentAgent={currentAgent}
                  globalConfig={globalConfig}
                  globalConfigMeta={globalConfigMeta}
                  onUpdateForm={onUpdateForm}
                />
              ),
            },
            {
              key: 'capabilities',
              label: <span style={{ fontWeight: 500, fontSize: 15 }}>外接能力 ({capabilityCount})</span>,
              children: (
                <CapabilitiesTab
                  form={form}
                  validTools={validTools}
                  skills={skills}
                  mcpServers={mcpServers}
                  knowledgeBases={knowledgeBases}
                  onToggleArrayItem={onToggleArrayItem}
                />
              ),
            },
            {
              key: 'memory',
              label: <span style={{ fontWeight: 500, fontSize: 15 }}>记忆治理 ({pendingMemoryCount})</span>,
              children: (
                <MemoryTab
                  currentAgent={currentAgent}
                  agentMemory={agentMemory}
                  agentMemoryCandidates={agentMemoryCandidates}
                  formMemoryScope={form.memoryScope}
                  loadingMemory={loadingMemory}
                  memoryError={memoryError}
                  onRefresh={onRefreshMemory}
                  onSaveMemory={onSaveMemory}
                  onCreateCandidate={onCreateCandidate}
                  onApplyCandidate={onApplyCandidate}
                  onRejectCandidate={onRejectCandidate}
                />
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={deleteDialogOpen}
        onCancel={() => setDeleteDialogOpen(false)}
        onOk={onDelete}
        confirmLoading={deleting}
        title="删除员工"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          确定要删除 {currentAgent ? `「${currentAgent.name}」` : '当前员工'} 吗？
        </Typography.Paragraph>
      </Modal>
    </Flex>
  )
}
