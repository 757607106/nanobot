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
  theme,
} from 'antd'
import { SaveOutlined, SearchOutlined } from '@ant-design/icons'
import type { KnowledgeQueryChunk, KnowledgeQueryParams, KnowledgeRetrieveResult } from '../../types'

const { Paragraph, Text } = Typography

interface KnowledgeQueryTabProps {
  queryParams: KnowledgeQueryParams
  queryText: string
  queryLoading: boolean
  queryResult: KnowledgeRetrieveResult | null
  resultView: 'formatted' | 'raw'
  sampleQuestions: string[]
  onModeChange: (value: string) => void
  onTopKChange: (value: number) => void
  onChunkTopKChange: (value: number) => void
  onEnableRerankChange: (checked: boolean) => void
  onSaveQueryDefaults: () => void
  onGenerateQuestions: () => void
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
  sampleQuestions,
  onModeChange,
  onTopKChange,
  onChunkTopKChange,
  onEnableRerankChange,
  onSaveQueryDefaults,
  onGenerateQuestions,
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

  return (
    <div className="knowledge-tab-panel">
      <div className="knowledge-query-topbar">
        <Space wrap>
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
            style={{ width: 140 }}
          />
          <Space.Compact>
            <Button disabled>TopK</Button>
            <InputNumber min={1} max={100} value={queryParams.topK} onChange={(value) => onTopKChange(Number(value || 10))} />
          </Space.Compact>
          <Space.Compact>
            <Button disabled>ChunkK</Button>
            <InputNumber min={1} max={100} value={queryParams.chunkTopK} onChange={(value) => onChunkTopKChange(Number(value || 12))} />
          </Space.Compact>
          <>
            <Switch checked={queryParams.enableRerank} onChange={onEnableRerankChange} />
            <Text type="secondary">重排</Text>
          </>
          <Button icon={<SaveOutlined />} onClick={onSaveQueryDefaults}>
            保存默认检索参数
          </Button>
        </Space>
        <Space wrap>
          <Button onClick={onGenerateQuestions}>生成示例问题</Button>
          <Button onClick={onOpenQueryConfig}>检索配置</Button>
          <Segmented
            value={resultView}
            onChange={(value) => onResultViewChange(value as 'formatted' | 'raw')}
            options={[
              { label: '结构视图', value: 'formatted' },
              { label: '原始 JSON', value: 'raw' },
            ]}
          />
        </Space>
      </div>

      <div className="knowledge-sample-strip">
        {sampleQuestions.length > 0 ? (
          sampleQuestions.map((item) => (
            <button
              key={item}
              type="button"
              className="knowledge-sample-question"
              onClick={() => {
                onQueryTextChange(item)
                onQuery(item)
              }}
            >
              {item}
            </button>
          ))
        ) : (
          <Text type="secondary">还没有示例问题，可以手动生成。</Text>
        )}
      </div>

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

      {queryResult ? (
        resultView === 'raw' ? (
          <pre className="knowledge-result-raw">{JSON.stringify(queryResult, null, 2)}</pre>
        ) : (
          <div className="knowledge-result-grid">
            {answerMessage ? (
              <Card size="small" title="回答">
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
            <Card size="small" title={`文档块 (${queryResult.data?.chunks?.length || 0})`}>
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
                              style={{
                                width: '100%',
                                border: 'none',
                                padding: 0,
                                background: 'transparent',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
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
                <Empty description="暂无文档块" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
        )
      ) : (
        <div className="knowledge-loading-panel">
          <Empty description="还没有查询结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}

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
