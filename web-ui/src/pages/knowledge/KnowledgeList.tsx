import { motion } from 'framer-motion'
import { Button, Empty, Flex, Input, Spin, Tag, Typography, theme } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
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
          <Flex justify="space-between" align="center" className="knowledge-list-head">
            <Typography.Title level={5} className="knowledge-list-head-title">
              知识库目录
            </Typography.Title>
            <Typography.Text type="secondary" className="knowledge-list-head-count">
              {`显示 ${visibleKnowledgeBases.length} / ${knowledgeBases.length}`}
            </Typography.Text>
          </Flex>

          <div className="knowledge-list-search-shell">
            <Input
              placeholder="搜索知识库、标签..."
              value={knowledgeSearch}
              onChange={(event) => onSearchChange(event.target.value)}
              prefix={<SearchOutlined className="knowledge-list-search-icon" />}
              allowClear
              variant="filled"
              className="knowledge-list-search-input"
              aria-label="搜索知识库"
            />
          </div>

          {loading ? (
            <Flex justify="center" align="center" className="knowledge-list-loading">
              <Spin tip="正在加载知识库目录..." size="large">
                <div style={{ width: 1, height: 1 }} />
              </Spin>
            </Flex>
          ) : visibleKnowledgeBases.length === 0 ? (
            <Empty
              image={false} className="minimal-empty"
              description={knowledgeBases.length === 0 ? '还没有知识库' : '无匹配项'}
            >
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => startTransition(() => navigate('/knowledge/new'))}
              >
                新建知识库
              </Button>
            </Empty>
          ) : (
            <div className="knowledge-nav-list">
              {visibleKnowledgeBases.map((item, index) => {
                const isSelected = item.kbId === selectedKbId
                const hue = ((item.name.charCodeAt(0) || 65) * 137) % 360
                return (
                  <motion.button
                    key={item.kbId}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    type="button"
                    onClick={() => startTransition(() => navigate(`/knowledge/${item.kbId}`))}
                    className={`knowledge-card ${isSelected ? 'is-selected' : ''}`}
                    aria-label={`进入 ${item.name} 知识库`}
                  >
                    <div className="knowledge-card-header">
                      <div
                        className="knowledge-card-avatar"
                        style={{
                          background: `oklch(0.66 0.14 ${hue})`,
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
                        <span className="stat-label">已入库</span>
                      </div>
                    </div>
                  </motion.button>
                )
              })}

              <motion.button
                key="create-knowledge"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(visibleKnowledgeBases.length, 6) * 0.04 }}
                type="button"
                onClick={() =>
                  startTransition(() => navigate('/knowledge/new'))
                }
                className="knowledge-card is-create focus-ring"
                aria-label="新建知识库"
              >
                <div className="knowledge-card-create-icon" aria-hidden>
                  <PlusOutlined />
                </div>
                <div className="knowledge-card-body">
                  <Typography.Text strong className="knowledge-card-title">
                    新建知识库
                  </Typography.Text>
                  <Typography.Paragraph type="secondary" className="knowledge-card-desc" ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                    导入语料，生成索引，让员工获得可检索的专属知识
                  </Typography.Paragraph>
                </div>
              </motion.button>
            </div>
          )}
      </Flex>
    </div>
  )
}
