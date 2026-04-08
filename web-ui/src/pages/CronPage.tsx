import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import { formatDateTimeZh } from '../locale'
import MetricCard from '../components/console/MetricCard'
import SectionCard from '../components/console/SectionCard'
import type { CronJob, CronJobInput, CronStatus } from '../types'
import { useToast } from '../toast'

const { Text } = Typography
const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

type CronFilter = 'all' | 'enabled' | 'disabled'

type CronFormValues = {
  name: string
  enabled: boolean
  triggerType: 'at' | 'every' | 'cron'
  cronMinute: string
  cronHour: string
  cronDay: string
  cronMonth: string
  cronWeekday: string
  triggerDateLocal?: string
  triggerIntervalSeconds?: number
  triggerTz?: string
  payloadMessage: string
  payloadDeliver: boolean
  payloadChannel?: string
  payloadTo?: string
  deleteAfterRun: boolean
}

const defaultCronParts = {
  cronMinute: '0',
  cronHour: '9',
  cronDay: '*',
  cronMonth: '*',
  cronWeekday: '*',
}

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

function getSchedulePreview(job: CronJob) {
  if (job.trigger.type === 'cron') {
    return job.trigger.cronExpr || '--'
  }
  if (job.trigger.type === 'every') {
    return `interval=${job.trigger.intervalSeconds ?? 0}s`
  }
  return `at=${formatDateTime(job.trigger.dateMs)}`
}

function parseCronParts(expr?: string | null) {
  const parts = String(expr || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 5) {
    return {
      cronMinute: parts[0],
      cronHour: parts[1],
      cronDay: parts[2],
      cronMonth: parts[3],
      cronWeekday: parts[4],
    }
  }
  return defaultCronParts
}

function buildCronExpr(values: Pick<CronFormValues, 'cronMinute' | 'cronHour' | 'cronDay' | 'cronMonth' | 'cronWeekday'>) {
  return [
    values.cronMinute || '*',
    values.cronHour || '*',
    values.cronDay || '*',
    values.cronMonth || '*',
    values.cronWeekday || '*',
  ].join(' ')
}

