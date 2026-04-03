import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Flex,
  Row,
  Col,
  Skeleton,
  Tag,
  Typography,
  Space,
  theme,
} from 'antd'
import {
  BookOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import MetricCard from '../components/console/MetricCard'
import PageHeader from '../components/console/PageHeader'
import SectionCard from '../components/console/SectionCard'
import type {
  AgentDefinition,
  ChannelListResponse,
  CronStatus,
  InstalledSkill,
  KnowledgeBaseDefinition,
  SessionListResponse,
} from '../types'
import { useToast } from '../toast'

const dashboardChannelIcons: Record<string, string> = {
  telegram: '/channel-logos/telegram.png',
  whatsapp: '/channel-logos/whatsapp.jpeg',
  discord: '/channel-logos/discord.jpeg',
  qq: '/channel-logos/qq.png',
  slack: '/channel-logos/slack.png',
  matrix: '/channel-logos/matrix.png',
  feishu: '/channel-logos/feishu.png',
  dingtalk: '/channel-logos/dingtalk.jpeg',
  wecom: '/channel-logos/wecom.jpeg',
  mochat: '/channel-logos/mochat.jpeg',
  email: '/channel-logos/email.jpeg',
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

function formatSessionTime(value?: string) {
  if (!value) {
    return '暂无时间'
  }
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

/** Dashboard 列表项组件 - 统一渠道/会话/技能/自动化列表项样式 */
interface DashboardListItemProps {
  /** 左侧图标或头像 */
  icon?: React.ReactNode
  /** 左侧头像图片地址 */
  avatarSrc?: string
  /** 头像占位文字 */
  avatarPlaceholder?: string
  /** 主标题 */
  title: string
  /** 副标题/描述 */
  subtitle?: string
  /** 右侧标签 */
  tag?: React.ReactNode
  /** 右侧额外内容 */
  extra?: React.ReactNode
  /** 点击处理 */
  onClick?: () => void
}

function DashboardListItem({
  icon,
  avatarSrc,
  avatarPlaceholder,
  title,
  subtitle,
  tag,
  extra,
  onClick,
}: DashboardListItemProps) {
  const leftContent = icon ?? (
    <Avatar
      src={avatarSrc}
      size={40}
      shape="square"
      style={{ background: `var(--nb-accent-soft)`, color: 'var(--nb-accent)', flexShrink: 0, borderRadius: 10 }}
    >
      {avatarPlaceholder}
    </Avatar>
  )

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
      style={{
        padding: '12px 16px',
        borderRadius: 16,
        background: 'var(--nb-card-subtle-bg)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background-color 0.2s ease',
      }}
    >
      <Flex align="center" gap={'var(--nb-spacing-sm)'}>
        {leftContent}
        <div style={{ minWidth: 0, flex: 1 }}>
          <Flex justify="space-between" align="center" gap={'var(--nb-spacing-xs)'}>
            <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>
              {title}
            </Typography.Text>
            {tag}
          </Flex>
          {subtitle ? (
            <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', display: 'block', marginTop: 2 }}>
              {subtitle}
            </Typography.Text>
          ) : null}
        </div>
        {extra}
      </Flex>
    </motion.div>
  )
}

export default function DashboardPage() {
  const message = useToast()
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const [channels, setChannels] = useState<ChannelListResponse | null>(null)
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [cron, setCron] = useState<CronStatus | null>(null)
  const [sessions, setSessions] = useState<SessionListResponse | null>(null)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadDashboard()
  }, [])

  const totalChannels = channels?.items.length ?? 0
  const enabledChannels = channels?.items.filter((item) => item.enabled).length ?? 0
  const activeSkills = skills.filter((item) => item.enabled !== false).length
  const recentSessions = useMemo(() => (sessions?.items || []).slice(0, 5), [sessions])
  const dashboardChannelCards = useMemo(() => (channels?.items || []).slice(0, 6), [channels])
  const highlightedSkills = useMemo(() => skills.slice(0, 6), [skills])
  
  const hour = new Date().getHours()
  const greeting = hour < 6 ? '凌晨好' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  async function loadDashboard() {
    try {
      setLoading(true)
      const [channelsData, skillsData, cronData, sessionsData, agentsData, kbData] = await Promise.all([
        api.getChannels(),
        api.getInstalledSkills(),
        api.getCronStatus(),
        api.getSessions(),
        api.getAgents(),
        api.getKnowledgeBases(),
      ])

      setChannels(channelsData)
      setSkills(skillsData)
      setCron(cronData)
      setSessions(sessionsData)
      setAgents(agentsData)
      setKnowledgeBases(kbData)
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
    <div className="page-stack">
      {/* Hero Strip */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(99,102,241,0.02) 100%)',
          border: '1px solid var(--nb-border)',
          borderRadius: 20,
          padding: '28px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05)',
        }}
      >
        <div>
          <Typography.Title level={2} style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {greeting}，欢迎使用 Nanobot
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 14, marginTop: 8, display: 'block' }}>
            管理您的数字员工、知识库、渠道与自动化任务
          </Typography.Text>
        </div>
        <Space size={16}>
          <Button
            icon={<ReloadOutlined spin={loading} />}
            onClick={() => void loadDashboard()}
            disabled={loading}
          >
            刷新状态
          </Button>
          <Button
            type="primary"
            icon={<MessageOutlined />}
            onClick={() => navigate('/chat')}
            style={{ borderRadius: 12, paddingInline: 24, height: 40 }}
          >
            开始对话
          </Button>
        </Space>
      </div>

        {error ? <Alert type="error" showIcon message={error} /> : null}

        {/* 核心指标卡片区 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={12} lg={6}>
            <MetricCard
              label="Agent 数"
              value={loading ? cardSkeleton() : agents.length}
              helper="已配置的数字员工"
              tone="primary"
              icon={<RobotOutlined />}
            />
          </Col>
          <Col xs={24} sm={12} md={12} lg={6}>
            <MetricCard
              label="活跃会话"
              value={loading ? cardSkeleton() : sessions?.total ?? 0}
              helper="当前工作区总会话数"
              tone="success"
              icon={<MessageOutlined />}
            />
          </Col>
          <Col xs={24} sm={12} md={12} lg={6}>
            <MetricCard
              label="运行次数"
              value={loading ? cardSkeleton() : cron?.jobs ?? 0}
              helper={cron?.enabled ? '调度引擎运行中' : '调度引擎未启用'}
              tone={cron?.enabled ? 'success' : 'warning'}
              icon={<ClockCircleOutlined />}
            />
          </Col>
          <Col xs={24} sm={12} md={12} lg={6}>
            <MetricCard
              label="知识库数"
              value={loading ? cardSkeleton() : knowledgeBases.length}
              helper="已创建的知识库"
              tone="neutral"
              icon={<BookOutlined />}
            />
          </Col>
        </Row>


        {/* 渠道状态 & 最近会话 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={9}>
            <SectionCard
              title="渠道状态"
              action={
                <Typography.Link onClick={() => navigate('/channels/list')}>
                  查看全部
                </Typography.Link>
              }
            >
              {loading ? (
                <Flex vertical gap={'var(--nb-spacing-sm)'}>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} active paragraph={{ rows: 1 }} title={{ width: '38%' }} />
                  ))}
                </Flex>
              ) : dashboardChannelCards.length > 0 ? (
                <Flex vertical gap={'var(--nb-spacing-sm)'}>
                  {dashboardChannelCards.map((item) => (
                    <DashboardListItem
                      key={item.name}
                      avatarSrc={dashboardChannelIcons[item.name]}
                      avatarPlaceholder={item.name.charAt(0).toUpperCase()}
                      title={channelIconsLabel(item.name)}
                      subtitle={item.statusLabel}
                      tag={
                        <Tag
                          color={item.enabled ? 'green' : 'default'}
                          style={{ margin: 0, fontSize: 'var(--nb-text-2xs)' }}
                        >
                          {item.enabled ? '已启用' : '未启用'}
                        </Tag>
                      }
                    />
                  ))}
                </Flex>
              ) : (
                <Empty description="暂无渠道配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </SectionCard>
          </Col>

          <Col xs={24} lg={15}>
            <SectionCard
              title="最近会话"
              action={
                <Typography.Link onClick={() => navigate('/chat')}>
                  查看全部
                </Typography.Link>
              }
            >
              {loading ? (
                <Flex vertical gap={'var(--nb-spacing-sm)'}>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} active paragraph={{ rows: 1 }} title={{ width: '40%' }} />
                  ))}
                </Flex>
              ) : recentSessions.length > 0 ? (
                <Flex vertical gap={'var(--nb-spacing-sm)'}>
                  {recentSessions.map((session) => (
                    <DashboardListItem
                      key={session.sessionId || session.id}
                      title={getSessionTitle(session.title)}
                      subtitle={`${formatSessionTime(session.updatedAt || session.createdAt)} · ${session.messageCount} 条消息`}
                      extra={<RightOutlined style={{ color: token.colorTextQuaternary, fontSize: 'var(--nb-text-xs)' }} />}
                      onClick={() => navigate('/chat')}
                    />
                  ))}
                </Flex>
              ) : (
                <Empty description="暂无会话记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </SectionCard>
          </Col>
        </Row>

        {/* 技能部署 & 自动化状态 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <SectionCard
              title="技能部署"
              action={
                <Typography.Link onClick={() => navigate('/skills')}>
                  查看全部
                </Typography.Link>
              }
            >
              {loading ? (
                <Flex vertical gap={'var(--nb-spacing-sm)'}>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} active paragraph={{ rows: 1 }} title={{ width: '36%' }} />
                  ))}
                </Flex>
              ) : highlightedSkills.length > 0 ? (
                <Flex vertical gap={'var(--nb-spacing-sm)'}>
                  {highlightedSkills.map((item) => (
                    <DashboardListItem
                      key={item.id}
                      title={item.name}
                      subtitle={item.description || item.source}
                      tag={
                        <Tag color={item.enabled !== false ? 'green' : 'default'} style={{ margin: 0, fontSize: 'var(--nb-text-2xs)' }}>
                          {item.enabled !== false ? '已启用' : '未启用'}
                        </Tag>
                      }
                    />
                  ))}
                </Flex>
              ) : (
                <Empty description="暂无已安装技能" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </SectionCard>
          </Col>

          <Col xs={24} lg={12}>
            <SectionCard
              title="自动化状态"
              action={
                <Typography.Link onClick={() => navigate('/system/automation')}>
                  打开自动化
                </Typography.Link>
              }
            >
              <Flex vertical gap={'var(--nb-spacing-sm)'}>
                <DashboardListItem
                  title="任务引擎"
                  subtitle={`${cron?.jobs ?? 0} 个任务 · 下次唤醒 ${formatNextWake(cron?.nextWakeAtMs)}`}
                  tag={
                    <Tag color={cron?.enabled ? 'green' : 'orange'} style={{ margin: 0, fontSize: 'var(--nb-text-2xs)' }}>
                      {cron?.enabled ? '运行中' : '已停止'}
                    </Tag>
                  }
                />
              </Flex>
            </SectionCard>
          </Col>
        </Row>
    </div>
  )
}
