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
  Statistic,
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
import type { CronJob, CronJobInput, CronStatus } from '../types'

const { Title, Text } = Typography
const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

type CronFilter = 'all' | 'enabled' | 'disabled'

function formatDateTime(value?: number | null) {
  if (!value) {
    return '--'
  }
  return new Date(value).toLocaleString()
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
    return `At ${formatDateTime(job.trigger.dateMs)}`
  }
  if (job.trigger.type === 'every') {
    const seconds = job.trigger.intervalSeconds ?? 0
    if (seconds % 3600 === 0 && seconds >= 3600) {
      return `Every ${seconds / 3600}h`
    }
    if (seconds % 60 === 0 && seconds >= 60) {
      return `Every ${seconds / 60}m`
    }
    return `Every ${seconds}s`
  }
  return `Cron ${job.trigger.cronExpr}${job.trigger.tz ? ` (${job.trigger.tz})` : ''}`
}

function getStatusTag(job: CronJob, running: boolean) {
  if (running) {
    return <Tag color="processing">Running</Tag>
  }
  if (!job.enabled) {
    return <Tag>Paused</Tag>
  }
  if (job.lastStatus === 'ok') {
    return <Tag color="success">Healthy</Tag>
  }
  if (job.lastStatus === 'error') {
    return <Tag color="error">Error</Tag>
  }
  return <Tag color="cyan">Scheduled</Tag>
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
      message.error(error instanceof Error ? error.message : 'Failed to load cron jobs')
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
      message.success(job.enabled ? 'Job paused' : 'Job enabled')
      await loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to update job')
    }
  }

  async function handleDelete(jobId: string) {
    try {
      await api.deleteCronJob(jobId)
      message.success('Job deleted')
      await loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to delete job')
    }
  }

  async function handleRun(jobId: string) {
    try {
      setRunningJobId(jobId)
      await api.runCronJob(jobId)
      message.success('Job triggered')
      await loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to run job')
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
        message.success('Job updated')
      } else {
        await api.createCronJob(payload)
        message.success('Job created')
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
    <div className="page-card">
      <div className="page-header-block">
        <div>
          <Title level={2}>Cron</Title>
          <Text type="secondary">
            Schedule direct agent turns with the backend cron service used by the current project.
          </Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            New Job
          </Button>
        </Space>
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {status?.deliveryMode === 'agent_only' && (
          <Alert
            showIcon
            type="info"
            message="Web UI mode runs scheduled jobs through the agent only."
            description="Delivery channel targets are stored for compatibility, but gateway channels are not started from this page."
          />
        )}

        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="Service" value={status?.enabled ? 'Running' : 'Stopped'} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="Jobs" value={filteredJobs.length} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="Next Wake" value={formatDateTime(status?.nextWakeAtMs)} />
            </Card>
          </Col>
        </Row>

        <div className="toolbar-row">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search jobs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Segmented<CronFilter>
            value={filter}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Enabled', value: 'enabled' },
              { label: 'Paused', value: 'disabled' },
            ]}
            onChange={(value) => setFilter(value)}
          />
        </div>

        {loading ? (
          <div className="center-box">
            <Spin />
          </div>
        ) : filteredJobs.length === 0 ? (
          <Empty
            description="No cron jobs yet. Create one to schedule a future agent turn."
            className="empty-block"
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
                      <div>
                        <Space wrap size={[8, 8]}>
                          <Title level={4} style={{ margin: 0 }}>
                            {job.name}
                          </Title>
                          {getStatusTag(job, runningJobId === job.id)}
                        </Space>
                        <Text type="secondary">{getTriggerLabel(job)}</Text>
                      </div>
                      <Tag color="geekblue">{job.id}</Tag>
                    </Flex>

                    <div className="cron-meta-grid">
                      <div>
                        <Text type="secondary">Next Run</Text>
                        <div className="mono-block">{formatDateTime(job.nextRunAtMs)}</div>
                      </div>
                      <div>
                        <Text type="secondary">Last Run</Text>
                        <div className="mono-block">{formatDateTime(job.lastRunAtMs)}</div>
                      </div>
                      <div>
                        <Text type="secondary">Delete After Run</Text>
                        <div className="mono-block">{job.deleteAfterRun ? 'Yes' : 'No'}</div>
                      </div>
                      <div>
                        <Text type="secondary">Delivery Target</Text>
                        <div className="mono-block">
                          {job.payload.channel && job.payload.to
                            ? `${job.payload.channel}:${job.payload.to}`
                            : 'Agent only'}
                        </div>
                      </div>
                    </div>

                    <div>
                      <Text type="secondary">Scheduled Instruction</Text>
                      <div className="cron-message-block">{job.payload.message}</div>
                    </div>

                    {job.lastError && <Alert showIcon type="error" message={job.lastError} />}

                    <Space wrap>
                      <Button
                        icon={<PlayCircleOutlined />}
                        loading={runningJobId === job.id}
                        onClick={() => void handleRun(job.id)}
                      >
                        Run Now
                      </Button>
                      <Button
                        icon={job.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                        onClick={() => void handleToggle(job)}
                      >
                        {job.enabled ? 'Pause' : 'Enable'}
                      </Button>
                      <Button icon={<EditOutlined />} onClick={() => openEditModal(job)}>
                        Edit
                      </Button>
                      <Popconfirm
                        title="Delete this cron job?"
                        onConfirm={() => void handleDelete(job.id)}
                      >
                        <Button danger icon={<DeleteOutlined />}>
                          Delete
                        </Button>
                      </Popconfirm>
                    </Space>
                  </Flex>
                </Card>
              </List.Item>
            )}
          />
        )}
      </Space>

      <Modal
        destroyOnClose
        open={modalOpen}
        title={editingJob ? 'Edit Cron Job' : 'Create Cron Job'}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText={editingJob ? 'Save Changes' : 'Create Job'}
        width={760}
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                label="Name"
                name="name"
                rules={[{ required: true, message: 'Enter a job name' }]}
              >
                <Input maxLength={80} placeholder="Morning workspace recap" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Delete After Run" name="deleteAfterRun" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label="Scheduled Instruction"
            name="payloadMessage"
            rules={[{ required: true, message: 'Enter the instruction to run' }]}
          >
            <Input.TextArea
              rows={5}
              placeholder="Summarize recent workspace changes and suggest the next step."
            />
          </Form.Item>

          <Form.Item label="Trigger Type" name="triggerType" initialValue="cron">
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="cron">Cron</Radio.Button>
              <Radio.Button value="every">Every</Radio.Button>
              <Radio.Button value="at">One Time</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, next) => prev.triggerType !== next.triggerType}>
            {({ getFieldValue }) => {
              const triggerType = getFieldValue('triggerType')

              if (triggerType === 'every') {
                return (
                  <Form.Item
                    label="Interval (seconds)"
                    name="triggerIntervalSeconds"
                    rules={[{ required: true, message: 'Enter the interval in seconds' }]}
                  >
                    <InputNumber min={1} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                )
              }

              if (triggerType === 'at') {
                return (
                  <Form.Item
                    label="Run At"
                    name="triggerDateLocal"
                    rules={[{ required: true, message: 'Pick a run time' }]}
                  >
                    <Input type="datetime-local" />
                  </Form.Item>
                )
              }

              return (
                <Row gutter={16}>
                  <Col xs={24} md={14}>
                    <Form.Item
                      label="Cron Expression"
                      name="triggerCronExpr"
                      rules={[{ required: true, message: 'Enter a cron expression' }]}
                    >
                      <Input placeholder="0 9 * * 1-5" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={10}>
                    <Form.Item label="Timezone" name="triggerTz" initialValue={defaultTimezone}>
                      <Input placeholder="Asia/Shanghai" />
                    </Form.Item>
                  </Col>
                </Row>
              )
            }}
          </Form.Item>

          <Form.Item
            label="Record Delivery Target"
            name="payloadDeliver"
            valuePropName="checked"
            extra="Optional compatibility fields from the reference project. Web UI mode does not boot gateway channels."
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
                    <Form.Item label="Channel" name="payloadChannel">
                      <Input placeholder="web" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="Target" name="payloadTo">
                      <Input placeholder="session id or chat id" />
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
