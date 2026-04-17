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
import PageHeader from '../components/console/PageHeader'
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
    <div className="page-stack stagger-container" style={{ width: '100%', minWidth: 0 }}>
      {/* ── 顶部状态栏 ── */}
      <PageHeader
        title="控制台总览"
        subtitle={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: isSystemOnline ? token.colorSuccess : token.colorWarning,
              boxShadow: `0 0 10px ${isSystemOnline ? token.colorSuccess : token.colorWarning}`,
            }} />
            <span style={{ fontFamily: 'var(--nb-font-mono)', fontSize: 'var(--nb-text-sm)', letterSpacing: '0.04em' }}>
              {isSystemOnline ? '系统运行中' : '系统待机'} · {dateString}
            </span>
          </div>
        }
        actions={
          <Flex gap={12} align="center">
            <Button
              type="text"
              icon={<ReloadOutlined spin={loading} />}
              onClick={() => void loadDashboard()}
              disabled={loading}
              style={{ color: 'var(--nb-text-secondary)' }}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<MessageOutlined />}
              onClick={() => navigate('/chat')}
            >
              发起对话
            </Button>
          </Flex>
        }
      />

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 'var(--nb-spacing-lg)' }} /> : null}

      {/* ── 核心指标卡 ── */}
      <div className="dashboard-metrics-grid">
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

      {/* ── 主体内容区 ── */}
      <div className="dashboard-main-grid">

        {/* 左半区：任务动作与会话阵列 */}
        <Flex vertical gap="var(--nb-spacing-lg)" style={{ minWidth: 0 }}>
          
          {/* 快捷按钮阵列 */}
          <div className="dashboard-quick-action-grid">
            <div 
              onClick={() => navigate('/studio')}
              className="dashboard-quick-action interactive-lift"
            >
              <div className="dashboard-quick-action-icon" style={{ background: 'rgba(22, 119, 255, 0.1)', color: '#1677ff' }}>
                <RobotOutlined />
              </div>
              <div>
                <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>创建智能体</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>配置并调试核心数字员工角色</Typography.Text>
              </div>
            </div>
            
            <div 
              onClick={() => navigate('/knowledge')}
              className="dashboard-quick-action interactive-lift"
            >
              <div className="dashboard-quick-action-icon" style={{ background: 'rgba(250, 140, 22, 0.1)', color: '#fa8c16' }}>
                <DatabaseOutlined />
              </div>
              <div>
                <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>构建知识库</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>导入私有语料训练专属大脑</Typography.Text>
              </div>
            </div>
            
            <div 
              onClick={() => navigate('/channels')}
              className="dashboard-quick-action interactive-lift"
            >
              <div className="dashboard-quick-action-icon" style={{ background: 'rgba(82, 196, 26, 0.1)', color: '#52c41a' }}>
                <ApiOutlined />
              </div>
              <div>
                <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>连接发布渠道</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>将中枢系统接入办公平台或社群</Typography.Text>
              </div>
            </div>
          </div>

          {/* 会话矩阵块 */}

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
            <div className="dashboard-recent-sessions-grid">
              {recentSessions.map((session, i) => (
                <motion.div
                  key={session.sessionId || session.id}
                  onClick={() => navigate(`/chat?session=${session.sessionId || session.id}`)}
                  className="dashboard-recent-session-card interactive-lift"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2, delay: i * 0.05 }}
                >
                  <Flex align="flex-start" gap={10} style={{ marginBottom: 12 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, background: 'color-mix(in srgb, var(--nb-accent) 15%, transparent)',
                      color: 'var(--nb-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                      <MessageOutlined style={{ fontSize: 'var(--nb-text-sm)' }} />
                    </div>
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)', lineHeight: 1.3, maxHeight: 40, WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', display: '-webkit-box' }} title={getSessionTitle(session.title)}>
                      {getSessionTitle(session.title)}
                    </Typography.Text>
                  </Flex>
                  
                  <Flex justify="space-between" align="center" style={{ marginTop: 'auto' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-2xs)' }}>
                      {formatSessionTime(session.updatedAt || session.createdAt)}
                    </Typography.Text>
                    <Flex align="center" gap={4} style={{ background: 'var(--nb-body-bg)', padding: '2px 8px', borderRadius: 20 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-2xs)', fontWeight: 'var(--nb-font-weight-medium)' }}>
                        {session.messageCount} msg
                      </Typography.Text>
                    </Flex>
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
              <Typography.Text type="secondary" style={{ marginTop: 14, fontSize: 'var(--nb-text-xs)', letterSpacing: '0.04em' }}>
                暂无会话记录
              </Typography.Text>
            </Flex>
          )}
        </SectionCard>
        </Flex>

        {/* 右：状态面板 */}
        <Flex vertical gap="var(--nb-spacing-lg)" className="dashboard-side-rail" style={{ position: 'sticky', top: 80 }}>
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
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>{row.label}</Typography.Text>
                    {row.color ? (
                      <Tag color={row.color} style={{ margin: 0 }}>{row.value}</Tag>
                    ) : (
                      <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)', fontFamily: 'var(--nb-font-mono)' }}>{row.value}</Typography.Text>
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
              <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>
                暂无已启用渠道
              </Typography.Text>
            )}
          </SectionCard>
        </Flex>

      </div>
    </div>
  )
}
