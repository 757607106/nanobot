import { motion } from 'framer-motion'
import { Empty, Flex, Input, Spin, Tag, Typography, theme } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { startTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionCard from '../../components/console/SectionCard'
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
      <SectionCard
        title="知识库列表"
        description="筛选并切换知识库。"
        action={<Tag>{`${visibleKnowledgeBases.length}/${knowledgeBases.length}`}</Tag>}
      >
        <Flex vertical gap={16}>
          <Input
            placeholder="搜索知识库"
            value={knowledgeSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            prefix={<SearchOutlined />}
            allowClear
            aria-label="搜索知识库"
          />

          {loading ? (
            <Flex justify="center" align="center" className="knowledge-list-loading">
              <Spin tip="正在加载知识库目录..." />
            </Flex>
          ) : visibleKnowledgeBases.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="当前没有匹配的知识库。"
            />
          ) : (
            <Flex vertical gap={12}>
              {visibleKnowledgeBases.map((item, index) => {
                const isSelected = item.kbId === selectedKbId
                return (
                  <motion.div
                    key={item.kbId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)' }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => startTransition(() => navigate(`/knowledge/${item.kbId}`))}
                    className={`knowledge-list-item ${isSelected ? 'selected' : ''}`}
                  >
                    <Flex vertical gap={10}>
                      <Typography.Text
                        strong
                        className="knowledge-list-item-title"
                        style={{ color: isSelected ? token.colorPrimary : undefined }}
                      >
                        {item.name}
                      </Typography.Text>
                      <Typography.Paragraph
                        ellipsis={{ rows: 2 }}
                        className="knowledge-list-item-desc"
                      >
                        {item.description || '暂无描述'}
                      </Typography.Paragraph>
                      <div className="knowledge-list-item-meta">
                        <span className="knowledge-list-item-count">{`${item.stats?.fileCount || 0} 文件`}</span>
                        <Tag
                          color={item.enabled ? 'success' : 'default'}
                          className="knowledge-list-item-status"
                        >
                          {item.enabled ? '启用' : '停用'}
                        </Tag>
                      </div>
                    </Flex>
                  </motion.div>
                )
              })}
            </Flex>
          )}
        </Flex>
      </SectionCard>
    </div>
  )
}
