import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
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
  theme,
} from 'antd'
import {
  ApiOutlined,
  BookOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  SettingOutlined,
  ThunderboltOutlined,
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

function getChannelStatusColor(status: string) {
  if (status === 'enabled') {
    return 'green'
  }
  if (status === 'incomplete') {
    return 'orange'
  }
  return 'default'
}

interface QuickActionItem {
  icon: React.ReactNode
  title: string
  description: string
  to: string
}

const quickActions: QuickActionItem[] = [
  {
    icon: <ApiOutlined />,
    title: '渠道管理',
    description: '配置消息渠道接入',
    to: '/channels/list',
  },
  {
    icon: <RobotOutlined />,
    title: 'Agent Studio',
    description: '管理数字员工配置',
    to: '/studio/agents',
  },
  {
    icon: <BookOutlined />,
    title: '知识库',
    description: '管理知识库与文档',
    to: '/knowledge',
  },
  {
    icon: <SettingOutlined />,
    title: '系统设置',
    description: '检查实例与健康状态',
    to: '/system',
  },
  {
    icon: <ThunderboltOutlined />,
    title: 'MCP 服务',
    description: '管理工具与服务',
    to: '/mcp',
  },
  {
    icon: <MessageOutlined />,
    title: '会话记录',
    description: '查看对话历史',
    to: '/chat',
  },
]

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
  const { token } = theme.useToken()

  const leftContent = icon ?? (
    <Avatar
      src={avatarSrc}
      size={36}
      style={{ background: `var(--nb-accent-soft)`, color: 'var(--nb-accent)', flexShrink: 0 }}
    >
      {avatarPlaceholder}
    </Avatar>
  )

  return (
    <div
      onClick={onClick}
      style={{
        padding: 'var(--nb-spacing-sm)',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgLayout,
        cursor: onClick ? 'pointer' : 'default',
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
    </div>
  )
}

export default function DashboardPage() {
  const { message } = App.useApp()
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
    <div className="w-full">
      <Flex vertical gap={24}>
        <PageHeader
          title="平台总览"
          subtitle="运行态、渠道、技能和调度一览"
          actions={
            <Button
              icon={<ReloadOutlined spin={loading} />}
              onClick={() => void loadDashboard()}
              disabled={loading}
            >
              刷新
            </Button>
          }
        />

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

        {/* 快速操作区 */}
        <div>
          <Typography.Title level={5} style={{ marginBottom: 'var(--nb-spacing-md)' }}>
            快速操作
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {quickActions.map((item) => (
              <Col xs={24} sm={12} md={8} key={item.to}>
                <Card
                  hoverable
                  className="hover:-translate-y-0.5 transition-transform cursor-pointer"
                  style={{
                    borderColor: token.colorBorderSecondary,
                  }}
                  styles={{
                    body: {
                      padding: 'var(--nb-spacing-md)',
                    },
                  }}
                  onClick={() => navigate(item.to)}
                >
                  <Flex align="center" gap={'var(--nb-spacing-sm)'}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 'var(--nb-radius-md)',
                        background: 'linear-gradient(135deg, var(--nb-accent) 0%, var(--nb-accent-2) 100%)',
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Typography.Text strong>{item.title}</Typography.Text>
                      <Typography.Paragraph
                        type="secondary"
                        style={{ margin: '4px 0 0', fontSize: 'var(--nb-text-xs)' }}
                        ellipsis
                      >
                        {item.description}
                      </Typography.Paragraph>
                    </div>
                    <RightOutlined style={{ color: token.colorTextQuaternary }} />
                  </Flex>
                </Card>
              </Col>
            ))}
          </Row>
        </div>

        {/* 渠道状态 & 最近会话 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
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

          <Col xs={24} lg={12}>
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
                <div
                  style={{
                    padding: 'var(--nb-spacing-sm)',
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgLayout,
                  }}
                >
                  <Flex justify="space-between" align="center">
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>
                      任务引擎
                    </Typography.Text>
                    <Flex gap={'var(--nb-spacing-xs)'}>
                      <Tag color={cron?.enabled ? 'green' : 'orange'} style={{ margin: 0 }}>
                        {cron?.enabled ? '运行中' : '已停止'}
                      </Tag>
                      <Tag style={{ margin: 0 }}>任务数 {cron?.jobs ?? 0}</Tag>
                    </Flex>
                  </Flex>
                  <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', display: 'block', marginTop: 'var(--nb-spacing-xs)' }}>
                    {cron?.enabled ? '正在运行，新的计划任务会按调度继续推进。' : '当前已停止，计划任务不会继续执行。'}
                  </Typography.Text>
                </div>

                <div
                  style={{
                    padding: 'var(--nb-spacing-sm)',
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgLayout,
                  }}
                >
                  <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>
                    下一次唤醒
                  </Typography.Text>
                  <Typography.Paragraph style={{ margin: 'var(--nb-spacing-xs) 0 0', fontSize: 'var(--nb-text-sm)' }}>
                    {formatNextWake(cron?.nextWakeAtMs)}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                    当前投递模式：{cron?.deliveryMode === 'agent_only' ? 'Agent Only' : cron?.deliveryMode || '--'}
                  </Typography.Text>
                </div>

                <div
                  style={{
                    padding: 'var(--nb-spacing-sm)',
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgLayout,
                  }}
                >
                  <Flex justify="space-between" align="center">
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>
                      渠道运行态
                    </Typography.Text>
                    <Typography.Text style={{ fontSize: 'var(--nb-text-sm)' }}>
                      {enabledChannels} / {totalChannels}
                    </Typography.Text>
                  </Flex>
                  <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', display: 'block', marginTop: 'var(--nb-spacing-xs)' }}>
                    已启用渠道 / 总渠道数
                  </Typography.Text>
                </div>
              </Flex>
            </SectionCard>
          </Col>
        </Row>
      </Flex>
    </div>
  )
}
