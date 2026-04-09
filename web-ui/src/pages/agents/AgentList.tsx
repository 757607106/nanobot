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
  onUpdateDescription: (agentId: string, description: string) => void
  onUpdateRole: (agentId: string, role: string) => void
  onRefresh: () => void
}

export default function AgentList({
  agents,
  loadingWorkspace,
  error,
  selectedAgentId,
  onUpdateDescription,
  onUpdateRole,
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
          <Typography.Title level={3} style={{ margin: 0, fontWeight: 'var(--nb-font-weight-title)' }}>
            数字员工大厅
          </Typography.Title>
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
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
          gap: 20,
        }}>
          {filteredAgents.map((record, index) => {
            const avatar = getAgentAvatar(record.agentId, record.name, record.description, record.tags)
            const displayRole = record.tags?.[0] || avatar.label
            return (
              <motion.div
                key={record.agentId}
                initial={{ opacity: 0, scale: 0.85, y: 30 }}
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
                        scale: 1.05,
                        y: -16, 
                        rotate: 3, 
                        boxShadow: `0 32px 64px -12px var(--nb-surface-panel-shadow), 0 0 0 2px ${avatar.color}`,
                      }
                    : {
                        scale: 1.02,
                        y: -4, 
                        boxShadow: '0 12px 24px -8px var(--nb-surface-panel-shadow)',
                      } // 空闲状态仅仅微小悬浮，绝不旋转跳跃
                }
                onClick={() => navigate(`/studio/agents/${record.agentId}`)}
                style={{
                  cursor: 'pointer',
                  background: 'var(--nb-surface-panel-bg)',
                  backdropFilter: 'blur(20px) saturate(140%)',
                  borderRadius: 'var(--nb-radius-lg)',
                  boxShadow: 'inset 0 0 0 1px var(--nb-surface-panel-border), var(--nb-surface-panel-shadow)',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  paddingBottom: 24,
                  marginTop: 16,
                  transition: 'background 0.3s ease',
                  transformOrigin: 'bottom center',
                }}
              >
                {/* ━━━ 顶部修饰横幅 (Elegant Banner) ━━━ */}
                <div style={{
                  height: 52,
                  width: '100%',
                  background: avatar.gradient,
                  opacity: record.enabled ? 0.85 : 0.5,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  zIndex: 0,
                  transition: 'all 0.3s ease',
                }}>
                  {/* 为空闲状态添加斜纹标识（特殊的休眠纹理） */}
                  {!record.enabled && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.1) 10px, rgba(255,255,255,0.1) 20px)',
                    }} />
                  )}
                </div>

                {/* ━━━ 区分度极高的状态胶囊 (Glassmorphic Status Badge) ━━━ */}
                <div style={{
                  position: 'absolute',
                  top: 14,
                  right: 14,
                  zIndex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--nb-surface-panel-bg)',
                  backdropFilter: 'blur(12px)',
                  padding: '3px 10px',
                  borderRadius: 20,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                  border: '1px solid var(--nb-surface-panel-border)'
                }}>
                  {record.enabled ? (
                    <motion.div
                      animate={{ opacity: [1, 0.2, 1], scale: [1, 1.4, 1] }}
                      transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: token.colorSuccess,
                        boxShadow: `0 0 8px ${token.colorSuccess}`,
                      }}
                    />
                  ) : (
                    // 咖啡/休整特殊标识符号
                    <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--nb-muted)' }}>
                      <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
                      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
                      <line x1="6" y1="1" x2="6" y2="4"></line>
                      <line x1="10" y1="1" x2="10" y2="4"></line>
                      <line x1="14" y1="1" x2="14" y2="4"></line>
                    </svg>
                  )}
                  <Typography.Text style={{
                    fontSize: 'var(--nb-text-2xs)',
                    fontWeight: 'var(--nb-font-weight-strong)',
                    color: record.enabled ? 'var(--nb-ink)' : 'var(--nb-muted)',
                  }}>
                    {record.enabled ? '工作中' : '空闲'}
                  </Typography.Text>
                </div>

                {/* ━━━ 真身旋转跳跃 (Lifelike Avatar Jump & Spin) ━━━ */}
                <motion.div
                  animate={
                    record.enabled 
                      ? { 
                          y: [0, -20, 0], // 更大的纵向跃起幅度
                          rotate: [0, -15, 15, 0], // 强烈的左右扭转（真·旋转）
                        } 
                      : { y: 0, rotate: 0 } // 空闲时锁定不动
                  }
                  // 加快了 duration 并且加上了一点张力时间，让它看起来不是在潜水，而是在蹦跶
                  transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut', delay: index * 0.1 }}
                  whileHover={
                    record.enabled ? { rotate: 360, scale: 1.1, transition: { duration: 0.6, type: 'spring' } } : {}
                  }
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: 'var(--nb-surface-panel-bg)',
                    marginTop: 20,
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 4,
                    boxShadow: record.enabled ? `0 12px 30px -4px ${avatar.color}90` : '0 4px 12px rgba(0,0,0,0.05)',
                    border: `1px solid var(--nb-surface-panel-border)`,
                  }}
                >
                  <img
                    src={avatar.src}
                    alt={avatar.label}
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      background: avatar.gradient,
                      opacity: record.enabled ? 1 : 0.8, // 仅用轻微透明度虚化
                    }}
                  />
                </motion.div>

                {/* ━━━ 完美字体的员工信息 (Typography-perfect Identity) ━━━ */}
                <div style={{ textAlign: 'center', marginTop: 14, zIndex: 1, padding: '0 20px', width: '100%' }}>
                  <Typography.Text
                    strong
                    ellipsis
                    style={{
                      fontSize: 'var(--nb-text-lg)',
                      display: 'block',
                      color: 'var(--nb-ink)',
                      fontWeight: 'var(--nb-font-weight-strong)',
                    }}
                  >
                    {record.name}
                  </Typography.Text>
                  
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4 }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: avatar.color }} />
                    <Typography.Text
                      style={{
                        fontSize: 'var(--nb-text-xs)',
                        color: 'var(--nb-muted)',
                        fontWeight: 'var(--nb-font-weight-medium)',
                        lineHeight: 1.2,
                        margin: 0,
                        display: 'inline-block'
                      }}
                    >
                      {displayRole}
                    </Typography.Text>
                  </div>
                </div>
                
                {/* ━━━ 一句话描述 (Subtle Description) ━━━ */}
                <Typography.Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                  style={{ 
                    textAlign: 'center', 
                    margin: '12px 24px 0', 
                    fontSize: 'var(--nb-text-xs)',
                    lineHeight: 1.6, 
                    flex: 1 
                  }}
                >
                  {record.description || '一位神秘的 AI 员工，暂无背景介绍。'}
                </Typography.Paragraph>

                {/* ━━━ 轻量级技能胶囊 (Lightweight Pills) ━━━ */}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: 20, padding: '0 20px' }}>
                  {(record.tags || []).slice(0, 3).map((tag, i) => (
                    <Tag
                      key={i}
                      bordered={false}
                      style={{
                        borderRadius: 16,
                        padding: '1px 12px',
                        fontSize: 'var(--nb-text-2xs)',
                        background: `${avatar.color}10`,
                        color: avatar.color,
                        fontWeight: 'var(--nb-font-weight-medium)',
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
                        borderRadius: 16,
                        padding: '1px 12px',
                        fontSize: 'var(--nb-text-2xs)',
                        background: 'var(--nb-layout-bg)',
                        color: 'var(--nb-muted)',
                        margin: 0,
                      }}
                    >
                      +{record.tags.length - 3}
                    </Tag>
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
