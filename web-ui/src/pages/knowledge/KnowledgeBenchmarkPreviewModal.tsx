import { Descriptions, Empty, Modal, Space, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { KnowledgeBenchmarkDetail } from '../../types'

const { Paragraph } = Typography

interface KnowledgeBenchmarkPreviewModalProps {
  open: boolean
  loading: boolean
  benchmark: KnowledgeBenchmarkDetail | null
  page: number
  pageSize: number
  onClose: () => void
  onPageChange: (page: number, pageSize: number) => void
}

export function KnowledgeBenchmarkPreviewModal({
  open,
  loading,
  benchmark,
  page,
  pageSize,
  onClose,
  onPageChange,
}: KnowledgeBenchmarkPreviewModalProps) {
  const columns: ColumnsType<NonNullable<KnowledgeBenchmarkDetail['questions']>[number]> = [
    {
      title: '问题',
      dataIndex: 'query',
      key: 'query',
      render: (value: string) => <Paragraph style={{ marginBottom: 0 }}>{value}</Paragraph>,
    },
    {
      title: '标准答案',
      key: 'goldAnswer',
      render: (_value, record) => (
        <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>
          {record.goldAnswer || record.gold_answer || '--'}
        </Paragraph>
      ),
    },
    {
      title: '黄金 Chunk',
      key: 'goldChunkIds',
      render: (_value, record) => (record.goldChunkIds || record.gold_chunk_ids || []).join(', ') || '--',
    },
  ]

  return (
    <Modal
      open={open}
      title={benchmark ? `评估基准预览 · ${benchmark.name}` : '评估基准预览'}
      onCancel={onClose}
      footer={null}
      width={960}
    >
      {benchmark ? (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={3}>
            <Descriptions.Item label="问题数">{benchmark.questionCount || benchmark.question_count || 0}</Descriptions.Item>
            <Descriptions.Item label="黄金检索集">
              {(benchmark.hasGoldChunks || benchmark.has_gold_chunks) ? '有' : '无'}
            </Descriptions.Item>
            <Descriptions.Item label="标准答案">
              {(benchmark.hasGoldAnswers || benchmark.has_gold_answers) ? '有' : '无'}
            </Descriptions.Item>
          </Descriptions>
          <Table
            rowKey={(_record, index) => `benchmark-preview-${index}`}
            size="small"
            loading={loading}
            dataSource={benchmark.questions}
            pagination={{
              current: page,
              pageSize,
              total:
                benchmark.pagination?.total
                || benchmark.pagination?.totalQuestions
                || benchmark.pagination?.total_questions
                || benchmark.questionCount
                || benchmark.question_count
                || 0,
              onChange: onPageChange,
            }}
            columns={columns}
          />
        </Space>
      ) : (
        <Empty description="还没有评估基准" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Modal>
  )
}
