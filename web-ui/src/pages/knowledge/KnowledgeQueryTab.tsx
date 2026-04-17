import { useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Flex,
  Input,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import { SaveOutlined, SearchOutlined } from '@ant-design/icons'
import SectionCard from '../../components/console/SectionCard'
import type { KnowledgeQueryChunk, KnowledgeQueryParams, KnowledgeRetrieveResult } from '../../types'

const { Paragraph, Text } = Typography

interface KnowledgeQueryTabProps {
  queryParams: KnowledgeQueryParams
  queryText: string
  queryLoading: boolean
  queryResult: KnowledgeRetrieveResult | null
  resultView: 'formatted' | 'raw'
  onModeChange: (value: string) => void
  onTopKChange: (value: number) => void
  onChunkTopKChange: (value: number) => void
  onEnableRerankChange: (checked: boolean) => void
  onSaveQueryDefaults: () => void
  onOpenQueryConfig: () => void
  onResultViewChange: (value: 'formatted' | 'raw') => void
  onQueryTextChange: (value: string) => void
  onQuery: (query?: string) => void
}

function getChunkSource(chunk: KnowledgeQueryChunk) {
  return String(chunk.file_path || chunk.filename || chunk.metadata?.source || chunk.reference_id || '未知来源')
}

function getChunkPreview(content?: string, limit = 120) {
  const text = String(content || '').trim()
  if (!text) return '暂无内容'
  return text.length <= limit ? text : `${text.slice(0, limit)}...`
}

function hasMeaningfulMessage(message: string | undefined) {
  const text = String(message || '').trim()
  if (!text) return false
  const normalized = text.toLowerCase()
  if (normalized === 'query processed successfully') {
    return false
  }
  return ![
    'error calling llm',
    'llm error',
    'litellm.',
    'authentication fails',
    'invalid api key',
    'invalid_request_error',
    'deepseekexception',
    'openaierror',
    'badrequesterror',
  ].some((marker) => normalized.includes(marker))
}

function deriveAnswerMessage(result: KnowledgeRetrieveResult | null) {
  const direct = String(result?.message || '').trim()
  if (hasMeaningfulMessage(direct)) {
    return direct
  }
  const chunkFallback = String(result?.data?.chunks?.[0]?.content || '').trim()
  return chunkFallback || null
}

export function KnowledgeQueryTab({
  queryParams,
  queryText,
  queryLoading,
  queryResult,
  resultView,
  onModeChange,
  onTopKChange,
  onChunkTopKChange,
  onEnableRerankChange,
  onSaveQueryDefaults,
  onOpenQueryConfig,
  onResultViewChange,
  onQueryTextChange,
  onQuery,
}: KnowledgeQueryTabProps) {
  const [selectedChunk, setSelectedChunk] = useState<KnowledgeQueryChunk | null>(null)

  const groupedChunks = useMemo(() => {
    const groups = new Map<string, KnowledgeQueryChunk[]>()
    for (const item of queryResult?.data?.chunks || []) {
      const source = getChunkSource(item)
      const current = groups.get(source) || []
      current.push(item)
      groups.set(source, current)
    }
    return Array.from(groups.entries())
      .map(([source, chunks]) => ({ source, chunks }))
      .sort((left, right) => left.source.localeCompare(right.source))
  }, [queryResult])
  const answerMessage = deriveAnswerMessage(queryResult)
  const resultStats = useMemo(() => ({
    chunkCount: queryResult?.data?.chunks?.length || 0,
    fileCount: groupedChunks.length,
    entityCount: queryResult?.data?.entities?.length || 0,
    relationshipCount: queryResult?.data?.relationships?.length || 0,
    referenceCount: queryResult?.data?.references?.length || 0,
  }), [groupedChunks.length, queryResult])

  return (
    <div className="knowledge-tab-panel">
      <SectionCard
        title="检索"
        action={(
          <Space wrap size={[8, 8]}>
            <Button onClick={onOpenQueryConfig}>检索配置</Button>
            <Button icon={<SaveOutlined />} onClick={onSaveQueryDefaults}>
              保存默认参数
            </Button>
          </Space>
        )}
      >
          <div className="knowledge-query-shell">
          <div className="knowledge-query-topbar">
            <Space wrap size={[12, 12]}>
              <div style={{ minWidth: 120 }}>
                <Text type="secondary">检索模式</Text>
                <Select
                  value={queryParams.mode}
                  onChange={onModeChange}
                  options={[
                    { value: 'mix', label: 'Mix' },
                    { value: 'hybrid', label: 'Hybrid' },
                    { value: 'local', label: 'Local' },
                    { value: 'global', label: 'Global' },
                    { value: 'naive', label: 'Naive' },
                  ]}
                  style={{ width: '100%', marginTop: 8 }}
                />
              </div>
              <div style={{ minWidth: 120 }}>
                <Text type="secondary">TopK</Text>
                <InputNumber
                  min={1}
                  max={100}
                  value={queryParams.top_k}
                  onChange={(value) => onTopKChange(Number(value || 10))}
                  style={{ width: '100%', marginTop: 8 }}
                />
              </div>
              <div style={{ minWidth: 120 }}>
                <Text type="secondary">ChunkK</Text>
                <InputNumber
                  min={1}
                  max={100}
                  value={queryParams.chunk_top_k}
                  onChange={(value) => onChunkTopKChange(Number(value || 12))}
                  style={{ width: '100%', marginTop: 8 }}
                />
              </div>
              <div style={{ minWidth: 120 }}>
                <Text type="secondary">结果视图</Text>
                <Segmented
                  value={resultView}
                  onChange={(value) => onResultViewChange(value as 'formatted' | 'raw')}
                  options={[
                    { label: '结构视图', value: 'formatted' },
                    { label: '原始 JSON', value: 'raw' },
                  ]}
                  style={{ marginTop: 8 }}
                />
              </div>
              <div style={{ minWidth: 120 }}>
                <Text type="secondary">结果重排</Text>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch checked={queryParams.enable_rerank} onChange={onEnableRerankChange} />
                  <Text type="secondary">{queryParams.enable_rerank ? '已开启' : '已关闭'}</Text>
                </div>
              </div>
            </Space>

          </div>

          <div className="knowledge-query-compose">
            <Input.TextArea
              value={queryText}
              onChange={(event) => onQueryTextChange(event.target.value)}
              autoSize={{ minRows: 4, maxRows: 8 }}
              placeholder="输入问题"
            />

            <div className="knowledge-query-actions">
              <Button type="primary" icon={<SearchOutlined />} loading={queryLoading} onClick={() => onQuery()}>
                查询知识库
              </Button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="结果"
      >
        {queryResult ? (
          <>
            {/* Console-style inline summary bar - Replacing heavy metric cards */}
            <Flex className="knowledge-summary-bar" align="center" gap={32} wrap="wrap" style={{ marginBottom: 32, paddingBottom: 16, borderBottom: '1px solid var(--nb-border)' }}>
              <Flex vertical gap={4} style={{ minWidth: 100 }}>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>回答状态</Typography.Text>
                <Typography.Text style={{ fontSize: 'var(--nb-title-xs)', fontWeight: 'var(--nb-font-weight-title)', fontFamily: 'var(--nb-font-display)', letterSpacing: '-0.02em', color: answerMessage ? 'var(--ant-color-success)' : 'inherit' }}>{answerMessage ? '就绪' : '--'}</Typography.Text>
              </Flex>
              <Flex vertical gap={4} style={{ minWidth: 100 }}>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>文档片段</Typography.Text>
                <Typography.Text style={{ fontSize: 'var(--nb-title-xs)', fontWeight: 'var(--nb-font-weight-title)', fontFamily: 'var(--nb-font-display)', letterSpacing: '-0.02em' }}>{resultStats.chunkCount}</Typography.Text>
              </Flex>
              <Flex vertical gap={4} style={{ minWidth: 100 }}>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>实体与关系</Typography.Text>
                <Typography.Text style={{ fontSize: 'var(--nb-title-xs)', fontWeight: 'var(--nb-font-weight-title)', fontFamily: 'var(--nb-font-display)', letterSpacing: '-0.02em' }}>{resultStats.entityCount + resultStats.relationshipCount}</Typography.Text>
              </Flex>
              <Flex vertical gap={4} style={{ minWidth: 100 }}>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>引用源</Typography.Text>
                <Typography.Text style={{ fontSize: 'var(--nb-title-xs)', fontWeight: 'var(--nb-font-weight-title)', fontFamily: 'var(--nb-font-display)', letterSpacing: '-0.02em' }}>{resultStats.referenceCount}</Typography.Text>
              </Flex>
            </Flex>

            {resultView === 'raw' ? (
              <pre className="knowledge-result-raw">{JSON.stringify(queryResult, null, 2)}</pre>
            ) : (
              <Flex className="knowledge-result-asymmetric" gap={48} wrap="wrap" align="flex-start">
                <div style={{ flex: '1 1 500px', maxWidth: '75ch', display: 'flex', flexDirection: 'column', gap: 40 }}>
                  {answerMessage ? (
                    <section>
                      <Typography.Text className="nb-section-label">分析流回答</Typography.Text>
                      <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--nb-text-md)', lineHeight: 1.6, margin: 0 }}>
                        {answerMessage}
                      </Paragraph>
                    </section>
                  ) : null}

                  <section>
                    <Typography.Text className="nb-section-label">文档片段溯源 ({queryResult.data?.chunks?.length || 0})</Typography.Text>
                    {groupedChunks.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                        {groupedChunks.map((group) => (
                          <div key={group.source} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)', color: 'var(--ant-color-primary)' }}>{group.source}</Typography.Text>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                              {group.chunks.map((item, index) => (
                                <div key={index} className="knowledge-chunk-inline" style={{ padding: '12px 16px', background: 'var(--nb-surface-soft)', borderRadius: 'var(--nb-radius-md)' }}>
                                  <Space wrap size={8} style={{ marginBottom: 8 }}>
                                    <TagLabel label={`#${index + 1}`} />
                                    {typeof item.score === 'number' ? (
                                      <TagLabel label={`相似度 ${(item.score * 100).toFixed(0)}%`} />
                                    ) : null}
                                    {typeof item.rerank_score === 'number' ? (
                                      <TagLabel label={`重排 ${(item.rerank_score * 100).toFixed(0)}%`} />
                                    ) : null}
                                    <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setSelectedChunk(item)}>详情</Button>
                                  </Space>
                                  <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0, color: 'var(--ant-color-text-secondary)', fontSize: 'var(--nb-text-sm)' }}>
                                    {getChunkPreview(String(item.content || ''), 160)}
                                  </Paragraph>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty description="暂无文档块" image={false} className="minimal-empty" />
                    )}
                  </section>
                </div>
                
                <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 32 }}>
                  <section>
                    <Typography.Text className="nb-section-label">元数据</Typography.Text>
                    <div className="knowledge-metadata-list">
                      {Object.entries(queryResult.metadata || {}).map(([key, value]) => (
                        <div key={key} className="knowledge-metadata-item" style={{ fontSize: 'var(--nb-text-sm)' }}>
                          <Text type="secondary">{key}</Text>
                          <span style={{ textAlign: 'right' }}>{Array.isArray(value) ? value.join(', ') : String(value)}</span>
                        </div>
                      ))}
                      {queryResult.message ? (
                        <div className="knowledge-metadata-item" style={{ fontSize: 'var(--nb-text-sm)' }}>
                          <Text type="secondary">message</Text>
                          <span style={{ textAlign: 'right' }}>{queryResult.message}</span>
                        </div>
                      ) : null}
                      {(!queryResult.metadata || Object.keys(queryResult.metadata).length === 0) && !queryResult.message && (
                        <Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>无</Text>
                      )}
                    </div>
                  </section>

                  <section>
                    <Typography.Text className="nb-section-label">实体关联 ({queryResult.data?.entities?.length || 0})</Typography.Text>
                    <List
                      size="small"
                      split={false}
                      dataSource={queryResult.data?.entities || []}
                      locale={{ emptyText: <Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>暂无实体</Text> }}
                      renderItem={(item) => (
                        <List.Item style={{ padding: '4px 0' }}>
                          <div style={{ width: '100%' }}>
                            <Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>{String(item.entity_name || item.entity_type || 'Entity')}</Text>
                            <Paragraph type="secondary" ellipsis={{ rows: 1 }} style={{ marginBottom: 0, fontSize: '13px' }}>
                              {String(item.description || '') || '无描述'}
                            </Paragraph>
                          </div>
                        </List.Item>
                      )}
                    />
                  </section>

                  <section>
                    <Typography.Text className="nb-section-label">路径引用 ({queryResult.data?.references?.length || 0})</Typography.Text>
                    <List
                      size="small"
                      split={false}
                      dataSource={queryResult.data?.references || []}
                      locale={{ emptyText: <Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>暂无引用</Text> }}
                      renderItem={(item) => (
                        <List.Item style={{ padding: '4px 0', fontSize: 'var(--nb-text-sm)' }}>
                          {String(item.file_path || item.reference_id || '')}
                        </List.Item>
                      )}
                    />
                  </section>
                </div>
              </Flex>
            )}
          </>
        ) : (
          <div className="workspace-empty-state">
            <Empty description="暂无结果" image={false} className="minimal-empty" />
          </div>
        )}
      </SectionCard>

      <Modal
        open={!!selectedChunk}
        title={selectedChunk ? `文档片段详情 · ${getChunkSource(selectedChunk)}` : '文档片段详情'}
        onCancel={() => setSelectedChunk(null)}
        footer={null}
        width={960}
      >
        {selectedChunk ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap size={8}>
              {typeof selectedChunk.score === 'number' ? (
                <TagLabel label={`相似度 ${(selectedChunk.score * 100).toFixed(1)}%`} />
              ) : null}
              {selectedChunk.chunk_id || selectedChunk.chunkId ? (
                <TagLabel label={`chunk_id: ${selectedChunk.chunk_id || selectedChunk.chunkId}`} />
              ) : null}
            </Space>
            <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {String(selectedChunk.content || '暂无内容')}
            </Paragraph>
          </Space>
        ) : null}
      </Modal>
    </div>
  )
}

function TagLabel({ label }: { label: string }) {
  return <Tag>{label}</Tag>
}
