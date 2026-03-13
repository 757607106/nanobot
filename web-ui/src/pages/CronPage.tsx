import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Segmented,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type { CronJob, CronJobInput, CronStatus } from '../types'

const { Title, Text } = Typography
const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

type CronFilter = 'all' | 'enabled' | 'disabled'

function formatDateTime(value?: number | null) {
  if (!value) {
    return '--'
  }
  return formatDateTimeZh(value)
}

function toLocalInputValue(value?: number | null) {
  if (!value) {
    return undefined
  }
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getTriggerLabel(job: CronJob) {
  if (job.trigger.type === 'at') {
    return `在 ${formatDateTime(job.trigger.dateMs)} 执行`
  }
  if (job.trigger.type === 'every') {
    const seconds = job.trigger.intervalSeconds ?? 0
    if (seconds % 3600 === 0 && seconds >= 3600) {
      return `每 ${seconds / 3600} 小时执行`
    }
    if (seconds % 60 === 0 && seconds >= 60) {
      return `每 ${seconds / 60} 分钟执行`
    }
    return `每 ${seconds} 秒执行`
  }
  return `Cron ${job.trigger.cronExpr}${job.trigger.tz ? `（${job.trigger.tz}）` : ''}`
}

function getStatusTag(job: CronJob, running: boolean) {
  if (running) {
    return <Tag color="processing">运行中</Tag>
  }
  if (!job.enabled) {
    return <Tag>已暂停</Tag>
  }
  if (job.lastStatus === 'ok') {
    return <Tag color="success">正常</Tag>
  }
  if (job.lastStatus === 'error') {
    return <Tag color="error">异常</Tag>
  }
  return <Tag color="cyan">已调度</Tag>
}

export default function CronPage() {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [status, setStatus] = useState<CronStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)
  const [runningJobId, setRunningJobId] = useState<string | null>(null)
  const [filter, setFilter] = useState<CronFilter>('all')
  const [query, setQuery] = useState('')

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (job.source === 'calendar') {
        return false
      }
      if (filter === 'enabled' && !job.enabled) {
        return false
      }
      if (filter === 'disabled' && job.enabled) {
        return false
      }
      if (!query.trim()) {
        return true
      }
      const haystack = `${job.name} ${job.payload.message}`.toLowerCase()
      return haystack.includes(query.trim().toLowerCase())
    })
  }, [filter, jobs, query])

  const enabledJobsCount = useMemo(
    () => filteredJobs.filter((job) => job.enabled).length,
    [filteredJobs],
  )

  const pausedJobsCount = useMemo(
    () => filteredJobs.filter((job) => !job.enabled).length,
    [filteredJobs],
  )

  useEffect(() => {
    void loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const [nextStatus, nextJobs] = await Promise.all([
        api.getCronStatus(),
        api.getCronJobs(true),
      ])
      setStatus(nextStatus)
      setJobs(nextJobs.jobs)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载定时任务失败')
    } finally {
      setLoading(false)
    }
  }

  function openCreateModal() {
    setEditingJob(null)
    form.resetFields()
    form.setFieldsValue({
      triggerType: 'cron',
      triggerCronExpr: '0 9 * * *',
      triggerTz: defaultTimezone,
      payloadDeliver: false,
      deleteAfterRun: false,
    })
    setModalOpen(true)
  }

  function openEditModal(job: CronJob) {
    setEditingJob(job)
    form.setFieldsValue({
      name: job.name,
      triggerType: job.trigger.type,
      triggerDateLocal: toLocalInputValue(job.trigger.dateMs),
      triggerIntervalSeconds: job.trigger.intervalSeconds,
      triggerCronExpr: job.trigger.cronExpr,
      triggerTz: job.trigger.tz || defaultTimezone,
      payloadMessage: job.payload.message,
      payloadDeliver: job.payload.deliver,
      payloadChannel: job.payload.channel,
      payloadTo: job.payload.to,
      deleteAfterRun: job.deleteAfterRun,
    })
    setModalOpen(true)
  }

  async function handleToggle(job: CronJob) {
    try {
      await api.updateCronJob(job.id, { enabled: !job.enabled })
      message.success(job.enabled ? '任务已暂停' : '任务已启用')
      await loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新任务失败')
    }
  }

  async function handleDelete(jobId: string) {
    try {
      await api.deleteCronJob(jobId)
      message.success('任务已删除')
      await loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除任务失败')
    }
  }

  async function handleRun(jobId: string) {
    try {
      setRunningJobId(jobId)
      await api.runCronJob(jobId)
      message.success('任务已触发')
      await loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '执行任务失败')
    } finally {
      setRunningJobId(null)
    }
  }

  async function handleSave() {
    try {
      const values = await form.validateFields()
      setSaving(true)

      const payload: CronJobInput = {
        name: String(values.name).trim(),
        triggerType: values.triggerType,
        payloadKind: 'agent_turn',
        payloadMessage: String(values.payloadMessage).trim(),
        payloadDeliver: Boolean(values.payloadDeliver),
        payloadChannel: values.payloadChannel?.trim() || undefined,
        payloadTo: values.payloadTo?.trim() || undefined,
        deleteAfterRun: Boolean(values.deleteAfterRun),
      }

      if (values.triggerType === 'at') {
        payload.triggerDateMs = new Date(values.triggerDateLocal).getTime()
      } else if (values.triggerType === 'every') {
        payload.triggerIntervalSeconds = Number(values.triggerIntervalSeconds)
      } else {
        payload.triggerCronExpr = String(values.triggerCronExpr).trim()
        payload.triggerTz = values.triggerTz?.trim() || undefined
      }

      if (editingJob) {
        await api.updateCronJob(editingJob.id, payload)
        message.success('任务已更新')
      } else {
        await api.createCronJob(payload)
        message.success('任务已创建')
      }

      setModalOpen(false)
      await loadData()
    } catch (error) {
      if (error instanceof Error && error.message) {
        message.error(error.message)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading && !status) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="定时任务"
        title="自动化任务"
        description="直接连接项目 cron 服务，用来安排固定节奏的总结、检查、同步和提醒。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新建任务
            </Button>
          </Space>
        )}
        stats={[
          { label: '当前任务', value: filteredJobs.length },
          { label: '启用中', value: enabledJobsCount },
          { label: '已暂停', value: pausedJobsCount },
          { label: '下一次唤醒', value: formatDateTime(status?.nextWakeAtMs) },
        ]}
      />

      <div className="page-card">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="section-heading-row">
            <div className="page-section-title">
              <Title level={4}>任务工作区</Title>
              <Text type="secondary">筛选、查看和管理当前 Web 后端可执行的定时任务。</Text>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新建任务
            </Button>
          </div>

          {status?.deliveryMode === 'agent_only' && (
          <Alert
            showIcon
            type="info"
            message="当前 Web UI 仅通过 Agent 执行定时任务。"
            description="投递目标字段仅保留兼容，不会顺带启动 gateway 频道。"
          />
          )}

          <div className="page-meta-grid">
            <div className="page-meta-card">
              <span>服务状态</span>
              <strong>{status?.enabled ? '运行中' : '已停止'}</strong>
            </div>
            <div className="page-meta-card">
              <span>投递模式</span>
              <strong>{status?.deliveryMode === 'agent_only' ? '仅 Agent 执行' : status?.deliveryMode ?? '--'}</strong>
            </div>
            <div className="page-meta-card">
              <span>下一次唤醒</span>
              <strong>{formatDateTime(status?.nextWakeAtMs)}</strong>
            </div>
            <div className="page-meta-card">
              <span>当前筛选</span>
              <strong>{filter === 'all' ? '全部任务' : filter === 'enabled' ? '仅已启用' : '仅已暂停'}</strong>
            </div>
          </div>

          <div className="toolbar-row">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="按任务名称或指令搜索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Segmented<CronFilter>
              value={filter}
              options={[
                { label: '全部', value: 'all' },
                { label: '已启用', value: 'enabled' },
                { label: '已暂停', value: 'disabled' },
              ]}
              onChange={(value) => setFilter(value)}
            />
          </div>

          <div className="page-scroll-shell cron-list-shell">
            {loading ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : filteredJobs.length === 0 ? (
              <Empty
                description="暂无定时任务"
                className="empty-block cron-empty-state"
              />
            ) : (
              <List
                grid={{ gutter: 16, xs: 1, md: 2 }}
                dataSource={filteredJobs}
                renderItem={(job) => (
                  <List.Item>
                    <Card className="cron-job-card">
                      <Flex vertical gap={14}>
                        <Flex justify="space-between" align="flex-start" gap={16}>
                          <div className="page-section-title">
                            <Space wrap size={[8, 8]}>
                              <Title level={4} style={{ margin: 0 }}>
                                {job.name}
                              </Title>
                              {getStatusTag(job, runningJobId === job.id)}
                            </Space>
                            <Text type="secondary">{getTriggerLabel(job)}</Text>
                          </div>
                          <Tag>{job.id}</Tag>
                        </Flex>

                        <div className="page-meta-grid cron-summary-grid">
                          <div className="page-meta-card">
                            <span>下一次运行</span>
                            <strong>{formatDateTime(job.nextRunAtMs)}</strong>
                          </div>
                          <div className="page-meta-card">
                            <span>上一次运行</span>
                            <strong>{formatDateTime(job.lastRunAtMs)}</strong>
                          </div>
                          <div className="page-meta-card">
                            <span>运行后删除</span>
                            <strong>{job.deleteAfterRun ? '是' : '否'}</strong>
                          </div>
                          <div className="page-meta-card">
                            <span>投递目标</span>
                            <strong>
                              {job.payload.channel && job.payload.to
                                ? `${job.payload.channel}:${job.payload.to}`
                                : '仅 Agent 执行'}
                            </strong>
                          </div>
                        </div>

                        <div>
                          <Text type="secondary">调度指令</Text>
                          <div className="cron-message-block">{job.payload.message}</div>
                        </div>

                        {job.lastError && <Alert showIcon type="error" message={job.lastError} />}

                        <div className="cron-action-row">
                          <Button
                            icon={<PlayCircleOutlined />}
                            loading={runningJobId === job.id}
                            onClick={() => void handleRun(job.id)}
                          >
                            立即执行
                          </Button>
                          <Button
                            icon={job.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                            onClick={() => void handleToggle(job)}
                          >
                            {job.enabled ? '暂停' : '启用'}
                          </Button>
                          <Button icon={<EditOutlined />} onClick={() => openEditModal(job)}>
                            编辑
                          </Button>
                          <Popconfirm
                            title="确定删除这个定时任务吗？"
                            onConfirm={() => void handleDelete(job.id)}
                          >
                            <Button danger icon={<DeleteOutlined />}>
                              删除
                            </Button>
                          </Popconfirm>
                        </div>
                      </Flex>
                    </Card>
                  </List.Item>
                )}
              />
            )}
          </div>
        </Space>
      </div>

      <Modal
        destroyOnClose
        open={modalOpen}
        title={editingJob ? '编辑定时任务' : '新建定时任务'}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText={editingJob ? '保存更改' : '创建任务'}
        width={760}
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                label="任务名称"
                name="name"
                rules={[{ required: true, message: '请输入任务名称' }]}
              >
                <Input maxLength={80} placeholder="例如：早晨工作区总结" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="执行后删除" name="deleteAfterRun" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label="执行指令"
            name="payloadMessage"
            rules={[{ required: true, message: '请输入要执行的指令' }]}
          >
            <Input.TextArea
              rows={5}
              placeholder="例如：总结最近的工作区变化，并给出下一步建议。"
            />
          </Form.Item>

          <Form.Item label="触发类型" name="triggerType" initialValue="cron">
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="cron">Cron</Radio.Button>
              <Radio.Button value="every">周期</Radio.Button>
              <Radio.Button value="at">单次</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, next) => prev.triggerType !== next.triggerType}>
            {({ getFieldValue }) => {
              const triggerType = getFieldValue('triggerType')

              if (triggerType === 'every') {
                return (
                  <Form.Item
                    label="间隔（秒）"
                    name="triggerIntervalSeconds"
                    rules={[{ required: true, message: '请输入间隔秒数' }]}
                  >
                    <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                )
              }

              if (triggerType === 'at') {
                return (
                  <Form.Item
                    label="执行时间"
                    name="triggerDateLocal"
                    rules={[{ required: true, message: '请选择执行时间' }]}
                  >
                    <Input type="datetime-local" />
                  </Form.Item>
                )
              }

              return (
                <Row gutter={16}>
                  <Col xs={24} md={14}>
                    <Form.Item
                      label="Cron 表达式"
                      name="triggerCronExpr"
                      rules={[{ required: true, message: '请输入 Cron 表达式' }]}
                    >
                      <Input placeholder="0 9 * * 1-5" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item label="时区" name="triggerTz" initialValue={defaultTimezone}>
                      <Input placeholder="Asia/Shanghai" />
                    </Form.Item>
                  </Col>
                </Row>
              )
            }}
          </Form.Item>

          <Form.Item
            label="记录投递目标"
            name="payloadDeliver"
            valuePropName="checked"
            extra="这是为兼容参考项目保留的可选字段，Web UI 模式不会自动启动 gateway 频道。"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, next) => prev.payloadDeliver !== next.payloadDeliver}
          >
            {({ getFieldValue }) =>
              getFieldValue('payloadDeliver') ? (
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item label="频道" name="payloadChannel">
                      <Input placeholder="例如：web" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="目标" name="payloadTo">
                      <Input placeholder="session id 或 chat id" />
                    </Form.Item>
                  </Col>
                </Row>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
