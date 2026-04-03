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

  const avatarColors = [
    'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 99%, #FECFEF 100%)',
    'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)',
    'linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)',
    'linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)',
    'linear-gradient(120deg, #fccb90 0%, #d57eeb 100%)',
    'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)',
  ]

  const getGradientForId = (id: string) => {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash)
    }
    return avatarColors[Math.abs(hash) % avatarColors.length]
  }

  const getInitials = (name: string) => {
    return name.trim().substring(0, 2).toUpperCase() || 'A'
  }

  return (
    <Flex vertical gap={24} style={{ padding: '32px max(24px, calc((100% - var(--nb-content-max-width)) / 2))' }}>
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
                  padding: 'var(--nb-spacing-md)',
                  boxShadow: 'inset 0 0 0 1px var(--nb-surface-panel-border), var(--nb-surface-panel-shadow)',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: 'var(--nb-radius-md)',
                    background: getGradientForId(record.agentId),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(0,0,0,0.6)',
                    fontWeight: 800,
                    fontSize: 18,
                    boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.4)',
                    flexShrink: 0
                  }}>
                    {getInitials(record.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
                    <Typography.Text strong ellipsis style={{ fontSize: 'var(--nb-text-md)', display: 'block', color: 'var(--nb-ink)' }}>
                      {record.name}
                    </Typography.Text>
                    <Typography.Text type="secondary" ellipsis style={{ fontSize: 13 }}>
                      {record.model || '未设定引擎'}
                    </Typography.Text>
                  </div>
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
                
                <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0, fontSize: 13, lineHeight: 1.6, flex: 1 }}>
                  {record.description || '一位神秘的 AI 员工，暂无背景介绍。'}
                </Typography.Paragraph>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                  {(record.tags || []).slice(0, 3).map((tag, i) => (
                    <div key={i} style={{
                      borderRadius: 'var(--nb-radius-sm)',
                      fontSize: 'var(--nb-text-2xs)',
                      color: 'var(--nb-muted)'
                    }}>
                      {tag}
                    </div>
                  ))}
                  {record.tags && record.tags.length > 3 && (
                    <div style={{
                      padding: '2px 10px',
                      background: 'rgba(0,0,0,0.02)',
                      borderRadius: 12,
                      fontSize: 12,
                      color: 'var(--nb-muted)'
                    }}>
                      +{record.tags.length - 3}
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </Flex>
  )
}
