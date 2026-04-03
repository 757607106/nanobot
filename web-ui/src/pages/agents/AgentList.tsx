import { useMemo, useState } from 'react'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Input, Space, Spin, Tag, Typography, theme } from 'antd'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import SectionCard from '../../components/console/SectionCard'
import PageHeader from '../../components/console/PageHeader'
import MetricCard from '../../components/console/MetricCard'
import { formatDateTimeZh } from '../../locale'
import type { AgentDefinition, AgentRunSummary, KnowledgeBaseDefinition } from '../../types'

interface AgentListProps {
  agents: AgentDefinition[]
  knowledgeBases: KnowledgeBaseDefinition[]
  recentRuns: AgentRunSummary[]
  loadingWorkspace: boolean
  error: string | null
  selectedAgentId: string | null
  onRefresh: () => void
}

export default function AgentList({
  agents,
  knowledgeBases,
  recentRuns,
  loadingWorkspace,
  error,
  selectedAgentId,
  onRefresh,
}: AgentListProps) {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const [searchQuery, setSearchQuery] = useState('')

  const enabledCount = useMemo(() => agents.filter((item) => item.enabled).length, [agents])

  const filteredAgents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return agents
    }
    return agents.filter((item) => {
      const haystack = [
        item.name,
        item.description,
        item.agentId,
        item.tags.join(' '),
        item.binding || '',
        item.model || '',
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [agents, searchQuery])

  return (
    <Flex vertical gap={24}>
      <PageHeader
        title="Agent Studio"
        subtitle="员工目录、配置、记忆和试运行。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loadingWorkspace}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/studio/agents/new')} style={{ borderRadius: 12 }}>
              创建新员工
            </Button>
          </Space>
        )}
      />

      <div
        className="console-metrics-grid"
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <MetricCard
          label="员工总数"
          value={agents.length}
          helper="当前实例内可管理的数字员工数量。"
          icon={null}
        />
        <MetricCard
          label="启用中"
          value={enabledCount}
          helper="当前处于启用状态、可参与调度的员工数。"
          icon={null}
          tone="success"
        />
        <MetricCard
          label="最近执行"
          value={recentRuns.length}
          helper="当前选中员工最近抓取到的执行记录条数。"
          icon={null}
          tone="warning"
        />
        <MetricCard
          label="可用知识库"
          value={knowledgeBases.length}
          helper="当前工作区可绑定给员工的知识库数量。"
          icon={null}
          tone="neutral"
        />
      </div>

      <SectionCard title="员工目录" description="选择员工进入详情区。">
        <Flex vertical gap={16}>
          <Input
            size="large"
            placeholder="搜索员工"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
            allowClear
            style={{ borderRadius: 12, background: 'var(--nb-card-subtle-bg)', border: 'none' }}
          />

          {error && !selectedAgentId ? <Alert type="error" message={error} showIcon /> : null}

          {loadingWorkspace && agents.length === 0 ? (
            <Flex justify="center" align="center" style={{ minHeight: 220 }}>
              <Spin tip="正在加载员工目录..." />
            </Flex>
          ) : filteredAgents.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前搜索条件下没有找到员工。" />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 16,
              }}
            >
              {filteredAgents.map((record, index) => {
                const isSelected = selectedAgentId === record.agentId
                return (
                  <motion.div
                    key={record.agentId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)' }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigate(`/studio/agents/${record.agentId}`)}
                    style={{
                      background: isSelected ? 'var(--nb-card-subtle-bg)' : 'transparent',
                      border: `1px solid ${isSelected ? 'var(--nb-accent)' : 'var(--nb-card-subtle-border)'}`,
                      boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.03)' : 'none',
                      borderRadius: 16,
                      padding: 20,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 140,
                      transition: 'background 0.2s, border-color 0.2s',
                    }}
                  >
                    <Flex justify="space-between" align="flex-start" gap={12}>
                      <Flex vertical gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Flex align="center" gap={8} wrap="wrap">
                          <Typography.Text strong style={{ fontSize: 16 }}>
                            {record.name}
                          </Typography.Text>
                          {record.tags[0] && <Tag style={{ margin: 0, borderRadius: 10, border: 'none', background: 'var(--nb-card-subtle-bg)' }}>{record.tags[0]}</Tag>}
                        </Flex>
                        <Typography.Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ margin: 0, fontSize: 13 }}>
                          {record.description || record.agentId}
                        </Typography.Paragraph>
                      </Flex>
                    </Flex>
                    
                    <div style={{ flex: 1 }} />
                    
                    <Flex justify="space-between" align="center" style={{ marginTop: 16 }} wrap="wrap" gap={8}>
                      <Space size={8} wrap>
                        <Tag color={record.enabled ? 'success' : 'default'} style={{ border: 'none', borderRadius: 10 }}>
                          {record.enabled ? '已启用' : '已停用'}
                        </Tag>
                        <Tag style={{ border: 'none', background: 'transparent', padding: 0 }}>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {record.binding || record.model || '默认绑定'}
                          </Typography.Text>
                        </Tag>
                      </Space>
                      {record.updatedAt && (
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          {formatDateTimeZh(record.updatedAt)}
                        </Typography.Text>
                      )}
                    </Flex>
                  </motion.div>
                )
              })}
            </div>
          )}
        </Flex>
      </SectionCard>
    </Flex>
  )
}
