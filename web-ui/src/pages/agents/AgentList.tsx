import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import { PlusOutlined, ReloadOutlined, SearchOutlined, MessageOutlined, AppstoreOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Input, Spin, Tag, Typography, theme } from 'antd'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { AgentDefinition } from '../../types'
import { getAgentAvatar } from '../../avatarConfig'
import { resolveToneColor } from '../../ui/kit/tone'

interface AgentListProps {
  agents: AgentDefinition[]
  loadingWorkspace: boolean
  error: string | null
  selectedAgentId: string | null
  onRefresh: () => void
}

function formatNumberLabel(value: number) {
  if (value <= 0) return '--'
  return String(value)
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
    <Flex vertical gap={token.marginXL}>
      <Flex align="center" justify="space-between" wrap gap={token.marginMD}>
        <div style={{ minWidth: 0 }}>
          <Typography.Title level={3} style={{ margin: 0, fontWeight: token.fontWeightStrong }}>
            数字员工大厅
          </Typography.Title>
          <Typography.Text type="secondary" style={{ display: 'block' }}>
            创建、编排数字员工的角色与能力
          </Typography.Text>
        </div>
        <Flex gap={token.marginSM} align="center" wrap>
          <Input
            placeholder="搜索员工..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
            allowClear
            className="agent-list-search"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loadingWorkspace} shape="circle" size="large" />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/studio/agents/new')}
            size="large"
            style={{ borderRadius: token.borderRadiusLG, fontWeight: token.fontWeightStrong }}
          >
            新员工入职
          </Button>
        </Flex>
      </Flex>

      {error ? <Alert type="error" message={error} showIcon /> : null}

      {loadingWorkspace && agents.length === 0 ? (
        <Flex justify="center" align="center" style={{ minHeight: 300 }}>
          <Spin size="large" />
        </Flex>
      ) : filteredAgents.length === 0 ? (
        <Empty
          image="https://gw.alipayobjects.com/zos/antfincdn/ZHrcdLPrvN/empty.svg"
          description="暂无数据"
          style={{ marginTop: 64 }}
        />
      ) : (
        <div className="agent-card-grid">
          {filteredAgents.map((record, index) => {
            const avatar = getAgentAvatar(record.agentId, record.name, record.description, record.tags)
            const agentColor = resolveToneColor(token as any, avatar.tone)
            const displayRole = record.tags?.[0] || avatar.label
            const isSelected = record.agentId === selectedAgentId
            const capabilityCount =
              record.toolAllowlist.length +
              record.skillIds.length +
              record.mcpServerIds.length +
              record.knowledgeBindingIds.length
            return (
              <motion.div
                key={record.agentId}
                initial={{ opacity: 0, scale: 0.98, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{
                  type: 'spring',
                  stiffness: 300,
                  damping: 24,
                  delay: index * 0.05,
                }}
                whileHover={
                  record.enabled
                    ? {
                      y: -4,
                    }
                    : {
                      y: -2,
                    }
                }
                onClick={() => navigate(`/studio/agents/${record.agentId}`)}
                className={`agent-tile ${record.enabled ? '' : 'is-disabled'} ${isSelected ? 'is-selected' : ''}`}
                style={
                  {
                    ['--agent-color' as any]: agentColor,
                  } as CSSProperties
                }
              >
                <div className="agent-tile-cover">
                  <img
                    src={avatar.src}
                    alt={avatar.label}
                    className="agent-tile-cover-image"
                    style={{ opacity: record.enabled ? 1 : 0.78 }}
                  />
                  <div className={`agent-tile-status-badge ${record.enabled ? 'is-active' : 'is-idle'}`}>
                    <div className="agent-tile-status-dot" aria-hidden />
                    <span>{record.enabled ? '工作中' : '空闲'}</span>
                  </div>
                </div>

                <div className="agent-tile-content">
                  <Typography.Text
                    strong
                    ellipsis
                    className="agent-tile-title"
                    style={{ display: 'block' }}
                  >
                    {record.name}
                  </Typography.Text>

                  <div className="agent-tile-tags-row">
                    <Tag bordered={false} className="agent-tile-role-tag">
                      {displayRole}
                    </Tag>
                    {(record.tags || []).slice(0, 1).map((tag, i) => {
                      if (tag === displayRole) return null
                      return (
                        <Tag key={i} bordered={false} className="agent-tile-tag">
                          {tag}
                        </Tag>
                      )
                    })}
                  </div>

                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 1 }}
                    className="agent-tile-desc"
                  >
                    {record.description || '负责特定业务场景的数字员工，可独立完成连续任务。'}
                  </Typography.Paragraph>

                  <div className="agent-tile-footer">
                    <div className="agent-tile-footer-metrics">
                      <span className="agent-tile-footer-metric">
                        <MessageOutlined className="agent-tile-metric-icon" />
                        {formatNumberLabel(capabilityCount)}
                      </span>
                    </div>
                    <Button
                      type="text"
                      className="agent-tile-action-btn"
                      icon={<AppstoreOutlined />}
                      onClick={(event) => {
                        event.stopPropagation()
                        navigate(`/studio/agents/${record.agentId}`)
                      }}
                    >
                      配置
                    </Button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </Flex>
  )
}
