import { useEffect, useMemo, useState } from 'react'
import { App, Empty, Spin, Tag } from 'antd'
import { api } from '../api'
import type {
  ChannelListResponse,
  CronStatus,
  InstalledSkill,
  SessionListResponse,
} from '../types'

const dashboardChannelIcons: Record<string, string> = {
  telegram: '✈️',
  whatsapp: '🟢',
  discord: '🎮',
  qq: '🐧',
  slack: '💬',
  matrix: '🔷',
  feishu: '🪽',
  dingtalk: '📘',
  wecom: '🧩',
  mochat: '🧠',
  email: '✉️',
}

function channelIconsLabel(name: string) {
  return (
    {
      telegram: 'Telegram',
      whatsapp: 'WhatsApp',
      discord: 'Discord',
      qq: 'QQ',
      slack: 'Slack',
      matrix: 'Matrix',
      feishu: '飞书 / Lark',
      dingtalk: '钉钉',
      wecom: '企业微信',
      mochat: 'Mochat',
      email: '邮箱',
    }[name] || name
  )
}

function getSessionTitle(title?: string) {
  if (!title || title === 'New Chat') {
    return '新会话'
  }
  return title
}

function formatNextWake(nextWakeAtMs?: number | null) {
  if (!nextWakeAtMs) {
    return '未安排'
  }
  return new Date(nextWakeAtMs).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function DashboardPage() {
  const { message } = App.useApp()
  const [channels, setChannels] = useState<ChannelListResponse | null>(null)
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [cron, setCron] = useState<CronStatus | null>(null)
  const [sessions, setSessions] = useState<SessionListResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadDashboard()
  }, [])

  const stats = useMemo(() => {
    const totalChannels = channels?.items.length ?? 0
    const enabledChannels = channels?.items.filter((item) => item.enabled).length ?? 0
    const activeSkills = skills.filter((item) => item.enabled !== false).length
    const enabledCronJobs = cron?.enabled ? cron.jobs : 0
    const totalSessions = sessions?.total ?? sessions?.items.length ?? 0

    return [
      {
        key: 'channels',
        label: '渠道',
        value: loading ? null : `${enabledChannels} / ${totalChannels}`,
        sub: '已启用',
      },
      {
        key: 'skills',
        label: '技能',
        value: loading ? null : String(activeSkills),
        sub: '已启用',
      },
      {
        key: 'cron',
        label: '自动化',
        value: loading ? null : String(enabledCronJobs),
        sub: cron?.enabled ? '运行中' : '已停止',
      },
      {
        key: 'sessions',
        label: '会话',
        value: loading ? null : String(totalSessions),
        sub: '当前工作区',
      },
    ]
  }, [channels, cron, loading, sessions, skills])

  const dashboardChannelCards = useMemo(() => {
    return (channels?.items || []).slice(0, 6)
  }, [channels])

  const highlightedSkills = useMemo(() => {
    return skills.slice(0, 5)
  }, [skills])

  const recentSessions = useMemo(() => {
    return (sessions?.items || []).slice(0, 4)
  }, [sessions])

  async function loadDashboard() {
    try {
      setLoading(true)

      const [channelsData, skillsData, cronData, sessionsData] = await Promise.all([
        api.getChannels(),
        api.getInstalledSkills(),
        api.getCronStatus(),
        api.getSessions(),
      ])

      setChannels(channelsData)
      setSkills(skillsData)
      setCron(cronData)
      setSessions(sessionsData)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载仪表板概览失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="chat-dashboard-shell">
        <div className="chat-dashboard-topbar">
          <div className="chat-dashboard-title-chip">仪表板</div>
        </div>

        <div className="chat-dashboard-stats-grid">
          {stats.map((item) => (
            <div key={item.key} className="chat-dashboard-stat-card">
              <span>{item.label}</span>
              <strong>{item.value ?? '--'}</strong>
              <small>{item.sub}</small>
            </div>
          ))}
        </div>

        <div className="dashboard-overview-grid">
          <div className="chat-dashboard-channel-card">
            <div className="chat-dashboard-channel-head">
              <div>
                <strong>渠道概览</strong>
              </div>
            </div>

            {loading ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : dashboardChannelCards.length === 0 ? (
              <Empty description="暂无渠道数据" className="empty-block" />
            ) : (
              <div className="chat-dashboard-channel-grid">
                {dashboardChannelCards.map((item) => (
                  <div
                    key={item.name}
                    className={`chat-dashboard-channel-item status-${item.status}`}
                  >
                    <div className="chat-dashboard-channel-title">
                      <span>{dashboardChannelIcons[item.name] || '📡'}</span>
                      <strong>{channelIconsLabel(item.name)}</strong>
                    </div>
                    <div className="chat-dashboard-channel-tags">
                      <Tag color={item.enabled ? 'green' : 'default'}>
                        {item.enabled ? '已启用' : '未启用'}
                      </Tag>
                      <Tag
                        color={
                          item.status === 'incomplete'
                            ? 'orange'
                            : item.status === 'enabled'
                              ? 'green'
                              : 'blue'
                        }
                      >
                        {item.statusLabel}
                      </Tag>
                    </div>
                    <div className="chat-dashboard-channel-copy">{item.statusDetail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="dashboard-insights-stack">
            <div className="chat-dashboard-channel-card dashboard-data-card">
              <div className="chat-dashboard-channel-head">
                <div>
                  <strong>技能概览</strong>
                </div>
              </div>

              {loading ? (
                <div className="center-box">
                  <Spin />
                </div>
              ) : highlightedSkills.length === 0 ? (
                <Empty description="暂无技能数据" className="empty-block" />
              ) : (
                <div className="dashboard-data-list">
                  {highlightedSkills.map((item) => (
                    <div key={item.id} className="dashboard-data-item">
                      <div>
                        <strong>{item.name}</strong>
                      </div>
                      <Tag color={item.enabled !== false ? 'green' : 'default'}>
                        {item.enabled !== false ? '已启用' : '未启用'}
                      </Tag>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="chat-dashboard-channel-card dashboard-data-card">
              <div className="chat-dashboard-channel-head">
                <div>
                  <strong>自动化状态</strong>
                </div>
              </div>

              <div className="dashboard-data-list">
                <div className="dashboard-data-item">
                  <div>
                    <strong>任务引擎</strong>
                    <span>{cron?.enabled ? '正在运行' : '已停止'}</span>
                  </div>
                  <Tag color={cron?.enabled ? 'green' : 'default'}>
                    {cron?.enabled ? '已启用' : '未启用'}
                  </Tag>
                </div>
                <div className="dashboard-data-item">
                  <div>
                    <strong>任务数量</strong>
                  </div>
                  <Tag>{cron?.jobs ?? 0}</Tag>
                </div>
                <div className="dashboard-data-item">
                  <div>
                    <strong>下一次唤醒</strong>
                    <span>{formatNextWake(cron?.nextWakeAtMs)}</span>
                  </div>
                  <Tag>{cron?.deliveryMode === 'agent_only' ? 'Agent Only' : cron?.deliveryMode || '--'}</Tag>
                </div>
              </div>
            </div>

            <div className="chat-dashboard-channel-card dashboard-data-card">
              <div className="chat-dashboard-channel-head">
                <div>
                  <strong>最近会话</strong>
                </div>
              </div>

              {loading ? (
                <div className="center-box">
                  <Spin />
                </div>
              ) : recentSessions.length === 0 ? (
                <Empty description="暂无会话数据" className="empty-block" />
              ) : (
                <div className="dashboard-data-list">
                  {recentSessions.map((item) => (
                    <div key={item.id} className="dashboard-data-item">
                      <div>
                        <strong>{getSessionTitle(item.title)}</strong>
                        <span>{item.messageCount} 条消息</span>
                      </div>
                      <Tag>{item.id}</Tag>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
