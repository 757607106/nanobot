import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { testIds } from '../testIds'
import type {
  AgentDefinition,
  ChannelBinding,
  ChannelBindingMutationInput,
  ChannelStateItem,
  TeamDefinition,
} from '../types'

const { Text } = Typography

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface BindingFormState {
  channelName: string
  channelChatId: string
  targetType: 'agent' | 'team'
  targetId: string
  priority: number
  enabled: boolean
}

function createEmptyForm(): BindingFormState {
  return {
    channelName: '',
    channelChatId: '*',
    targetType: 'agent',
    targetId: '',
    priority: 0,
    enabled: true,
  }
}

function bindingToForm(b: ChannelBinding): BindingFormState {
  return {
    channelName: b.channelName,
    channelChatId: b.channelChatId,
    targetType: b.targetType,
    targetId: b.targetId,
    priority: b.priority,
    enabled: b.enabled,
  }
}

function toPayload(form: BindingFormState): ChannelBindingMutationInput {
  return {
    channelName: form.channelName,
    channelChatId: form.channelChatId || '*',
    targetType: form.targetType,
    targetId: form.targetId,
    priority: form.priority,
    enabled: form.enabled,
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ChannelBindingsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { bindingId } = useParams<{ bindingId: string }>()
  const isNewMode = !bindingId

  // Data
  const [bindings, setBindings] = useState<ChannelBinding[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [teams, setTeams] = useState<TeamDefinition[]>([])
  const [channels, setChannels] = useState<ChannelStateItem[]>([])
  const [currentBinding, setCurrentBinding] = useState<ChannelBinding | null>(null)

  // Form
  const [form, setForm] = useState<BindingFormState>(createEmptyForm())

  // Loading
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Helpers
  function updateForm<K extends keyof BindingFormState>(key: K, value: BindingFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // Stats
  const stats = useMemo(() => {
    const total = bindings.length
    const enabled = bindings.filter((b) => b.enabled).length
    const agentCount = bindings.filter((b) => b.targetType === 'agent').length
    const teamCount = bindings.filter((b) => b.targetType === 'team').length
    return [
      { label: '绑定总数', value: total },
      { label: '启用中', value: enabled },
      { label: 'Agent 绑定', value: agentCount },
      { label: 'Team 绑定', value: teamCount },
    ]
  }, [bindings])

  // Target options (dynamic based on targetType)
  const targetOptions = useMemo(() => {
    if (form.targetType === 'team') {
      return teams.map((t) => ({ value: t.teamId, label: t.name }))
    }
    return agents.map((a) => ({ value: a.agentId, label: a.name }))
  }, [form.targetType, agents, teams])

  const channelOptions = useMemo(() => {
    return channels.map((ch) => ({ value: ch.name, label: ch.name }))
  }, [channels])

  // Resolve target name for display
  function resolveTargetName(binding: ChannelBinding): string {
    if (binding.targetType === 'agent') {
      const a = agents.find((x) => x.agentId === binding.targetId)
      return a?.name || binding.targetId
    }
    const t = teams.find((x) => x.teamId === binding.targetId)
    return t?.name || binding.targetId
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function loadWorkspace() {
    setLoadingWorkspace(true)
    try {
      const [bindingsData, agentsData, teamsData, channelsData] = await Promise.all([
        api.getChannelBindings(),
        api.getAgents(),
        api.getTeams(),
        api.getChannels(),
      ])
      setBindings(bindingsData)
      setAgents(agentsData)
      setTeams(teamsData)
      setChannels(channelsData.items || [])
    } catch (err) {
      message.error(getErrorMessage(err, '加载数据失败'))
    } finally {
      setLoadingWorkspace(false)
    }
  }

  async function loadBindingDetail(id: string) {
    try {
      const detail = await api.getChannelBinding(id)
      setCurrentBinding(detail)
      setForm(bindingToForm(detail))
    } catch {
      setCurrentBinding(null)
      setForm(createEmptyForm())
    }
  }

  useEffect(() => {
    loadWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (bindingId) {
      // Try to find in already-loaded list first
      const found = bindings.find((b) => b.bindingId === bindingId)
      if (found) {
        setCurrentBinding(found)
        setForm(bindingToForm(found))
      } else if (!loadingWorkspace) {
        loadBindingDetail(bindingId)
      }
    } else {
      setCurrentBinding(null)
      setForm(createEmptyForm())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingId, bindings])

  // ---------------------------------------------------------------------------
  // CRUD handlers
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!form.channelName.trim()) {
      message.warning('请选择渠道名称。')
      return
    }
    if (!form.targetId.trim()) {
      message.warning('请选择目标 Agent 或 Team。')
      return
    }
    setSaving(true)
    try {
      const payload = toPayload(form)
      if (currentBinding) {
        await api.updateChannelBinding(currentBinding.bindingId, payload)
        message.success('绑定已更新')
      } else {
        const created = await api.createChannelBinding(payload)
        message.success('绑定已创建')
        navigate(`/channels/bindings/${created.bindingId}`, { replace: true })
      }
      await loadWorkspace()
    } catch (err) {
      message.error(getErrorMessage(err, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    if (!currentBinding) return
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除此渠道绑定吗？(${currentBinding.channelName} → ${resolveTargetName(currentBinding)})`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDeleting(true)
        try {
          await api.deleteChannelBinding(currentBinding.bindingId)
          message.success('绑定已删除')
          await loadWorkspace()
          const remaining = bindings.filter((b) => b.bindingId !== currentBinding.bindingId)
          if (remaining.length > 0) {
            navigate(`/channels/bindings/${remaining[0].bindingId}`, { replace: true })
          } else {
            navigate('/channels/bindings/new', { replace: true })
          }
        } catch (err) {
          message.error(getErrorMessage(err, '删除失败'))
        } finally {
          setDeleting(false)
        }
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loadingWorkspace) {
    return (
      <div className="page-stack">
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHero
        eyebrow="渠道"
        title="渠道绑定"
        description="将外部渠道的消息路由到指定的 AI 员工或团队。"
        stats={stats}
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadWorkspace}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/channels/bindings/new')}
            >
              新建绑定
            </Button>
          </Space>
        }
      />

      <div className="page-grid studio-agents-grid">
        {/* Left: Binding list */}
        <Card
          className="studio-agent-list-card"
          title={
            <Space>
              <span>绑定列表</span>
              <Tag>{bindings.length}</Tag>
            </Space>
          }
        >
          {bindings.length === 0 ? (
            <Empty description="暂无渠道绑定" />
          ) : (
            <List
              dataSource={bindings}
              renderItem={(item) => {
                const isActive = item.bindingId === bindingId
                return (
                  <List.Item
                    className={`studio-agent-list-item ${isActive ? 'is-active' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/channels/bindings/${item.bindingId}`)}
                  >
                    <div className="studio-agent-list-copy">
                      <div className="studio-agent-list-head">
                        <Space>
                          <LinkOutlined />
                          <strong>{item.channelName}</strong>
                          {item.channelChatId !== '*' && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              ({item.channelChatId})
                            </Text>
                          )}
                        </Space>
                        <Tag color={item.enabled ? 'success' : 'default'}>
                          {item.enabled ? '启用' : '禁用'}
                        </Tag>
                      </div>
                      <Text type="secondary">
                        → {item.targetType === 'agent' ? 'AI员工' : '团队'}:{' '}
                        {resolveTargetName(item)}
                      </Text>
                      {item.priority > 0 && (
                        <Tag style={{ marginTop: 4 }} color="blue">
                          优先级: {item.priority}
                        </Tag>
                      )}
                    </div>
                  </List.Item>
                )
              }}
            />
          )}
        </Card>

        {/* Right: Edit form */}
        <Card
          title={currentBinding ? `编辑绑定` : '新建绑定'}
          className="studio-agent-detail-card"
        >
          <div className="studio-form-grid">
            {/* Channel Name */}
            <div className="studio-form-field">
              <Text type="secondary">渠道名称</Text>
              <Select
                showSearch
                value={form.channelName || undefined}
                placeholder="选择渠道"
                options={channelOptions}
                onChange={(val) => updateForm('channelName', val)}
                style={{ width: '100%' }}
                allowClear
              />
            </div>

            {/* Channel Chat ID */}
            <div className="studio-form-field">
              <Text type="secondary">聊天 ID</Text>
              <Input
                value={form.channelChatId}
                placeholder="* 表示匹配所有聊天"
                onChange={(e) => updateForm('channelChatId', e.target.value)}
              />
            </div>

            {/* Target Type */}
            <div className="studio-form-field">
              <Text type="secondary">目标类型</Text>
              <Segmented
                value={form.targetType}
                options={[
                  { value: 'agent', label: 'AI员工' },
                  { value: 'team', label: '团队' },
                ]}
                onChange={(val) => {
                  updateForm('targetType', val as 'agent' | 'team')
                  updateForm('targetId', '')
                }}
              />
            </div>

            {/* Target */}
            <div className="studio-form-field">
              <Text type="secondary">
                {form.targetType === 'agent' ? '目标 AI 员工' : '目标团队'}
              </Text>
              <Select
                showSearch
                value={form.targetId || undefined}
                placeholder={form.targetType === 'agent' ? '选择 AI 员工' : '选择团队'}
                options={targetOptions}
                onChange={(val) => updateForm('targetId', val)}
                optionFilterProp="label"
                style={{ width: '100%' }}
                allowClear
              />
            </div>

            {/* Priority */}
            <div className="studio-form-field">
              <Text type="secondary">优先级</Text>
              <InputNumber
                value={form.priority}
                min={0}
                onChange={(val) => updateForm('priority', val ?? 0)}
                style={{ width: '100%' }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                数值越大优先级越高，相同渠道和聊天 ID 时优先匹配高优先级绑定。
              </Text>
            </div>

            {/* Enabled */}
            <div className="studio-form-field">
              <Text type="secondary">启用状态</Text>
              <Switch
                checked={form.enabled}
                onChange={(checked) => updateForm('enabled', checked)}
                checkedChildren="启用"
                unCheckedChildren="禁用"
              />
            </div>
          </div>

          {/* Actions */}
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {currentBinding && (
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={deleting}
                onClick={handleDelete}
                data-testid={testIds.channelBindings.delete}
              >
                删除
              </Button>
            )}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={handleSave}
              data-testid={testIds.channelBindings.save}
            >
              {isNewMode ? '创建' : '保存'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
