import { useMemo, useState } from 'react'
import {
  Button,
  Card,
  Empty,
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
                  value={queryParams.topK}
                  onChange={(value) => onTopKChange(Number(value || 10))}
                  style={{ width: '100%', marginTop: 8 }}
                />
              </div>
              <div style={{ minWidth: 120 }}>
                <Text type="secondary">ChunkK</Text>
                <InputNumber
                  min={1}
                  max={100}
                  value={queryParams.chunkTopK}
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
                  <Switch checked={queryParams.enableRerank} onChange={onEnableRerankChange} />
                  <Text type="secondary">{queryParams.enableRerank ? '已开启' : '已关闭'}</Text>
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
            <div className="resource-summary-strip">
              <div className="resource-summary-tile">
                <span className="resource-summary-label">回答状态</span>
                <span className="resource-summary-value" style={{ fontSize: 16 }}>
                  {answerMessage ? '已返回回答' : '无直接回答'}
                </span>
              </div>
              <div className="resource-summary-tile">
                <span className="resource-summary-label">文档片段</span>
                <span className="resource-summary-value">{resultStats.chunkCount}</span>
              </div>
              <div className="resource-summary-tile">
                <span className="resource-summary-label">实体与关系</span>
                <span className="resource-summary-value">{resultStats.entityCount + resultStats.relationshipCount}</span>
              </div>
              <div className="resource-summary-tile">
                <span className="resource-summary-label">引用</span>
                <span className="resource-summary-value">{resultStats.referenceCount}</span>
              </div>
            </div>

            {resultView === 'raw' ? (
              <pre className="knowledge-result-raw">{JSON.stringify(queryResult, null, 2)}</pre>
            ) : (
              <div className="knowledge-result-grid">
                {answerMessage ? (
                  <Card size="small" title="回答" className="knowledge-result-wide">
                    <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                      {answerMessage}
                    </Paragraph>
                  </Card>
                ) : null}
                <Card size="small" title="元数据">
                  <div className="knowledge-metadata-list">
                    {Object.entries(queryResult.metadata || {}).map(([key, value]) => (
                      <div key={key} className="knowledge-metadata-item">
                        <Text type="secondary">{key}</Text>
                        <span>{Array.isArray(value) ? value.join(', ') : String(value)}</span>
                      </div>
                    ))}
                    {queryResult.message ? (
                      <div className="knowledge-metadata-item">
                        <Text type="secondary">message</Text>
                        <span>{queryResult.message}</span>
                      </div>
                    ) : null}
                  </div>
                </Card>
                <Card size="small" title={`实体 (${queryResult.data?.entities?.length || 0})`}>
                  <List
                    size="small"
                    dataSource={queryResult.data?.entities || []}
                    locale={{ emptyText: '暂无实体' }}
                    renderItem={(item) => (
                      <List.Item>
                        <div>
                          <Text strong>{String(item.entity_name || item.entity_type || 'Entity')}</Text>
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            {String(item.description || '') || '无描述'}
                          </Paragraph>
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
                <Card size="small" title={`关系 (${queryResult.data?.relationships?.length || 0})`}>
                  <List
                    size="small"
                    dataSource={queryResult.data?.relationships || []}
                    locale={{ emptyText: '暂无关系' }}
                    renderItem={(item) => (
                      <List.Item>
                        <div>
                          <Text strong>{String(item.src_id || '')} → {String(item.tgt_id || '')}</Text>
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            {String(item.description || '') || '无描述'}
                          </Paragraph>
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
                <Card size="small" title={`文档块 (${queryResult.data?.chunks?.length || 0})`} className="knowledge-result-wide">
                  {groupedChunks.length > 0 ? (
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                      <Text type="secondary">
                        找到 {queryResult.data?.chunks?.length || 0} 个相关文档片段，来自 {groupedChunks.length} 个文件
                      </Text>
                      {groupedChunks.map((group) => (
                        <Card key={group.source} type="inner" size="small" title={`${group.source} (${group.chunks.length} chunks)`}>
                          <List
                            size="small"
                            dataSource={group.chunks}
                            renderItem={(item, index) => (
                              <List.Item>
                                <button
                                  type="button"
                                  className="knowledge-chunk-row"
                                  onClick={() => setSelectedChunk(item)}
                                >
                                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                    <Space wrap size={8}>
                                      <TagLabel label={`#${index + 1}`} />
                                      {typeof item.score === 'number' ? (
                                        <TagLabel label={`相似度 ${(item.score * 100).toFixed(0)}%`} />
                                      ) : null}
                                      {typeof item.rerank_score === 'number' ? (
                                        <TagLabel label={`重排 ${(item.rerank_score * 100).toFixed(0)}%`} />
                                      ) : null}
                                    </Space>
                                    <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
                                      {getChunkPreview(String(item.content || ''))}
                                    </Paragraph>
                                  </Space>
                                </button>
                              </List.Item>
                            )}
                          />
                        </Card>
                      ))}
                    </Space>
                  ) : (
                    <Empty description="暂无文档块" image={false} className="minimal-empty" />
                  )}
                </Card>
                <Card size="small" title={`引用 (${queryResult.data?.references?.length || 0})`}>
                  <List
                    size="small"
                    dataSource={queryResult.data?.references || []}
                    locale={{ emptyText: '暂无引用' }}
                    renderItem={(item) => (
                      <List.Item>{String(item.file_path || item.reference_id || '')}</List.Item>
                    )}
                  />
                </Card>
              </div>
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
