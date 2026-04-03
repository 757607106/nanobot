import { useEffect, useState } from 'react'
import { Button, Empty, Modal, Segmented, Space, Spin, Typography } from 'antd'
import { DownloadOutlined, FileSearchOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../api'
import type { KnowledgeFileDetail } from '../../types'

const { Paragraph, Text, Title } = Typography

interface KnowledgeFileDetailModalProps {
  kbId: string | null
  open: boolean
  loading: boolean
  detail: KnowledgeFileDetail | null
  onClose: () => void
}

export function KnowledgeFileDetailModal({
  kbId,
  open,
  loading,
  detail,
  onClose,
}: KnowledgeFileDetailModalProps) {
  const [viewMode, setViewMode] = useState<'markdown' | 'chunks'>('markdown')

  useEffect(() => {
    if (!open) {
      setViewMode('markdown')
      return
    }
    if (detail && detail.chunks.length === 0) {
      setViewMode('markdown')
    }
  }, [detail, open])

  return (
    <Modal
      open={open}
      title={detail ? `文件详情 · ${detail.file.filename}` : '文件详情'}
      onCancel={onClose}
      footer={null}
      width={1080}
      keyboard
      maskClosable
      destroyOnHidden
    >
      {loading ? (
        <div className="knowledge-loading-panel is-large">
          <Spin size="large" />
        </div>
      ) : !detail ? (
        <Empty description="暂无文件详情" image={false} className="minimal-empty" />
      ) : (
        <div className="knowledge-file-detail-shell">
          <div className="knowledge-file-detail-header">
            <div>
              <Title level={5} style={{ margin: 0 }}>{detail.file.filename}</Title>
              <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                {detail.chunkCount} 个片段 · {detail.content.length} 字符
              </Paragraph>
            </div>
            <Space wrap>
              {detail.chunks.length > 0 ? (
                <Segmented
                  value={viewMode}
                  onChange={(value) => setViewMode(value as 'markdown' | 'chunks')}
                  options={[
                    { label: 'Markdown', value: 'markdown' },
                    { label: 'Chunks', value: 'chunks' },
                  ]}
                />
              ) : null}
              <Button
                icon={<DownloadOutlined />}
                disabled={!kbId}
                onClick={() => kbId && window.open(api.downloadKnowledgeFileUrl(kbId, detail.file.fileId, 'raw'), '_blank', 'noopener')}
              >
                原文
              </Button>
              <Button
                icon={<FileSearchOutlined />}
                disabled={!kbId || !detail.file.markdownFile}
                onClick={() => kbId && window.open(api.downloadKnowledgeFileUrl(kbId, detail.file.fileId, 'parsed'), '_blank', 'noopener')}
              >
                Markdown
              </Button>
            </Space>
          </div>

          {viewMode === 'chunks' ? (
            detail.chunks.length > 0 ? (
              <div className="knowledge-file-detail-chunks">
                {detail.chunks.map((chunk, index) => (
                  <div key={String(chunk.chunkId || chunk.chunk_id || `chunk-${index}`)} className="knowledge-file-detail-chunk">
                    <Text type="secondary">片段 #{chunk.chunkIndex || chunk.chunk_index || index + 1}</Text>
                    <Paragraph style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap' }}>
                      {String(chunk.content || '').trim() || '暂无内容'}
                    </Paragraph>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="当前文件还没有分块结果" image={false} className="minimal-empty" />
            )
          ) : detail.content.trim() ? (
            <div className="knowledge-file-detail-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.content}</ReactMarkdown>
            </div>
          ) : (
            <Empty description="当前文件还没有可预览内容" image={false} className="minimal-empty" />
          )}
        </div>
      )}
    </Modal>
  )
}
