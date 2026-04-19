import { useEffect, useMemo, useState } from 'react'
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
  FireOutlined,
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
  SystemStatus,
  AgentExecutionMetrics,
} from '../types'
import { useToast } from '../toast'

function cardSkeleton(width = 72) {
  return <Skeleton active title={{ width }} paragraph={false} />
}

export default function DashboardPage() {
  const message = useToast()
  const { token } = theme.useToken()
  const navigate = useNavigate()
  const [cron, setCron] = useState<CronStatus | null>(null)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseDefinition[]>([])
  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [agentMetrics, setAgentMetrics] = useState<Record<string, AgentExecutionMetrics>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadDashboard()
  }, [])

  const activeChannels = system?.stats.enabledChannels || []
  const isSystemOnline = cron?.enabled ?? false
  const dateString = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  async function loadDashboard() {
    try {
      setLoading(true)
      const [cronData, agentsData, systemData, kbData, metricsData] = await Promise.all([
        api.getCronStatus(),
        api.getAgents(),
        api.getSystemStatus(),
        api.getKnowledgeBases().catch(() => [] as KnowledgeBaseDefinition[]),
        api.getAgentsMetrics().catch(() => ({})),
      ])
      setCron(cronData)
      setAgents(agentsData)
      setSystem(systemData)
      setKnowledgeBases(Array.isArray(kbData) ? kbData : [])
      setAgentMetrics(metricsData)
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
          <Button
            type="text"
            icon={<ReloadOutlined spin={loading} />}
            onClick={() => void loadDashboard()}
            disabled={loading}
            style={{ color: 'var(--nb-text-secondary)' }}
          >
            刷新
          </Button>
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
          value={loading ? cardSkeleton() : system?.stats.totalSessions ?? 0}
          helper={`历史对话记录数 ${system?.stats.messages ?? 0}`}
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
          tone={cron?.enabled ? 'neutral' : 'warning'}
          icon={<ClockCircleOutlined />}
        />
        <MetricCard
          label="接入渠道"
          value={loading ? cardSkeleton() : activeChannels.length}
          helper="已启用的连接通道"
          tone="neutral"
          icon={<ApiOutlined />}
        />
        <MetricCard
          label="算力消耗"
          value={loading ? cardSkeleton() : (system?.stats.totalTokens ?? 0).toLocaleString()}
          helper={`P: ${system?.stats.promptTokens ?? 0} / C: ${system?.stats.completionTokens ?? 0}`}
          tone="primary"
          icon={<FireOutlined />}
        />
      </div>

      {/* ── 主体内容区 ── */}
      <div className="dashboard-main-grid">

        {/* 左半区：任务动作与会话阵列 */}
        <Flex vertical gap="var(--nb-spacing-lg)" style={{ minWidth: 0 }}>
          
          {/* 快捷按钮阵列 */}
          <div className="dashboard-quick-action-grid">
            <div className="dashboard-quick-action tone-accent" onClick={() => navigate('/studio')}>
              <div className="dashboard-quick-action-icon">
                <RobotOutlined />
              </div>
              <div>
                <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>创建智能体</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>配置并调试核心数字员工角色</Typography.Text>
              </div>
            </div>
            
            <div className="dashboard-quick-action tone-warning" onClick={() => navigate('/knowledge')}>
              <div className="dashboard-quick-action-icon">
                <DatabaseOutlined />
              </div>
              <div>
                <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>构建知识库</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>导入私有语料训练专属大脑</Typography.Text>
              </div>
            </div>
            
            <div className="dashboard-quick-action tone-success" onClick={() => navigate('/channels')}>
              <div className="dashboard-quick-action-icon">
                <ApiOutlined />
              </div>
              <div>
                <Typography.Text strong style={{ display: 'block', fontSize: 'var(--nb-text-sm)' }}>连接发布渠道</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', lineHeight: 1.4, display: 'block' }}>将中枢系统接入办公平台或社群</Typography.Text>
              </div>
            </div>
          </div>

          {/* 会话矩阵块 */}

        {/* ── Agent 效能诊断 ── */}
        <SectionCard title="Agent 开销与效能分析">
          {loading ? (
             <Skeleton active paragraph={{ rows: 4 }} title={false} />
          ) : Object.keys(agentMetrics).length > 0 ? (
             <Flex vertical gap="var(--nb-spacing-lg)">
               {agents.map((agent) => {
                 const metrics = agentMetrics[agent.agentId]
                 // Only render agents that actually have some usage
                 if (!metrics || (metrics.tokens.length === 0 && Object.keys(metrics.tools || {}).length === 0 && Object.keys(metrics.mcps || {}).length === 0 && Object.keys(metrics.knowledge || {}).length === 0)) return null

                 return (
                   <div key={agent.agentId} style={{
                     background: token.colorFillQuaternary,
                     borderRadius: 'var(--nb-radius-lg)',
                     padding: 'var(--nb-spacing-lg)',
                     border: `1px solid ${token.colorBorderSecondary}`,
                   }}>
                     <Flex align="center" gap={12} style={{ marginBottom: 'var(--nb-spacing-md)' }}>
                       <div style={{
                         width: 32, height: 32, borderRadius: 8, background: 'var(--nb-accent)', 
                         color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center'
                       }}>
                         <RobotOutlined />
                       </div>
                       <Typography.Text strong style={{ fontSize: 'var(--nb-text-md)' }}>{agent.name}</Typography.Text>
                     </Flex>

                     <div style={{ 
                       display: 'grid', 
                       gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
                       gap: 'var(--nb-spacing-md)' 
                     }}>
                       {/* Tokens Module */}
                       <div style={{ background: token.colorBgContainer, padding: 'var(--nb-spacing-md)', borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
                         <Flex align="center" gap={8} style={{ marginBottom: 12, opacity: 0.85 }}>
                           <FireOutlined style={{ color: 'var(--nb-accent)' }} />
                           <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', fontWeight: 600, letterSpacing: '0.04em' }}>模型算力消耗 (TOKENS)</Typography.Text>
                         </Flex>
                         {metrics.tokens.length > 0 ? (
                           <Flex vertical gap={8}>
                             {metrics.tokens.map((t, idx) => (
                               <Flex justify="space-between" align="center" key={idx} style={{ paddingBottom: 6, borderBottom: idx < metrics.tokens.length - 1 ? `1px dashed ${token.colorBorderSecondary}` : 'none' }}>
                                 <div style={{ fontSize: 'var(--nb-text-xs)' }}>
                                   <div style={{ fontFamily: 'var(--nb-font-mono)', color: token.colorTextSecondary }}>{t.provider}/{t.model}</div>
                                   <div style={{ fontSize: '10px', color: token.colorTextQuaternary }}>P:{t.promptTokens} / C:{t.completionTokens}{t.cachedTokens ? ` / Ca:${t.cachedTokens}` : ''}</div>
                                 </div>
                                 <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)', color: token.colorTextHeading }}>{t.totalTokens.toLocaleString()}</Typography.Text>
                               </Flex>
                             ))}
                           </Flex>
                         ) : (
                           <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>— 无流水 —</Typography.Text>
                         )}
                       </div>

                       {/* Tools Module */}
                       <div style={{ background: token.colorBgContainer, padding: 'var(--nb-spacing-md)', borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
                         <Flex align="center" gap={8} style={{ marginBottom: 12, opacity: 0.85 }}>
                           <ApiOutlined style={{ color: '#1677ff' }} />
                           <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', fontWeight: 600, letterSpacing: '0.04em' }}>内部执行工具 (TOOLS)</Typography.Text>
                         </Flex>
                         {Object.keys(metrics.tools || {}).length > 0 ? (
                           <Flex wrap="wrap" gap={6}>
                             {Object.entries(metrics.tools || {}).map(([t, c]) => (
                               <div key={t} style={{ background: token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}`, padding: '4px 10px', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                                 <Typography.Text style={{ fontSize: 'var(--nb-text-xs)' }}>{t}</Typography.Text>
                                 <Tag color="blue" bordered={false} style={{ margin: 0, minWidth: 24, textAlign: 'center' }}>{c}</Tag>
                               </div>
                             ))}
                           </Flex>
                         ) : (
                           <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>— 无记录 —</Typography.Text>
                         )}
                       </div>

                       {/* MCPs Module */}
                       <div style={{ background: token.colorBgContainer, padding: 'var(--nb-spacing-md)', borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
                         <Flex align="center" gap={8} style={{ marginBottom: 12, opacity: 0.85 }}>
                           <DatabaseOutlined style={{ color: '#2f54eb' }} />
                           <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', fontWeight: 600, letterSpacing: '0.04em' }}>外联跨端节点 (MCP)</Typography.Text>
                         </Flex>
                         {Object.keys(metrics.mcps || {}).length > 0 ? (
                           <Flex wrap="wrap" gap={6}>
                             {Object.entries(metrics.mcps || {}).map(([m, c]) => (
                               <div key={m} style={{ background: token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}`, padding: '4px 10px', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                                 <Typography.Text style={{ fontSize: 'var(--nb-text-xs)' }}>{m}</Typography.Text>
                                 <Tag color="geekblue" bordered={false} style={{ margin: 0, minWidth: 24, textAlign: 'center' }}>{c}</Tag>
                               </div>
                             ))}
                           </Flex>
                         ) : (
                           <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>— 无记录 —</Typography.Text>
                         )}
                       </div>

                       {/* KB Module */}
                       <div style={{ background: token.colorBgContainer, padding: 'var(--nb-spacing-md)', borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
                         <Flex align="center" gap={8} style={{ marginBottom: 12, opacity: 0.85 }}>
                           <DatabaseOutlined style={{ color: '#13c2c2' }} />
                           <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', fontWeight: 600, letterSpacing: '0.04em' }}>知识检索引擎 (KB)</Typography.Text>
                         </Flex>
                         {Object.keys(metrics.knowledge || {}).length > 0 ? (
                           <Flex wrap="wrap" gap={6}>
                             {Object.entries(metrics.knowledge || {}).map(([k, c]) => (
                               <div key={k} style={{ background: token.colorFillAlter, border: `1px solid ${token.colorBorderSecondary}`, padding: '4px 10px', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                                 <Typography.Text style={{ fontSize: 'var(--nb-text-xs)' }}>{k}</Typography.Text>
                                 <Tag color="cyan" bordered={false} style={{ margin: 0, minWidth: 24, textAlign: 'center' }}>{c}</Tag>
                               </div>
                             ))}
                           </Flex>
                         ) : (
                           <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>— 无记录 —</Typography.Text>
                         )}
                       </div>
                     </div>
                   </div>
                 )
               })}
             </Flex>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>暂无分析数据</Typography.Text>
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
