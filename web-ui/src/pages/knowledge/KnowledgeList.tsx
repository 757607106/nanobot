import { motion } from 'framer-motion'
import { Empty, Flex, Input, Spin, Tag, Typography, theme } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { startTransition } from 'react'
import { useNavigate } from 'react-router-dom'

import type { KnowledgeBaseDefinition } from '../../types'

interface KnowledgeListProps {
  knowledgeBases: KnowledgeBaseDefinition[]
  visibleKnowledgeBases: KnowledgeBaseDefinition[]
  selectedKbId: string | null
  knowledgeSearch: string
  loading: boolean
  onSearchChange: (value: string) => void
}

export default function KnowledgeList({
  knowledgeBases,
  visibleKnowledgeBases,
  selectedKbId,
  knowledgeSearch,
  loading,
  onSearchChange,
}: KnowledgeListProps) {
  const navigate = useNavigate()
  const { token } = theme.useToken()

  return (
    <div className="knowledge-list-container">
        <Flex vertical gap={16}>
          <Flex justify="space-between" align="center" style={{ padding: '0 8px' }}>
            <Typography.Title level={5} style={{ margin: 0, fontSize: 'var(--nb-text-sm)', color: 'var(--nb-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              知识库目录
            </Typography.Title>
            <span className="console-inline-code" style={{ fontSize: 'var(--nb-text-xs)' }}>{`${visibleKnowledgeBases.length}/${knowledgeBases.length}`}</span>
          </Flex>

          <div style={{ padding: '0 4px' }}>
            <Input
              placeholder="搜索知识库、标签..."
              value={knowledgeSearch}
              onChange={(event) => onSearchChange(event.target.value)}
              prefix={<SearchOutlined style={{ color: 'var(--nb-text-tertiary)', fontSize: 'var(--nb-text-xs)' }} />}
              allowClear
              variant="filled"
              style={{ borderRadius: 8, padding: '4px 12px', fontSize: 'var(--nb-text-xs)' }}
              aria-label="搜索知识库"
            />
          </div>

          {loading ? (
            <Flex justify="center" align="center" className="knowledge-list-loading">
              <Spin tip="正在加载知识库目录..." size="large" />
            </Flex>
          ) : visibleKnowledgeBases.length === 0 ? (
            <Empty
              image={false} className="minimal-empty"
              description="无匹配项"
            />
          ) : (
            <div className="knowledge-nav-list">
              {visibleKnowledgeBases.map((item, index) => {
                const isSelected = item.kbId === selectedKbId
                return (
                  <motion.div
                    key={item.kbId}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    onClick={() => startTransition(() => navigate(`/knowledge/${item.kbId}`))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        startTransition(() => navigate(`/knowledge/${item.kbId}`))
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`knowledge-card ${isSelected ? 'is-selected' : ''}`}
                    aria-label={`进入 ${item.name} 知识库`}
                  >
                    <div className="knowledge-card-header">
                      <div
                        className="knowledge-card-avatar"
                        style={{
                          background: `hsl(${(item.name.charCodeAt(0) || 65) * 137 % 360}, 65%, 55%)`,
                        }}
                      >
                        {item.name.charAt(0).toUpperCase()}
                      </div>
                      <Tag
                        color={item.enabled ? 'success' : 'default'}
                        bordered={false}
                        className="knowledge-card-status"
                      >
                        {item.enabled ? '已启用' : '已停用'}
                      </Tag>
                    </div>
                    
                    <div className="knowledge-card-body">
                      <Typography.Text
                        strong
                        className="knowledge-card-title"
                        style={{ color: isSelected ? token.colorPrimary : undefined }}
                      >
                        {item.name}
                      </Typography.Text>
                      <Typography.Paragraph type="secondary" className="knowledge-card-desc" ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                        {item.description || '暂无描述'}
                      </Typography.Paragraph>
                    </div>
                    
                    <div className="knowledge-card-footer">
                      <div className="knowledge-card-stat">
                        <span className="stat-value">{item.stats?.fileCount || 0}</span>
                        <span className="stat-label">文件</span>
                      </div>
                      <div className="knowledge-card-stat">
                        <span className="stat-value">{item.stats?.indexedCount || 0}</span>
                        <span className="stat-label">已索引</span>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </Flex>
    </div>
  )
}