export default function CronPage() {
  const message = useToast()
  const [form] = Form.useForm<CronFormValues>()
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
      const haystack = `${job.name} ${job.payload.message} ${job.trigger.cronExpr || ''}`.toLowerCase()
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
      name: '',
      enabled: true,
      triggerType: 'cron',
      ...defaultCronParts,
      triggerTz: defaultTimezone,
      payloadMessage: '',
      payloadDeliver: false,
      payloadChannel: '',
      payloadTo: '',
      deleteAfterRun: false,
    })
    setModalOpen(true)
  }

  function openEditModal(job: CronJob) {
    setEditingJob(job)
    form.setFieldsValue({
      name: job.name,
      enabled: job.enabled,
      triggerType: job.trigger.type,
      ...parseCronParts(job.trigger.cronExpr),
      triggerDateLocal: toLocalInputValue(job.trigger.dateMs),
      triggerIntervalSeconds: job.trigger.intervalSeconds ?? 3600,
      triggerTz: job.trigger.tz || defaultTimezone,
      payloadMessage: job.payload.message,
      payloadDeliver: job.payload.deliver,
      payloadChannel: job.payload.channel || '',
      payloadTo: job.payload.to || '',
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
        enabled: Boolean(values.enabled),
        triggerType: values.triggerType,
        payloadKind: 'agent_turn',
        payloadMessage: String(values.payloadMessage).trim(),
        payloadDeliver: Boolean(values.payloadDeliver),
        payloadChannel: values.payloadChannel?.trim() || undefined,
        payloadTo: values.payloadTo?.trim() || undefined,
        deleteAfterRun: Boolean(values.deleteAfterRun),
      }

      if (values.triggerType === 'at') {
        payload.triggerDateMs = new Date(String(values.triggerDateLocal)).getTime()
      } else if (values.triggerType === 'every') {
        payload.triggerIntervalSeconds = Number(values.triggerIntervalSeconds)
      } else {
        payload.triggerCronExpr = buildCronExpr(values)
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
      <Flex justify="center" align="center" style={{ padding: 'var(--nb-spacing-2xl)' }}>
        <Spin />
      </Flex>
    )
  }

  return (
    <Flex vertical gap={20} style={{ padding: 'var(--nb-spacing-xs) 0' }}>
      {/* Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <MetricCard
          label="服务状态"
          value={status?.enabled ? '运行中' : '已停止'}
          icon={<CheckCircleOutlined />}
          tone={status?.enabled ? 'success' : 'warning'}
        />
        <MetricCard
          label="当前任务"
          value={filteredJobs.length}
          icon={<ClockCircleOutlined />}
          tone="primary"
        />
        <MetricCard
          label="已启用"
          value={enabledJobsCount}
          icon={<PlayCircleOutlined />}
          tone="success"
        />
        <MetricCard
          label="已暂停"
          value={pausedJobsCount}
          icon={<PauseCircleOutlined />}
          tone={pausedJobsCount > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="下一次唤醒"
          value={formatDateTime(status?.nextWakeAtMs)}
          icon={<ThunderboltOutlined />}
          tone="primary"
        />
      </div>

      {status?.deliveryMode === 'agent_only' ? (
        <Alert
          showIcon
          type="info"
          message="当前实例默认以 Agent 执行任务，投递目标会按后端兼容字段存储。"
        />
      ) : null}

      {/* Task Table */}
      <SectionCard
        title="任务列表"
        action={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              新建任务
            </Button>
          </Space>
        }
      >
        <Flex vertical gap={16} style={{ minWidth: 0 }}>
          <Flex gap={12} wrap="wrap" align="center">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索任务"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ maxWidth: 320, borderRadius: 10 }}
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
          </Flex>

          <Table
            pagination={false}
            rowKey="id"
            loading={loading}
            dataSource={filteredJobs}
            locale={{ emptyText: '暂无定时任务' }}
            scroll={{ x: 980 }}
            columns={[
              {
                title: '任务名称',
                dataIndex: 'name',
                key: 'name',
                render: (value: string, job: CronJob) => (
                  <Flex vertical gap={4}>
                    <Flex align="center" gap={8} wrap="wrap">
                      <Typography.Text strong>{value}</Typography.Text>
                      {getStatusTag(job, runningJobId === job.id)}
                    </Flex>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>{job.payload.message}</Typography.Text>
                    <Flex gap={6} wrap="wrap">
                      {job.deleteAfterRun ? <Tag>运行后删除</Tag> : null}
                      {job.payload.deliver && job.payload.channel && job.payload.to ? (
                        <Tag>{`${job.payload.channel}:${job.payload.to}`}</Tag>
                      ) : null}
                      {job.source ? <Tag>{job.source}</Tag> : null}
                    </Flex>
                  </Flex>
                ),
              },
              {
                title: '计划',
                key: 'schedule',
                render: (_: unknown, job: CronJob) => (
                  <Flex vertical gap={4}>
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>{getTriggerLabel(job)}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>{getSchedulePreview(job)}</Typography.Text>
                  </Flex>
                ),
              },
              {
                title: '下一次运行',
                key: 'nextRunAtMs',
                render: (_: unknown, job: CronJob) => (
                  <Flex vertical gap={4}>
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>{formatDateTime(job.nextRunAtMs)}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>上次运行：{formatDateTime(job.lastRunAtMs)}</Typography.Text>
                  </Flex>
                ),
              },
              {
                title: '最近结果',
                key: 'lastStatus',
                render: (_: unknown, job: CronJob) => (
                  <Flex vertical gap={4}>
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>{job.lastStatus || '待运行'}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>{job.lastError || `更新时间：${formatDateTime(job.updatedAtMs)}`}</Typography.Text>
                  </Flex>
                ),
              },
              {
                title: '操作',
                key: 'actions',
                align: 'right' as const,
                render: (_: unknown, job: CronJob) => (
                  <Space size={[8, 8]} wrap>
                    <Button
                      size="small"
                      icon={<PlayCircleOutlined />}
                      loading={runningJobId === job.id}
                      onClick={() => void handleRun(job.id)}
                    >
                      执行
                    </Button>
                    <Button
                      size="small"
                      icon={job.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                      onClick={() => void handleToggle(job)}
                    >
                      {job.enabled ? '暂停' : '启用'}
                    </Button>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(job)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title="确定删除这个定时任务吗？"
                      onConfirm={() => void handleDelete(job.id)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </Flex>
      </SectionCard>

      <Modal
        destroyOnHidden
        open={modalOpen}
        title={editingJob ? '编辑定时任务' : '新建定时任务'}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText={editingJob ? '保存更改' : '创建任务'}
        width="min(760px, calc(100vw - 24px))"
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr auto' }}>
            <Form.Item
              label="任务名称"
              name="name"
              rules={[{ required: true, message: '请输入任务名称' }]}
            >
              <Input placeholder="任务名称" />
            </Form.Item>

            <Form.Item label="启用任务" name="enabled" valuePropName="checked" initialValue>
              <Switch />
            </Form.Item>
          </div>

          <Form.Item
            label="执行指令"
            name="payloadMessage"
            rules={[{ required: true, message: '请输入要执行的指令' }]}
          >
            <Input.TextArea
              rows={5}
              aria-label="执行指令"
              placeholder="执行指令"
            />
          </Form.Item>

          <Form.Item label="触发方式" name="triggerType" initialValue="cron">
            <Segmented
              options={[
                { label: 'Cron', value: 'cron' },
                { label: '周期', value: 'every' },
                { label: '单次', value: 'at' },
              ]}
            />
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
                <Flex vertical gap={16} style={{ minWidth: 0 }}>
                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    <Form.Item
                      label="分钟"
                      name="cronMinute"
                      rules={[{ required: true, message: '请输入分钟字段' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="0" style={{ textAlign: 'center' }} />
                    </Form.Item>
                    <Form.Item
                      label="小时"
                      name="cronHour"
                      rules={[{ required: true, message: '请输入小时字段' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="9" style={{ textAlign: 'center' }} />
                    </Form.Item>
                    <Form.Item
                      label="日期"
                      name="cronDay"
                      rules={[{ required: true, message: '请输入日期字段' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="*" style={{ textAlign: 'center' }} />
                    </Form.Item>
                    <Form.Item
                      label="月份"
                      name="cronMonth"
                      rules={[{ required: true, message: '请输入月份字段' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="*" style={{ textAlign: 'center' }} />
                    </Form.Item>
                    <Form.Item
                      label="星期"
                      name="cronWeekday"
                      rules={[{ required: true, message: '请输入星期字段' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="1-5" style={{ textAlign: 'center' }} />
                    </Form.Item>
                  </div>

                  <Form.Item label="时区" name="triggerTz" initialValue={defaultTimezone}>
                    <Input placeholder="时区" />
                  </Form.Item>

                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: 12,
                      background: 'var(--nb-card-subtle-bg)',
                      border: '1px solid var(--nb-card-subtle-border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <Text type="secondary">当前表达式</Text>
                    <code style={{ fontWeight: 'var(--nb-font-weight-strong)' }}>
                      {buildCronExpr({
                        cronMinute: getFieldValue('cronMinute') || defaultCronParts.cronMinute,
                        cronHour: getFieldValue('cronHour') || defaultCronParts.cronHour,
                        cronDay: getFieldValue('cronDay') || defaultCronParts.cronDay,
                        cronMonth: getFieldValue('cronMonth') || defaultCronParts.cronMonth,
                        cronWeekday: getFieldValue('cronWeekday') || defaultCronParts.cronWeekday,
                      })}
                    </code>
                  </div>
                </Flex>
              )
            }}
          </Form.Item>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', marginTop: 16 }}>
            <Form.Item label="执行后删除" name="deleteAfterRun" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item
              label="记录投递目标"
              name="payloadDeliver"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </div>

          <Form.Item
            noStyle
            shouldUpdate={(prev, next) => prev.payloadDeliver !== next.payloadDeliver}
          >
            {({ getFieldValue }) =>
              getFieldValue('payloadDeliver') ? (
                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
                  <Form.Item label="频道" name="payloadChannel">
                    <Input placeholder="频道" />
                  </Form.Item>
                  <Form.Item label="目标" name="payloadTo">
                    <Input placeholder="目标" />
                  </Form.Item>
                </div>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  )
}
