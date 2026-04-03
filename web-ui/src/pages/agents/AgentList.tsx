import { useMemo, useState } from 'react'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Input, Spin, Typography, theme } from 'antd'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import PageHeader from '../../components/console/PageHeader'
import type { AgentDefinition } from '../../types'

interface AgentListProps {
  agents: AgentDefinition[]
  loadingWorkspace: boolean
  error: string | null
  selectedAgentId: string | null
  onRefresh: () => void
}

export default function AgentList({
  agents,
  loadingWorkspace,
  error,
  selectedAgentId,
  onRefresh,
}: AgentListProps) {
  const navigate = useNavigate()
  const { token } = theme.useToken()
  const [searchQuery, setSearchQuery] = useState('')

  const filteredAgents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return agents
    return agents.filter((item) => {
      const haystack = [
        item.name,
        item.description,
        item.agentId,
        item.tags.join(' '),
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [agents, searchQuery])

  return (
    <Flex vertical gap={12}>
      <PageHeader
        title="Agent Studio"
        actions={(
          <Flex gap={8} wrap="wrap">
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loadingWorkspace} size="small" />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/studio/agents/new')}
              size="small"
              style={{ borderRadius: 10 }}
            >
              新建
            </Button>
          </Flex>
        )}
      />

      <Input
        placeholder="搜索 Agent..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
        allowClear
        style={{ borderRadius: 10, background: 'var(--nb-card-subtle-bg)', border: 'none' }}
      />

      {error && !selectedAgentId ? <Alert type="error" message={error} showIcon /> : null}

      {loadingWorkspace && agents.length === 0 ? (
        <Flex justify="center" align="center" style={{ minHeight: 120 }}>
          <Spin />
        </Flex>
      ) : filteredAgents.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配 Agent" />
      ) : (
        <div className="resource-rail-list">
          {filteredAgents.map((record, index) => {
            const isSelected = selectedAgentId === record.agentId
            return (
              <motion.div
                key={record.agentId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.15 }}
                onClick={() => navigate(`/studio/agents/${record.agentId}`)}
                className={`resource-rail-item ${isSelected ? 'is-selected' : ''}`}
              >
                <Flex align="center" gap={8} style={{ minWidth: 0 }}>
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: record.enabled
                        ? token.colorSuccess
                        : token.colorTextQuaternary,
                      boxShadow: record.enabled
                        ? `0 0 6px ${token.colorSuccess}80`
                        : 'none',
                    }}
                  />
                  <Typography.Text
                    strong
                    ellipsis
                    style={{ flex: 1, minWidth: 0, fontSize: 14 }}
                  >
                    {record.name}
                  </Typography.Text>
                </Flex>
                <Typography.Text
                  type="secondary"
                  ellipsis
                  style={{
                    fontSize: 12,
                    marginTop: 4,
                    display: 'block',
                    paddingLeft: 15,
                    lineHeight: 1.5,
                  }}
                >
                  {record.description || '暂无描述'}
                </Typography.Text>
              </motion.div>
            )
          })}
        </div>
      )}
    </Flex>
  )
}
