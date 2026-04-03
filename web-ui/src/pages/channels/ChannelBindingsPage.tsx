import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
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
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api'
import PageHeader from '../../components/console/PageHeader'
import MetricCard from '../../components/console/MetricCard'
import SectionCard from '../../components/console/SectionCard'
import DevOnly from '../../components/DevOnly'
import { testIds } from '../../testIds'
import type {
  AgentDefinition,
  ChannelBinding,
  ChannelBindingMutationInput,
  ChannelStateItem,
} from '../../types'
import { ChannelAvatar } from './shared'
import { useToast } from '../../toast'

interface BindingFormState {
  channelName: string
  channelChatId: string
  targetType: 'agent'
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

function bindingToForm(b: ChannelBinding, agents: AgentDefinition[]): BindingFormState {
  const hasMatchingAgent = agents.some((agent) => agent.agentId === b.targetId)
  return {
    channelName: b.channelName,
    channelChatId: b.channelChatId,
    targetType: 'agent',
    targetId: hasMatchingAgent ? b.targetId : '',
    priority: b.priority,
    enabled: b.enabled,
  }
}

function toPayload(form: BindingFormState): ChannelBindingMutationInput {
  return {
    channelName: form.channelName,
    channelChatId: form.channelChatId || '*',
    targetType: 'agent',
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

export default function ChannelBindingsPage() {
  const message = useToast()
  const navigate = useNavigate()
  const params = useParams<{ bindingId: string }>()
  const [form] = Form.useForm()
  const isNewMode = !params.bindingId

  const [bindings, setBindings] = useState<ChannelBinding[]>([])
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [channels, setChannels] = useState<ChannelStateItem[]>([])
  const [currentBinding, setCurrentBinding] = useState<ChannelBinding | null>(null)

  const [formState, setFormState] = useState<BindingFormState>(createEmptyForm())
  const [searchQuery, setSearchQuery] = useState('')
  const [showEnabledOnly, setShowEnabledOnly] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const targetOptions = useMemo(
    () => agents.map((a) => ({ value: a.agentId, label: a.name })),
    [agents],
  )

  const channelOptions = useMemo(
    () => channels.map((ch) => ({ value: ch.name, label: ch.name })),
    [channels],
  )

  const filteredBindings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return bindings.filter((binding) => {
      if (showEnabledOnly && !binding.enabled) return false
      if (!query) return true
      const agent = agents.find((a) => a.agentId === binding.targetId)
      return [binding.channelName, binding.channelChatId, binding.targetId, agent?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query))
    })
  }, [bindings, showEnabledOnly, searchQuery, agents])

  function resolveTargetName(binding: ChannelBinding): string {
    const agent = agents.find((a) => a.agentId === binding.targetId)
    return agent?.name || binding.targetId
  }

  async function loadWorkspace() {
    setLoading(true)
    try {
      const [bindingsData, agentsData, channelsData] = await Promise.all([
        api.getChannelBindings(),
        api.getAgents(),
        api.getChannels(),
      ])
      setBindings(bindingsData)
      setAgents(agentsData)
      setChannels(channelsData.items || [])
    } catch (err) {
      message.error(getErrorMessage(err, '加载数据失败'))
    } finally {
      setLoading(false)
    }
  }

