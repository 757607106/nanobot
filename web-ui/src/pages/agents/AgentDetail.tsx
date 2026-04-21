import { CopyOutlined, DeleteOutlined, EditOutlined, EllipsisOutlined, MessageOutlined, SaveOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { Alert, Button, Dropdown, Empty, Flex, Modal, Popover, Space, Spin, Tabs, Tag, Switch, Typography, theme } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionCard from '../../components/console/SectionCard'
import type {
  AgentDefinition,
  AgentMemorySnapshot,
  AgentTemplateTool,
  ConfigData,
  ConfigMeta,
  InstalledSkill,
  KnowledgeBaseDefinition,
  McpServerEntry,
  AgentTemplate,
} from '../../types'
import AgentEditor from './AgentEditor'
import CapabilitiesTab from './CapabilitiesTab'
import MemoryTab from './MemoryTab'
import type { AgentFormState, AgentTab } from './types'
import { getAgentAvatar, AVATAR_PRESETS, setAgentAvatarOverride, type AvatarPreset } from '../../avatarConfig'
import AgentTestRunDrawer from './AgentTestRunDrawer'
import { resolveToneBg, resolveToneBorder } from '../../ui/kit/tone'

interface AgentDetailProps {
  isCreateRoute: boolean
  selectedAgentId: string | null
  currentAgent: AgentDefinition | null
  form: AgentFormState
  agentMemory: AgentMemorySnapshot | null
  validTools: AgentTemplateTool[]
  skills: InstalledSkill[]
  mcpServers: McpServerEntry[]
  agentTemplates: AgentTemplate[]
  knowledgeBases: KnowledgeBaseDefinition[]
  globalConfig: ConfigData | null
  globalConfigMeta: ConfigMeta | null
  loadingDetail: boolean
  loadingMemory: boolean
  saving: boolean
  copying: boolean
  deleting: boolean
  error: string | null
  memoryError: string | null
  detailRequestAgentId: string | null
  onUpdateForm: <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => void
  onApplyTemplate: (templateName: string) => void
  onToggleArrayItem: (
    key: 'toolAllowlist' | 'skillIds' | 'mcpServerIds' | 'knowledgeBindingIds',
    item: string,
  ) => void
  onSave: () => void
  onCopy: () => void
  onDelete: () => void
  onRefreshMemory: (agentId: string) => void
  onSaveMemory: (agentId: string, files: Record<string, string>) => void
}

export default function AgentDetail({
  isCreateRoute,
  selectedAgentId,
  currentAgent,
  form,
  agentMemory,
  validTools,
  skills,
  mcpServers,
  agentTemplates,
  knowledgeBases,
  globalConfig,
  globalConfigMeta,
  loadingDetail,
  loadingMemory,
  saving,
  copying,
  deleting,
  error,
  memoryError,
  detailRequestAgentId,
  onUpdateForm,
  onApplyTemplate,
  onToggleArrayItem,
  onSave,
  onCopy,
  onDelete,
  onRefreshMemory,
  onSaveMemory,
}: AgentDetailProps) {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const [detailTab, setDetailTab] = useState<AgentTab>('basic')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [testRunOpen, setTestRunOpen] = useState(false)
  const capabilityCount = form.toolAllowlist.length + form.skillIds.length + form.mcpServerIds.length + form.knowledgeBindingIds.length

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
          <Spin tip="正在加载员工详情..." size="large" />
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
      <Typography.Text strong style={{ display: 'block', marginBottom: token.marginSM }}>
        选择数字员工形象
      </Typography.Text>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
      }}>
        {AVATAR_PRESETS.map((preset) => (
          <div
            key={preset.key}
            onClick={() => handleSelectAvatar(preset)}
            style={{
              cursor: 'pointer',
              borderRadius: 14,
              padding: 3,
              background: avatar.key === preset.key ? resolveToneBg(token as any, preset.tone) : 'transparent',
              border: avatar.key === preset.key ? `2px solid ${resolveToneBorder(token as any, preset.tone)}` : '2px solid transparent',
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
        ))}
      </div>
    </div>
  )

  return (
    <Flex vertical gap={18} className="page-stack">
      <div className="agent-detail-hero">
        <Flex justify="space-between" align="center">
          <Flex gap={16} align="center">
            <Popover
              content={avatarPickerContent}
              trigger="click"
              open={avatarPickerOpen}
              onOpenChange={setAvatarPickerOpen}
              placement="bottomLeft"
            >
              <div style={{
                width: 60,
                height: 60,
                borderRadius: 16,
                background: resolveToneBg(token as any, avatar.tone),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: token.boxShadowSecondary,
                flexShrink: 0,
                padding: 3,
                cursor: 'pointer',
                position: 'relative',
              }}>
                <img
                  src={avatar.src}
                  alt={avatar.label}
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 13,
                    objectFit: 'cover',
                  }}
                />
                {/* 悬浮编辑提示 */}
                <div style={{
                  position: 'absolute',
                  bottom: -4,
                  right: -4,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: token.colorBgContainer,
                  border: `2px solid ${token.colorBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: token.fontSizeSM,
                  color: token.colorTextSecondary,
                }}>
                  <EditOutlined style={{ fontSize: 10 }} />
                </div>
              </div>
            </Popover>
            <Flex vertical gap={4}>
              <Flex align="center" gap={token.marginSM}>
                <Typography.Title level={3} style={{ margin: 0, fontWeight: token.fontWeightStrong }}>
                  {isCreateRoute ? '新建员工' : currentAgent?.name || form.name || '选择数字员工'}
                </Typography.Title>
                {!isCreateRoute && (
                  <Tag color={form.enabled ? 'processing' : 'default'} style={{ borderRadius: token.borderRadiusLG, border: 'none', margin: 0 }}>
                    {form.enabled ? '已启用' : '已停用'}
                  </Tag>
                )}
                  {isCreateRoute && agentTemplates.length > 0 && (
                    <Flex
                      align="center"
                      gap={token.marginXS}
                      style={{
                        padding: '4px 10px',
                        background: token.colorBgContainer,
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${token.colorBorder}`
                      }}
                    >
                      <Typography.Text type="secondary">快速预置：</Typography.Text>
                      <select 
                        onChange={(e) => onApplyTemplate(e.target.value)}
                        style={{ 
                          background: 'transparent',
                          border: 'none',
                          outline: 'none',
                          color: token.colorText,
                          cursor: 'pointer'
                        }}
                      >
                        <option value="">- 请选择资源蓝图 -</option>
                        {agentTemplates.map(t => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </Flex>
                  )}
              </Flex>
              <Typography.Text type="secondary" style={{ maxWidth: 600 }}>
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
                <Button icon={<PlayCircleOutlined />} onClick={() => setTestRunOpen(true)} style={{ borderRadius: 12 }}>
                  测试运行
                </Button>
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
            <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={saving} style={{ borderRadius: token.borderRadiusLG, fontWeight: token.fontWeightStrong }}>
              保存变更
            </Button>
          </Flex>
        </Flex>

        {error ? <Alert type="error" message={error} showIcon style={{ borderRadius: 12 }} /> : null}
      </div>

      <Tabs
        activeKey={detailTab}
        onChange={(value) => setDetailTab(value as AgentTab)}
        type="line"
        size="large"
        tabBarStyle={{ marginBottom: 24 }}
        items={[
            {
              key: 'basic',
              label: <span style={{ fontWeight: token.fontWeightStrong }}>核心配置</span>,
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
              label: <span style={{ fontWeight: token.fontWeightStrong }}>外接能力 ({capabilityCount})</span>,
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
              label: <span style={{ fontWeight: token.fontWeightStrong }}>长期记忆</span>,
              children: (
                <MemoryTab
                  currentAgent={currentAgent}
                  agentMemory={agentMemory}
                  loadingMemory={loadingMemory}
                  memoryError={memoryError}
                  onRefresh={onRefreshMemory}
                  onSaveMemory={onSaveMemory}
                />
              ),
            },
          ]}
      />

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

      {currentAgent && (
        <AgentTestRunDrawer
          open={testRunOpen}
          onClose={() => setTestRunOpen(false)}
          agentId={currentAgent.agentId}
          agentName={currentAgent.name}
        />
      )}
    </Flex>
  )
}
