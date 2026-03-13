import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Empty, Input, InputNumber, List, Select, Space, Spin, Switch, Tag, Typography } from 'antd'
import { CalendarOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type { CalendarEvent, CalendarEventInput, CalendarSettings, CronJob } from '../types'

const { Text } = Typography

const DEFAULT_VIEW_OPTIONS = [
  { label: '月视图', value: 'dayGridMonth' },
  { label: '周视图', value: 'timeGridWeek' },
  { label: '日视图', value: 'timeGridDay' },
  { label: '列表', value: 'listWeek' },
] as const

const PRIORITY_OPTIONS = [
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' },
] as const

interface EventFormState {
  title: string
  description: string
  start: string
  end: string
  isAllDay: boolean
  priority: 'high' | 'medium' | 'low'
  reminderMinutes: number
  reminderChannel: string
  reminderTarget: string
}

function toDatetimeLocalValue(value?: string | null) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function createEmptyEventForm(): EventFormState {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  return {
    title: '',
    description: '',
    start: toDatetimeLocalValue(start.toISOString()),
    end: toDatetimeLocalValue(end.toISOString()),
    isAllDay: false,
    priority: 'medium',
    reminderMinutes: 15,
    reminderChannel: 'web',
    reminderTarget: 'calendar-reminders',
  }
}

function eventToFormState(event: CalendarEvent): EventFormState {
  const firstReminder = event.reminders[0]
  return {
    title: event.title,
    description: event.description,
    start: toDatetimeLocalValue(event.start),
    end: toDatetimeLocalValue(event.end),
    isAllDay: event.isAllDay,
    priority: event.priority,
    reminderMinutes: typeof firstReminder?.time === 'number' ? firstReminder.time : 15,
    reminderChannel: firstReminder?.channel || 'web',
    reminderTarget: firstReminder?.target || 'calendar-reminders',
  }
}

function formToPayload(form: EventFormState): CalendarEventInput {
  const reminders = form.reminderMinutes > 0
    ? [{
        time: form.reminderMinutes,
        channel: form.reminderChannel.trim() || null,
        target: form.reminderTarget.trim() || null,
      }]
    : []

  return {
    title: form.title.trim(),
    description: form.description.trim(),
    start: new Date(form.start).toISOString(),
    end: new Date(form.end).toISOString(),
    isAllDay: form.isAllDay,
    priority: form.priority,
    reminders,
  }
}

function formatEventRange(event: CalendarEvent) {
  if (event.isAllDay) {
    return `全天 · ${formatDateTimeZh(event.start)}`
  }
  return `${formatDateTimeZh(event.start)} - ${formatDateTimeZh(event.end)}`
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export default function CalendarPage() {
  const { message } = App.useApp()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [settings, setSettings] = useState<CalendarSettings | null>(null)
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [form, setForm] = useState<EventFormState>(() => createEmptyEventForm())
  const [loading, setLoading] = useState(true)
  const [savingEvent, setSavingEvent] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [deletingEvent, setDeletingEvent] = useState(false)
  const [eventError, setEventError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  useEffect(() => {
    void loadCalendar()
  }, [])

  useEffect(() => {
    if (!selectedEventId) {
      return
    }
    const current = events.find((item) => item.id === selectedEventId)
    if (current) {
      setForm(eventToFormState(current))
    }
  }, [events, selectedEventId])

  const selectedEvent = useMemo(
    () => events.find((item) => item.id === selectedEventId) ?? null,
    [events, selectedEventId],
  )

  const derivedJobCount = useMemo(
    () => jobs.filter((job) => job.source === 'calendar').length,
    [jobs],
  )

  async function loadCalendar() {
    try {
      setLoading(true)
      const [eventResult, settingsResult, jobResult] = await Promise.all([
        api.getCalendarEvents(),
        api.getCalendarSettings(),
        api.getCalendarJobs(),
      ])
      setEvents(eventResult)
      setSettings(settingsResult)
      setJobs(jobResult)

      if (selectedEventId && eventResult.some((item) => item.id === selectedEventId)) {
        const current = eventResult.find((item) => item.id === selectedEventId)
        if (current) {
          setForm(eventToFormState(current))
        }
      } else if (eventResult[0]) {
        setSelectedEventId(eventResult[0].id)
        setForm(eventToFormState(eventResult[0]))
      } else {
        setSelectedEventId(null)
        setForm(createEmptyEventForm())
      }

      setEventError(null)
      setSettingsError(null)
    } catch (error) {
      setEventError(getErrorMessage(error, '加载日程数据失败'))
    } finally {
      setLoading(false)
    }
  }

  function handleNewEvent() {
    setSelectedEventId(null)
    setForm(createEmptyEventForm())
    setEventError(null)
  }

  async function handleSaveEvent() {
    if (!form.title.trim()) {
      setEventError('事件标题不能为空。')
      return
    }
    if (!form.start || !form.end) {
      setEventError('开始时间和结束时间不能为空。')
      return
    }
    if (new Date(form.end).getTime() <= new Date(form.start).getTime()) {
      setEventError('结束时间必须晚于开始时间。')
      return
    }

    try {
      setSavingEvent(true)
      const payload = formToPayload(form)
      const saved = selectedEventId
        ? await api.updateCalendarEvent(selectedEventId, payload)
        : await api.createCalendarEvent(payload)

      setSelectedEventId(saved.id)
      setEvents((current) => {
        const next = selectedEventId
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved]
        return next.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      })
      setForm(eventToFormState(saved))
      const refreshedJobs = await api.getCalendarJobs()
      setJobs(refreshedJobs)
      setEventError(null)
      message.success(selectedEventId ? '事件已更新' : '事件已创建')
    } catch (error) {
      setEventError(getErrorMessage(error, '保存事件失败'))
    } finally {
      setSavingEvent(false)
    }
  }

  async function handleDeleteEvent() {
    if (!selectedEventId) {
      return
    }
    try {
      setDeletingEvent(true)
      await api.deleteCalendarEvent(selectedEventId)
      const nextEvents = events.filter((item) => item.id !== selectedEventId)
      setEvents(nextEvents)
      const nextSelected = nextEvents[0] ?? null
      setSelectedEventId(nextSelected?.id ?? null)
      setForm(nextSelected ? eventToFormState(nextSelected) : createEmptyEventForm())
      const refreshedJobs = await api.getCalendarJobs()
      setJobs(refreshedJobs)
      setEventError(null)
      message.success('事件已删除')
    } catch (error) {
      setEventError(getErrorMessage(error, '删除事件失败'))
    } finally {
      setDeletingEvent(false)
    }
  }

  async function handleSaveSettings() {
    if (!settings) {
      return
    }
    try {
      setSavingSettings(true)
      const updated = await api.updateCalendarSettings(settings)
      setSettings(updated)
      setSettingsError(null)
      message.success('日程默认设置已保存')
    } catch (error) {
      setSettingsError(getErrorMessage(error, '保存日程设置失败'))
    } finally {
      setSavingSettings(false)
    }
  }

  if (loading && !settings) {
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
        eyebrow="Calendar"
        title="日程与提醒"
        description="统一管理事件、提醒默认值和派生的 Cron 任务。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadCalendar()} loading={loading}>
              刷新
            </Button>
            <Button icon={<PlusOutlined />} onClick={handleNewEvent}>
              新建事件
            </Button>
          </Space>
        )}
        stats={[
          { label: '事件数', value: events.length },
          { label: '提醒任务', value: derivedJobCount },
          { label: '默认视图', value: settings?.defaultView || '--' },
          { label: '默认优先级', value: settings?.defaultPriority || '--' },
        ]}
      />

      <div className="page-grid calendar-page-grid">
        <Card className="config-panel-card calendar-list-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>事件列表</Typography.Title>
              <Text type="secondary">先选已有事件继续编辑，也可以直接新建。</Text>
            </div>
            <Tag>{events.length} 项</Tag>
          </div>

          <div className="page-scroll-shell calendar-event-list-shell">
            {events.length ? (
              <List
                dataSource={events}
                renderItem={(item) => (
                  <List.Item>
                    <div className="page-stack">
                      <div className="config-card-header">
                        <div className="page-section-title">
                          <Typography.Title level={5}>{item.title}</Typography.Title>
                          <Text type="secondary">{formatEventRange(item)}</Text>
                        </div>
                        <Tag>{item.priority}</Tag>
                      </div>
                      {item.description ? <Text type="secondary">{item.description}</Text> : null}
                      <Space wrap>
                        {item.reminders.length ? (
                          <Tag>{`${item.reminders[0].time} 分钟前提醒`}</Tag>
                        ) : (
                          <Tag>无提醒</Tag>
                        )}
                        {item.isAllDay ? <Tag>全天</Tag> : null}
                      </Space>
                      <Button type={selectedEventId === item.id ? 'primary' : 'default'} onClick={() => setSelectedEventId(item.id)}>
                        {selectedEventId === item.id ? '正在编辑' : '编辑事件'}
                      </Button>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无日程事件" className="empty-block" />
            )}
          </div>
        </Card>

        <div className="page-stack calendar-side-stack">
          <Card className="config-panel-card calendar-jobs-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>{selectedEvent ? `编辑 ${selectedEvent.title}` : '创建新事件'}</Typography.Title>
                <Text type="secondary">优先填写标题、时间、优先级和提醒。</Text>
              </div>
              {selectedEvent ? <Tag>{formatDateTimeZh(selectedEvent.updatedAt)}</Tag> : <Tag>未保存</Tag>}
            </div>

            <div className="page-stack">
              <label className="auth-field">
                <span>标题</span>
                <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </label>

              <label className="auth-field">
                <span>描述</span>
                <Input.TextArea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>

              <div className="page-meta-grid prompt-info-grid">
                <label className="auth-field">
                  <span>开始时间</span>
                  <Input type="datetime-local" value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} />
                </label>
                <label className="auth-field">
                  <span>结束时间</span>
                  <Input type="datetime-local" value={form.end} onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))} />
                </label>
              </div>

              <div className="page-meta-grid prompt-info-grid">
                <label className="auth-field">
                  <span>优先级</span>
                  <Select
                    value={form.priority}
                    options={PRIORITY_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
                    onChange={(value) => setForm((current) => ({ ...current, priority: value as EventFormState['priority'] }))}
                  />
                </label>
                <label className="auth-field">
                  <span>全天事件</span>
                  <Switch checked={form.isAllDay} onChange={(checked) => setForm((current) => ({ ...current, isAllDay: checked }))} />
                </label>
              </div>

              <div className="page-meta-grid prompt-info-grid">
                <label className="auth-field">
                  <span>提前提醒（分钟）</span>
                  <InputNumber min={0} value={form.reminderMinutes} onChange={(value) => setForm((current) => ({ ...current, reminderMinutes: Number(value || 0) }))} />
                </label>
                <label className="auth-field">
                  <span>提醒频道</span>
                  <Input value={form.reminderChannel} onChange={(event) => setForm((current) => ({ ...current, reminderChannel: event.target.value }))} />
                </label>
              </div>

              <label className="auth-field">
                <span>提醒目标</span>
                <Input value={form.reminderTarget} onChange={(event) => setForm((current) => ({ ...current, reminderTarget: event.target.value }))} />
              </label>

              {eventError ? <Alert type="error" showIcon message={eventError} /> : null}

              <Space wrap>
                <Button type="primary" icon={<SaveOutlined />} loading={savingEvent} onClick={() => void handleSaveEvent()}>
                  {selectedEvent ? '保存事件' : '创建事件'}
                </Button>
                <Button icon={<CalendarOutlined />} onClick={handleNewEvent}>
                  切到新建
                </Button>
                <Button danger icon={<DeleteOutlined />} disabled={!selectedEventId} loading={deletingEvent} onClick={() => void handleDeleteEvent()}>
                  删除事件
                </Button>
              </Space>
            </div>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>提醒默认设置</Typography.Title>
                <Text type="secondary">影响新建事件的默认值，不覆盖已有事件。</Text>
              </div>
            </div>

            {settings ? (
              <div className="page-stack">
                <div className="page-meta-grid prompt-info-grid">
                  <label className="auth-field">
                    <span>默认视图</span>
                    <Select
                      value={settings.defaultView}
                      options={DEFAULT_VIEW_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
                      onChange={(value) => setSettings((current) => (current ? { ...current, defaultView: value as CalendarSettings['defaultView'] } : current))}
                    />
                  </label>
                  <label className="auth-field">
                    <span>默认优先级</span>
                    <Select
                      value={settings.defaultPriority}
                      options={PRIORITY_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
                      onChange={(value) => setSettings((current) => (current ? { ...current, defaultPriority: value as CalendarSettings['defaultPriority'] } : current))}
                    />
                  </label>
                </div>

                <div className="page-meta-grid prompt-info-grid">
                  <label className="auth-field">
                    <span>声音提醒</span>
                    <Switch checked={settings.soundEnabled} onChange={(checked) => setSettings((current) => (current ? { ...current, soundEnabled: checked } : current))} />
                  </label>
                  <label className="auth-field">
                    <span>通知提醒</span>
                    <Switch checked={settings.notificationEnabled} onChange={(checked) => setSettings((current) => (current ? { ...current, notificationEnabled: checked } : current))} />
                  </label>
                </div>

                {settingsError ? <Alert type="error" showIcon message={settingsError} /> : null}

                <Button type="primary" icon={<SaveOutlined />} loading={savingSettings} onClick={() => void handleSaveSettings()}>
                  保存默认设置
                </Button>
              </div>
            ) : (
              <Empty description="暂无日程设置" className="empty-block" />
            )}
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>派生提醒任务</Typography.Title>
                <Text type="secondary">这些任务负责把事件提醒投递到会话或频道。</Text>
              </div>
              <Tag>{derivedJobCount} 项</Tag>
            </div>

            <div className="page-scroll-shell calendar-job-list-shell">
              {jobs.length ? (
                <List
                  dataSource={jobs}
                  renderItem={(job) => (
                    <List.Item>
                      <div className="page-stack">
                        <div className="config-card-header">
                          <div className="page-section-title">
                            <Typography.Title level={5}>{job.name}</Typography.Title>
                            <Text type="secondary">{job.payload.message}</Text>
                          </div>
                          <Tag>{job.lastStatus || '待运行'}</Tag>
                        </div>
                        <Space wrap>
                          <Text type="secondary">来源：{job.source || '--'}</Text>
                          <Text type="secondary">下一次运行：{formatDateTimeZh(job.nextRunAtMs)}</Text>
                          {job.payload.to ? <Tag>{job.payload.to}</Tag> : null}
                        </Space>
                      </div>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="暂无派生提醒任务" className="empty-block" />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