  async function loadBindingDetail(id: string) {
    try {
      const detail = await api.getChannelBinding(id)
      setCurrentBinding(detail)
      setFormState(bindingToForm(detail, agents))
    } catch {
      setCurrentBinding(null)
      setFormState(createEmptyForm())
    }
  }

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (params.bindingId) {
      const found = bindings.find((b) => b.bindingId === params.bindingId)
      if (found) {
        setCurrentBinding(found)
        setFormState(bindingToForm(found, agents))
      } else if (!loading) {
        void loadBindingDetail(params.bindingId)
      }
    } else {
      setCurrentBinding(null)
      setFormState(createEmptyForm())
    }
  }, [params.bindingId, bindings, agents, loading])

  const currentBindingMissingTarget = Boolean(
    currentBinding && !agents.some((agent) => agent.agentId === currentBinding.targetId),
  )

  const enabledBindingCount = useMemo(
    () => bindings.filter((binding) => binding.enabled).length,
    [bindings],
  )

  const wildcardBindingCount = useMemo(
    () => bindings.filter((binding) => (binding.channelChatId || '*').trim() === '*').length,
    [bindings],
  )

  const boundChannelCount = useMemo(
    () => new Set(bindings.map((binding) => binding.channelName)).size,
    [bindings],
  )

  const selectedTargetLabel = useMemo(
    () => targetOptions.find((target) => target.value === formState.targetId)?.label || formState.targetId || '待选择',
    [formState.targetId, targetOptions],
  )

  async function handleSave() {
    if (!formState.channelName.trim()) {
      message.warning('请选择渠道')
      return
    }
    if (!formState.targetId.trim()) {
      message.warning('请选择目标员工')
      return
    }
    setSaving(true)
    try {
      const payload = toPayload(formState)
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
      content: `确定要删除此绑定吗？（${currentBinding.channelName} → ${resolveTargetName(currentBinding)}）`,
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

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 400 }}>
        <Spin size="large" />
      </Flex>
    )
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="消息路由"
        actions={(
          <Space wrap size={[8, 8]}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/channels/bindings/new')}
            >
              新建绑定
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadWorkspace()}>
              刷新
            </Button>
          </Space>
        )}
      />

      <div className="console-metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <MetricCard label="路由总数" value={bindings.length} icon={<LinkOutlined />} tone="neutral" />
        <MetricCard label="启用规则" value={enabledBindingCount} icon={<SaveOutlined />} tone="success" />
        <MetricCard label="覆盖渠道" value={boundChannelCount} icon={<SearchOutlined />} tone="primary" />
        <MetricCard label="通配规则" value={wildcardBindingCount} icon={<PlusOutlined />} tone="warning" />
      </div>

      <Flex gap={16} align="stretch" style={{ minHeight: 560 }}>
        <div style={{ width: 380, flexShrink: 0 }}>
          <SectionCard
            title="绑定目录"
            action={<span className="console-inline-code">{filteredBindings.length} rules</span>}
          >
            <Flex vertical gap={14}>
              <Flex gap={12} wrap="wrap">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索渠道、会话或员工"
                  prefix={<SearchOutlined />}
                  allowClear
                  style={{ flex: '1 1 220px' }}
                />
                <Switch
                  checked={showEnabledOnly}
                  onChange={setShowEnabledOnly}
                  checkedChildren="已启用"
                  unCheckedChildren="全部"
                />
              </Flex>

              {filteredBindings.length === 0 ? (
                <div className="workspace-empty-state">
                  <Empty
                    image={false} className="minimal-empty"
                    description={searchQuery || showEnabledOnly ? '无匹配项' : '暂无数据'}
                  >
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/channels/bindings/new')}>
                      创建第一条绑定
                    </Button>
                  </Empty>
                </div>
              ) : (
                <div className="resource-rail-list">
                  {filteredBindings.map((binding) => {
                    const active = binding.bindingId === params.bindingId
                    return (
                      <div
                        key={binding.bindingId}
                        role="button"
                        tabIndex={0}
                        className={`resource-rail-item ${active ? 'is-selected' : ''}`}
                        onClick={() => navigate(`/channels/bindings/${binding.bindingId}`)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            navigate(`/channels/bindings/${binding.bindingId}`)
                          }
                        }}
                      >
                        <Flex justify="space-between" align="flex-start" gap={12}>
                          <Flex gap={12} style={{ minWidth: 0, flex: 1 }}>
                            <ChannelAvatar channelName={binding.channelName} label={binding.channelName} />
                            <Flex vertical gap={6} style={{ minWidth: 0, flex: 1 }}>
                              <Typography.Text strong className="resource-rail-item-title">
                                {binding.channelName}
                              </Typography.Text>
                              <Typography.Text type="secondary" className="resource-rail-item-subtitle">
                                {binding.channelChatId === '*' ? '命中全部会话' : `会话 ${binding.channelChatId}`}
                              </Typography.Text>
                              <Typography.Paragraph type="secondary" className="resource-rail-item-description">
                                派发到 {resolveTargetName(binding)}
                              </Typography.Paragraph>
                              <div className="resource-rail-meta">
                                <Tag color={binding.enabled ? 'success' : 'default'}>
                                  {binding.enabled ? '启用' : '禁用'}
                                </Tag>
                                {binding.priority > 0 ? <Tag>优先级 {binding.priority}</Tag> : null}
                              </div>
                            </Flex>
                          </Flex>
                          <LinkOutlined style={{ color: 'var(--nb-text-quaternary)' }} />
                        </Flex>
                      </div>
                    )
                  })}
                </div>
              )}
            </Flex>
          </SectionCard>
        </div>

        <Flex vertical gap={16} style={{ flex: 1, minWidth: 0 }}>
          <SectionCard
            title={currentBinding ? '规则详情' : '新建规则'}
            action={currentBinding ? <Tag color="purple">{currentBinding.bindingId}</Tag> : null}
          >
            <div className="resource-summary-strip">
              <div className="resource-summary-tile">
                <span className="resource-summary-label">来源渠道</span>
                <span className="resource-summary-value" style={{ fontSize: 'var(--nb-text-lg)' }}>{formState.channelName || '待选择'}</span>
              </div>
              <div className="resource-summary-tile">
                <span className="resource-summary-label">命中会话</span>
                <span className="resource-summary-value" style={{ fontSize: 'var(--nb-text-lg)' }}>
                  {formState.channelChatId?.trim() ? formState.channelChatId : '*'}
                </span>
              </div>
              <div className="resource-summary-tile">
                <span className="resource-summary-label">派发目标</span>
                <span className="resource-summary-value" style={{ fontSize: 'var(--nb-text-lg)' }}>{selectedTargetLabel}</span>
              </div>
              <div className="resource-summary-tile">
                <span className="resource-summary-label">规则状态</span>
                <span className="resource-summary-value" style={{ fontSize: 'var(--nb-text-lg)' }}>{formState.enabled ? '启用' : '禁用'}</span>
              </div>
            </div>

            {currentBindingMissingTarget ? <Alert type="warning" showIcon message="目标员工不存在" /> : null}
          </SectionCard>

          <Form form={form} layout="vertical" requiredMark={false} component={false}>
            <Flex vertical gap={16}>
              <SectionCard
                title="命中条件"
              >
                <div className="console-modal-grid">
                  <Form.Item label="渠道名称" required>
                    <Select
                      showSearch
                      value={formState.channelName || undefined}
                      placeholder="选择渠道"
                      options={channelOptions}
                      onChange={(val) => setFormState((s) => ({ ...s, channelName: val }))}
                      allowClear
                    />
                  </Form.Item>

                  <Form.Item label="聊天 ID">
                    <Input
                      value={formState.channelChatId}
                      placeholder="留空或 * 表示匹配全部会话"
                      onChange={(e) => setFormState((s) => ({ ...s, channelChatId: e.target.value }))}
                    />
                  </Form.Item>
                </div>
              </SectionCard>

              <SectionCard
                title="派发目标"
                action={(
                  <Switch
                    checked={formState.enabled}
                    onChange={(checked) => setFormState((s) => ({ ...s, enabled: checked }))}
                    checkedChildren="启用"
                    unCheckedChildren="禁用"
                  />
                )}
              >
                <div className="console-modal-grid">
                  <Form.Item label="目标员工" required>
                    <Select
                      showSearch
                      value={formState.targetId || undefined}
                      placeholder="选择员工"
                      options={targetOptions}
                      onChange={(val) => setFormState((s) => ({ ...s, targetId: val }))}
                      optionFilterProp="label"
                      allowClear
                    />
                  </Form.Item>

                  <DevOnly>
                    <Form.Item label="优先级">
                      <InputNumber
                        value={formState.priority}
                        min={0}
                        onChange={(val) => setFormState((s) => ({ ...s, priority: val ?? 0 }))}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </DevOnly>
                </div>
              </SectionCard>
            </Flex>
          </Form>

          <SectionCard
            title="操作"
            action={(
              <Space wrap size={[8, 8]}>
                {currentBinding ? (
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    loading={deleting}
                    onClick={handleDelete}
                    data-testid={testIds.channelBindings.delete}
                  >
                    删除
                  </Button>
                ) : null}
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={handleSave}
                  data-testid={testIds.channelBindings.save}
                >
                  {isNewMode ? '创建' : '保存'}
                </Button>
              </Space>
            )}
          />
        </Flex>
      </Flex>
    </div>
  )
}
