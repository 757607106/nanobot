import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
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
  Table,
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
import DevOnly from '../../components/DevOnly'
import { testIds } from '../../testIds'
import type {
  AgentDefinition,
  ChannelBinding,
  ChannelBindingMutationInput,
  ChannelStateItem,
} from '../../types'

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
  const { message } = App.useApp()
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

  const columns = [
    {
      title: '渠道',
      dataIndex: 'channelName',
      key: 'channelName',
      render: (name: string, record: ChannelBinding) => (
        <Space>
          <LinkOutlined />
          <span>{name}</span>
          {record.channelChatId !== '*' && (
            <Typography.Text type="secondary">({record.channelChatId})</Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '目标员工',
      dataIndex: 'targetId',
      key: 'targetId',
      render: (_: string, record: ChannelBinding) => resolveTargetName(record),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled: boolean) => <Tag color={enabled ? 'success' : 'default'}>{enabled ? '启用' : '禁用'}</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      render: (priority: number) => (priority > 0 ? priority : '-'),
    },
  ]

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 400 }}>
        <Spin size="large" />
      </Flex>
    )
  }

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" gap={12} wrap="wrap">
        <Space>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索绑定"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 200 }}
          />
          <Switch
            checked={showEnabledOnly}
            onChange={setShowEnabledOnly}
            checkedChildren="已启用"
            unCheckedChildren="全部"
          />
        </Space>
        <Space>
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
      </Flex>

      <Flex gap={16} style={{ minHeight: 500 }}>
        <Card style={{ width: 400 }} styles={{ body: { padding: 0 } }}>
          <Table
            dataSource={filteredBindings}
            columns={columns}
            rowKey="bindingId"
            size="small"
            pagination={false}
            scroll={{ y: 450 }}
            onRow={(record) => ({
              onClick: () => navigate(`/channels/bindings/${record.bindingId}`),
              style: {
                cursor: 'pointer',
                background: record.bindingId === params.bindingId ? 'var(--nb-accent-soft)' : undefined,
              },
            })}
            locale={{ emptyText: <Empty description="暂无绑定" /> }}
          />
        </Card>

        <Card style={{ flex: 1 }} styles={{ body: { padding: 16 } }}>
          <Flex vertical gap={16}>
            <Flex justify="space-between" align="center">
              <Typography.Title level={5} style={{ margin: 0 }}>
                {currentBinding ? '编辑绑定' : '新建绑定'}
              </Typography.Title>
              {currentBinding && <Tag color="purple">{currentBinding.bindingId}</Tag>}
            </Flex>

            <Space wrap>
              <Tag>{formState.channelName || '未选渠道'}</Tag>
              <Tag>{formState.channelChatId || '*'}</Tag>
              <Tag color={formState.enabled ? 'success' : 'default'}>
                {formState.enabled ? '启用' : '禁用'}
              </Tag>
              {formState.targetId && (
                <Tag color="processing">
                  {targetOptions.find((t) => t.value === formState.targetId)?.label || formState.targetId}
                </Tag>
              )}
              {currentBindingMissingTarget && <Tag color="warning">请重新选择员工</Tag>}
            </Space>

            <Form form={form} layout="vertical">
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
                  placeholder="聊天 ID / 目标"
                  onChange={(e) => setFormState((s) => ({ ...s, channelChatId: e.target.value }))}
                />
              </Form.Item>

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

              <Form.Item label="启用状态">
                <Switch
                  checked={formState.enabled}
                  onChange={(checked) => setFormState((s) => ({ ...s, enabled: checked }))}
                  checkedChildren="启用"
                  unCheckedChildren="禁用"
                />
              </Form.Item>
            </Form>

            <Flex gap={8}>
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
            </Flex>
          </Flex>
        </Card>
      </Flex>
    </Flex>
  )
}
