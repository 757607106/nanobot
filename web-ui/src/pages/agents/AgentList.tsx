import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import { ArrowRightOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Input, Spin, Tag, Typography, theme } from 'antd'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { AgentDefinition } from '../../types'
import { getAgentAvatar } from '../../avatarConfig'

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
    <Flex vertical gap="var(--nb-spacing-xl)">
      <Flex align="center" justify="space-between" wrap="wrap" gap="var(--nb-spacing-md)">
        <div style={{ minWidth: 0 }}>
          <Typography.Title level={3} style={{ margin: 0, fontWeight: 'var(--nb-font-weight-title)' }}>
            数字员工大厅
          </Typography.Title>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 2 }}>
            创建、编排并调试数字员工的角色与能力
          </Typography.Text>
        </div>
        <Flex gap="var(--nb-spacing-sm)" align="center" wrap="wrap">
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
            style={{ borderRadius: 12, fontWeight: 'var(--nb-font-weight-medium)' }}
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
            const displayRole = record.tags?.[0] || avatar.label
            const isSelected = record.agentId === selectedAgentId
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
                    ['--agent-color' as any]: avatar.color,
                    ['--agent-gradient' as any]: avatar.gradient,
                  } as CSSProperties
                }
              >
                <div className="agent-tile-media">
                  <img
                    src={avatar.src}
                    alt={avatar.label}
                    className="agent-tile-media-image"
                    style={{ opacity: record.enabled ? 1 : 0.78 }}
                  />
                  <div className="agent-tile-media-overlay" />
                  <div className="agent-tile-media-head">
                    <Tag bordered={false} className="agent-tile-role-chip">
                      {displayRole}
                    </Tag>
                    <div className={`agent-tile-status ${record.enabled ? 'is-active' : 'is-idle'}`}>
                      <div className="agent-tile-status-dot" aria-hidden />
                      <span>{record.enabled ? '工作中' : '空闲'}</span>
                    </div>
                  </div>
                </div>

                <div className="agent-tile-body">
                  <div style={{ minWidth: 0 }}>
                  <Typography.Text
                    strong
                    ellipsis
                    className="agent-tile-name"
                    style={{ display: 'block' }}
                  >
                    {record.name}
                  </Typography.Text>

                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                    className="agent-tile-desc"
                  >
                    {record.description || '负责特定业务场景的数字员工，可独立完成连续任务。'}
                  </Typography.Paragraph>
                  </div>

                  <div className="agent-tile-tags">
                    {(record.tags || []).slice(0, 3).map((tag, i) => (
                      <Tag
                        key={i}
                        bordered={false}
                        className="agent-tile-tag"
                        style={{ margin: 0 }}
                      >
                        {tag}
                      </Tag>
                    ))}
                    {record.tags && record.tags.length > 3 && (
                      <Tag
                        bordered={false}
                        className="agent-tile-tag is-more"
                        style={{ margin: 0 }}
                      >
                        +{record.tags.length - 3}
                      </Tag>
                    )}
                  </div>

                  <div className="agent-tile-foot">
                    <Typography.Text type="secondary" className="agent-tile-footnote">
                      工号 · {record.agentId.slice(0, 10)}
                    </Typography.Text>
                    <Button
                      type="text"
                      size="small"
                      className="agent-tile-action"
                      onClick={(event) => {
                        event.stopPropagation()
                        navigate(`/studio/agents/${record.agentId}`)
                      }}
                    >
                      进入工位 <ArrowRightOutlined />
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
