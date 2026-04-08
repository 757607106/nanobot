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
        title="知识库目录"
        action={<span className="console-inline-code">{`${visibleKnowledgeBases.length}/${knowledgeBases.length}`}</span>}
      >
        <Flex vertical gap={16}>
          <Input
            placeholder="搜索知识库、标签或描述"
            value={knowledgeSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            prefix={<SearchOutlined />}
            allowClear
            aria-label="搜索知识库"
          />

          {loading ? (
            <Flex justify="center" align="center" className="knowledge-list-loading">
              <Spin tip="正在加载知识库目录..."><div /></Spin>
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
                    className={`knowledge-nav-item ${isSelected ? 'active' : ''}`}
                  >
                    <div className="knowledge-nav-item-head" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          background: `hsl(${(item.name.charCodeAt(0) || 65) * 137 % 360}, 65%, 55%)`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: 'var(--nb-text-lg)',
                          fontWeight: 'var(--nb-font-weight-strong)',
                          flexShrink: 0,
                        }}
                      >
                        {item.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Typography.Text
                          strong
                          className="knowledge-nav-item-title"
                          style={{ color: isSelected ? token.colorPrimary : undefined, fontSize: 'var(--nb-text-sm)', display: 'block' }}
                        >
                          {item.name}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                          {item.enabled ? '检索可用' : '已停用'} · {item.stats?.fileCount || 0} 文件 · {item.stats?.indexedCount || 0} 已索引
                        </Typography.Text>
                      </div>
                      <Tag
                        color={item.enabled ? 'success' : 'default'}
                        style={{ margin: 0, fontSize: 'var(--nb-text-2xs)' }}
                      >
                        {item.enabled ? '启用' : '停用'}
                      </Tag>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </Flex>
      </SectionCard>
    </div>
  )
}
