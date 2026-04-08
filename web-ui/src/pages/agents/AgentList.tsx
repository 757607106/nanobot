import { useMemo, useState } from 'react'
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
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
    <Flex vertical gap={24}>
      <Flex align="center" justify="space-between" wrap="wrap" gap={16}>
        <div>
          <Typography.Title level={3} style={{ margin: 0, fontWeight: 700 }}>
            数字员工大厅
          </Typography.Title>
          <Typography.Text type="secondary">
            管理并配置您的企业专属 AI Agent 团队
          </Typography.Text>
        </div>
        <Flex gap={12} align="center">
          <Input
            placeholder="搜索员工..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
            allowClear
            style={{ 
              borderRadius: 12, 
              background: 'var(--nb-card-subtle-bg)', 
              backdropFilter: 'blur(10px)',
              border: '1px solid var(--nb-card-subtle-border)',
              width: 250,
              boxShadow: 'var(--nb-shadow-soft)'
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loadingWorkspace} shape="circle" size="large" />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/studio/agents/new')}
            size="large"
            style={{ borderRadius: 12, fontWeight: 500 }}
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
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 24,
        }}>
          {filteredAgents.map((record, index) => {
            const avatar = getAgentAvatar(record.agentId, record.name, record.description, record.tags)
            return (
              <motion.div
                key={record.agentId}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: index * 0.04, duration: 0.2 }}
                whileHover={{ scale: 1.02, y: -4 }}
                onClick={() => navigate(`/studio/agents/${record.agentId}`)}
                style={{
                  cursor: 'pointer',
                  background: 'var(--nb-surface-panel-bg)',
                  backdropFilter: 'blur(16px) saturate(140%)',
                  borderRadius: 'var(--nb-radius-lg)',
                  boxShadow: 'inset 0 0 0 1px var(--nb-surface-panel-border), var(--nb-surface-panel-shadow)',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* ━━━ 顶部色带 ━━━ */}
                <div style={{
                  height: 6,
                  background: avatar.gradient,
                  borderRadius: 'var(--nb-radius-lg) var(--nb-radius-lg) 0 0',
                }} />

                {/* ━━━ 卡片主体 ━━━ */}
                <div style={{ padding: '20px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                  {/* 头像 + 名称 + 状态灯 */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    {/* 卡通头像 */}
                    <div style={{
                      width: 56,
                      height: 56,
                      borderRadius: 16,
                      background: `${avatar.gradient}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      boxShadow: `0 4px 14px -2px ${avatar.color}33`,
                      padding: 3,
                    }}>
                      <img
                        src={avatar.src}
                        alt={avatar.label}
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: 13,
                          objectFit: 'cover',
                        }}
                      />
                    </div>

                    {/* 名称 + 职称 */}
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                      <Typography.Text
                        strong
                        ellipsis
                        style={{
                          fontSize: 'var(--nb-text-md)',
                          display: 'block',
                          color: 'var(--nb-ink)',
                          fontWeight: 700,
                        }}
                      >
                        {record.name}
                      </Typography.Text>
                      <Typography.Text
                        style={{
                          fontSize: 13,
                          color: avatar.color,
                          fontWeight: 500,
                          display: 'block',
                          marginTop: 2,
                        }}
                      >
                        {avatar.label}
                      </Typography.Text>
                    </div>

                    {/* 在线状态灯 */}
                    <div style={{
                       width: 10,
                       height: 10,
                       borderRadius: '50%',
                       background: record.enabled ? token.colorSuccess : token.colorTextQuaternary,
                       boxShadow: record.enabled ? `0 0 10px ${token.colorSuccess}` : 'none',
                       flexShrink: 0,
                       marginTop: 8
                    }} />
                  </div>
                  
                  {/* 一句话描述 */}
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                    style={{ margin: 0, fontSize: 13, lineHeight: 1.6, flex: 1 }}
                  >
                    {record.description || '一位神秘的 AI 员工，暂无背景介绍。'}
                  </Typography.Paragraph>

                  {/* 技能标签 pills */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                    {(record.tags || []).slice(0, 3).map((tag, i) => (
                      <Tag
                        key={i}
                        bordered={false}
                        style={{
                          borderRadius: 12,
                          padding: '1px 10px',
                          fontSize: 12,
                          background: `${avatar.color}14`,
                          color: avatar.color,
                          fontWeight: 500,
                          margin: 0,
                        }}
                      >
                        {tag}
                      </Tag>
                    ))}
                    {record.tags && record.tags.length > 3 && (
                      <Tag
                        bordered={false}
                        style={{
                          borderRadius: 12,
                          padding: '1px 10px',
                          fontSize: 12,
                          background: 'rgba(0,0,0,0.04)',
                          color: 'var(--nb-muted)',
                          margin: 0,
                        }}
                      >
                        +{record.tags.length - 3}
                      </Tag>
                    )}
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
