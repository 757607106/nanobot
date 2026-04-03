import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Alert,
  Button,
  Flex,
  Skeleton,
  Tag,
  Typography,
  Space,
  theme,
} from 'antd'
import {
  ClockCircleOutlined,
  MessageOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  ApiOutlined,
  DatabaseOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import MetricCard from '../components/console/MetricCard'
import SectionCard from '../components/console/SectionCard'
import type {
  AgentDefinition,
  CronStatus,
  KnowledgeBaseDefinition,
  SessionListResponse,
  SystemStatus,
} from '../types'
import { useToast } from '../toast'

function getSessionTitle(title?: string) {
  if (!title || title === 'New Chat') {
    return '新会话'
  }
  return title
}

function formatSessionTime(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function cardSkeleton(width = 72) {
  return <Skeleton active title={{ width }} paragraph={false} />
}

export default function DashboardPage() {
  const message = useToast()
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const [cron, setCron] = useState<CronStatus | null>(null)
  const [sessions, setSessions] = useState<SessionListResponse | null>(null)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadDashboard()
  }, [])

  const recentSessions = useMemo(() => (sessions?.items || []).slice(0, 10), [sessions])
  const activeChannels = system?.stats.enabledChannels || []
  const isSystemOnline = cron?.enabled ?? false
  const dateString = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  async function loadDashboard() {
    try {
      setLoading(true)
      const [cronData, sessionsData, agentsData, systemData, kbData] = await Promise.all([
        api.getCronStatus(),
        api.getSessions(),
        api.getAgents(),
        api.getSystemStatus(),
        api.getKnowledgeBases().catch(() => [] as KnowledgeBaseDefinition[]),
      ])
      setCron(cronData)
      setSessions(sessionsData)
      setAgents(agentsData)
      setSystem(systemData)
      setKnowledgeBases(Array.isArray(kbData) ? kbData : [])
      setError(null)
    } catch (loadError) {
      const nextError = loadError instanceof Error ? loadError.message : '加载控制台总览失败'
      setError(nextError)
      message.error(nextError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-stack stagger-container">
      {/* ── 顶部状态栏 ── */}
      <div style={{
        padding: 'var(--nb-spacing-lg) 0 var(--nb-spacing-xl) 0',
        borderBottom: `1px solid var(--nb-border)`,
        marginBottom: 'var(--nb-spacing-xl)',
      }}>
        <Flex justify="space-between" align="flex-end" wrap="wrap" gap="var(--nb-spacing-md)">
          <Flex vertical gap="var(--nb-spacing-xs)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: isSystemOnline ? token.colorSuccess : token.colorWarning,
                boxShadow: `0 0 10px ${isSystemOnline ? token.colorSuccess : token.colorWarning}`,
              }} />
              <Typography.Text type="secondary" style={{ fontFamily: 'var(--nb-font-mono)', fontSize: 12, letterSpacing: '0.06em' }}>
                {isSystemOnline ? '系统运行中' : '系统待机'} · {dateString}
              </Typography.Text>
            </div>
            <Typography.Title level={1} style={{
              fontFamily: 'var(--nb-font-display)',
              margin: 0,
              fontSize: 'clamp(26px, 3.5vw, 38px)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
            }}>
              控制台总览
            </Typography.Title>
          </Flex>
          <Space size={10}>
            <Button
              icon={<ReloadOutlined spin={loading} />}
              onClick={() => void loadDashboard()}
              disabled={loading}
              style={{ borderRadius: 'var(--nb-radius-sm)' }}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<MessageOutlined />}
              onClick={() => navigate('/chat')}
              style={{ borderRadius: 'var(--nb-radius-sm)', fontWeight: 600 }}
            >
              发起对话
            </Button>
          </Space>
        </Flex>
      </div>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 'var(--nb-spacing-lg)' }} /> : null}

      {/* ── 核心指标卡 ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 'var(--nb-spacing-md)',
        marginBottom: 'var(--nb-spacing-xl)',
      }}>
        <MetricCard
          label="智能体"
          value={loading ? cardSkeleton() : agents.length}
          helper="已配置员工总数"
          tone="primary"
          icon={<RobotOutlined />}
        />
        <MetricCard
          label="会话总量"
          value={loading ? cardSkeleton() : sessions?.total ?? 0}
          helper="历史对话记录数"
          tone="success"
          icon={<MessageOutlined />}
        />
        <MetricCard
          label="知识库"
          value={loading ? cardSkeleton() : knowledgeBases.length}
          helper="知识资源库数量"
          tone="warning"
          icon={<DatabaseOutlined />}
        />
        <MetricCard
          label="定时任务"
          value={loading ? cardSkeleton() : cron?.jobs ?? 0}
          helper={cron?.enabled ? '调度引擎运行中' : '调度引擎离线'}
          tone={cron?.enabled ? 'neutral' : 'neutral'}
          icon={<ClockCircleOutlined />}
        />
        <MetricCard
          label="接入渠道"
          value={loading ? cardSkeleton() : activeChannels.length}
          helper="已启用的连接通道"
          tone="neutral"
          icon={<ApiOutlined />}
        />
      </div>

      {/* ── 主体双栏 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--nb-spacing-lg)', alignItems: 'start' }}>

        {/* 左：最近会话 */}
        <SectionCard
          title="最近会话"
          action={
            <Button type="text" size="small" onClick={() => navigate('/chat')}
              style={{ fontSize: 'var(--nb-text-xs)', color: 'var(--nb-accent)' }}>
              查看全部
            </Button>
          }
        >
          {loading ? (
            <Flex vertical gap="var(--nb-spacing-md)">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} active paragraph={{ rows: 1 }} title={{ width: '45%' }} />
              ))}
            </Flex>
          ) : recentSessions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {recentSessions.map((session, i) => (
                <motion.div
                  key={session.sessionId || session.id}
                  onClick={() => navigate(`/chat?session=${session.sessionId || session.id}`)}
                  style={{
                    padding: 'var(--nb-spacing-sm) var(--nb-spacing-md)',
                    background: i % 2 === 0 ? 'transparent' : 'var(--nb-card-subtle-bg)',
                    cursor: 'pointer',
                    borderRadius: 'var(--nb-radius-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  whileHover={{ backgroundColor: 'var(--nb-card-subtle-bg)' }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)', display: 'block' }} ellipsis>
                      {getSessionTitle(session.title)}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                      {formatSessionTime(session.updatedAt || session.createdAt)}
                    </Typography.Text>
                  </div>
                  <Flex align="center" gap="var(--nb-spacing-sm)" style={{ flexShrink: 0 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                      {session.messageCount} 条消息
                    </Typography.Text>
                    <RightOutlined style={{ color: token.colorTextQuaternary, fontSize: 10 }} />
                  </Flex>
                </motion.div>
              ))}
            </div>
          ) : (
            <Flex vertical align="center" justify="center" style={{ padding: '48px 0', opacity: 0.55 }}>
              <svg width="120" height="40" viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 20 H30 L40 5 L50 35 L60 15 L70 25 L80 20 H120" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--nb-muted)' }} />
                <circle cx="60" cy="15" r="3" fill="var(--nb-accent)" />
              </svg>
              <Typography.Text type="secondary" style={{ marginTop: 14, fontSize: 12, letterSpacing: '0.04em' }}>
                暂无会话记录
              </Typography.Text>
            </Flex>
          )}
        </SectionCard>

        {/* 右：状态面板 */}
        <Flex vertical gap="var(--nb-spacing-md)">
          {/* 系统状态 */}
          <SectionCard title="系统状态">
            {loading ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : (
              <Flex vertical gap={0}>
                {[
                  { label: '调度引擎', value: cron?.enabled ? '运行中' : '已离线', color: cron?.enabled ? 'green' : 'default' },
                  { label: '网关服务', value: '运行中', color: 'green' },
                  { label: '运行版本', value: system?.web.version || '—', color: undefined },
                ].map((row, i, arr) => (
                  <Flex
                    key={row.label}
                    justify="space-between"
                    align="center"
                    style={{
                      padding: '10px 0',
                      borderBottom: i < arr.length - 1 ? `1px solid ${token.colorBorderSecondary}` : 'none',
                    }}
                  >
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>{row.label}</Typography.Text>
                    {row.color ? (
                      <Tag color={row.color} style={{ margin: 0 }}>{row.value}</Tag>
                    ) : (
                      <Typography.Text strong style={{ fontSize: 13, fontFamily: 'var(--nb-font-mono)' }}>{row.value}</Typography.Text>
                    )}
                  </Flex>
                ))}
              </Flex>
            )}
          </SectionCard>

          {/* 接入渠道 */}
          <SectionCard
            title="接入渠道"
            action={
              <Button type="text" size="small" onClick={() => navigate('/channels')}
                style={{ fontSize: 'var(--nb-text-xs)', color: 'var(--nb-accent)' }}>
                管理
              </Button>
            }
          >
            {loading ? (
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            ) : activeChannels.length > 0 ? (
              <Flex wrap="wrap" gap="var(--nb-spacing-xs)">
                {activeChannels.map((channel) => (
                  <Tag key={channel} style={{ margin: 0, borderRadius: 6 }}>
                    {channel}
                  </Tag>
                ))}
              </Flex>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                暂无已启用渠道
              </Typography.Text>
            )}
          </SectionCard>
        </Flex>

      </div>
    </div>
  )
}
