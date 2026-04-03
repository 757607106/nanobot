import { CopyOutlined, DeleteOutlined, MessageOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Modal, Space, Spin, Tabs, Tag, Typography } from 'antd'
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
import TestTab from './TestTab'
import type { AgentFormState, AgentTab } from './types'
import { memoryScopeLabel } from './utils'

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

  const isDetailPending = Boolean(selectedAgentId) && !isCreateRoute && (
    loadingDetail || detailRequestAgentId !== selectedAgentId
  )

  const detailTitle = isCreateRoute
    ? '新建员工'
    : currentAgent?.name || form.name || '选择数字员工'

  const detailSubtitle = isCreateRoute
    ? '创建新的员工配置。'
    : currentAgent?.description || form.description || '维护角色说明、能力绑定、记忆治理和试运行。'

  if (isDetailPending) {
    return (
      <SectionCard title="员工工作台">
        <Flex justify="center" align="center" style={{ minHeight: 220 }}>
          <Spin tip="正在加载员工详情..." />
        </Flex>
      </SectionCard>
    )
  }

  if (!isCreateRoute && !selectedAgentId) {
    return (
      <SectionCard title="员工工作台">
        <Flex justify="center" align="center" style={{ minHeight: 260 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="选中一个员工后，右侧会展开配置、能力、记忆和试运行。"
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

  return (
    <Flex vertical gap={6}>
      <PageHeader
        title={detailTitle}
        subtitle={detailSubtitle}
        actions={(
          <>
            {currentAgent ? (
              <Button icon={<MessageOutlined />} onClick={() => navigate(`/studio/agents/${currentAgent.agentId}/chat`)}>
                会话
              </Button>
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={onRefreshWorkspace}>
              刷新
            </Button>
            {currentAgent ? (
              <Button icon={<CopyOutlined />} onClick={onCopy} loading={copying}>
                复制
              </Button>
            ) : null}
            {currentAgent ? (
              <Button danger icon={<DeleteOutlined />} onClick={() => setDeleteDialogOpen(true)}>
                删除
              </Button>
            ) : null}
            <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={saving}>
              保存
            </Button>
          </>
        )}
      />

      {error ? <Alert type="error" message={error} showIcon /> : null}

      <Space wrap size={[8, 8]}>
        <Tag color={form.enabled ? 'success' : 'default'}>{form.enabled ? '已启用' : '已停用'}</Tag>
        {currentAgent?.sourceTemplateName ? <Tag color="purple">{`模板 · ${currentAgent.sourceTemplateName}`}</Tag> : null}
        <Tag color="blue">{form.binding ? `绑定 · ${form.binding}` : '跟随默认绑定'}</Tag>
        <Tag>{memoryScopeLabel(form.memoryScope)}</Tag>
        {currentAgent ? <Tag>{currentAgent.agentId}</Tag> : <Tag>未保存</Tag>}
      </Space>

      <Tabs
        activeKey={detailTab}
        onChange={(value) => setDetailTab(value as AgentTab)}
        size="small"
        tabBarGutter={18}
        items={[
          {
            key: 'basic',
            label: '基本信息',
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
            label: '能力配置',
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
            label: '记忆治理',
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
          {
            key: 'test',
            label: '试运行',
            children: (
              <TestTab
                currentAgent={currentAgent}
                recentRuns={recentRuns}
                loadingRuns={loadingRuns}
                runError={runError}
                onTestRun={onTestRun}
                onRefreshRuns={onRefreshRuns}
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
    </Flex>
  )
}
