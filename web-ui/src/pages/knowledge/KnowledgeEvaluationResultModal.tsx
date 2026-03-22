import { Button, Card, Descriptions, Empty, Modal, Space, Spin, Table, Typography, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { formatDateTimeZh } from '../../locale'
import type { KnowledgeEvaluationResult } from '../../types'
import { formatScorePercent, statusColor, statusLabel } from './shared'

const { Paragraph, Text } = Typography

interface KnowledgeEvaluationResultModalProps {
  open: boolean
  loading: boolean
  result: KnowledgeEvaluationResult | null
  errorOnly: boolean
  onClose: () => void
  onToggleErrorOnly: () => void
}

export function KnowledgeEvaluationResultModal({
  open,
  loading,
  result,
  errorOnly,
  onClose,
  onToggleErrorOnly,
}: KnowledgeEvaluationResultModalProps) {
  const columns: ColumnsType<NonNullable<KnowledgeEvaluationResult['details']>[number]> = [
    {
      title: '问题',
      dataIndex: 'query',
      key: 'query',
      render: (value: string) => <Paragraph style={{ marginBottom: 0 }}>{value}</Paragraph>,
    },
    {
      title: '答案评分',
      key: 'score',
      width: 120,
      render: (_value, record) => formatScorePercent(Number(record.metrics?.score ?? 0)),
    },
    {
      title: 'Recall@1',
      key: 'recall1',
      width: 120,
      render: (_value, record) => formatScorePercent(Number(record.metrics?.['recall@1'] ?? 0)),
    },
    {
      title: '生成答案',
      key: 'generatedAnswer',
      render: (_value, record) => (
        <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>
          {record.generatedAnswer || record.generated_answer || '--'}
        </Paragraph>
      ),
    },
  ]

  return (
    <Modal
      open={open}
      title={result ? `评测结果 · ${result.taskId}` : '评测结果'}
      onCancel={onClose}
      footer={null}
      width={1200}
    >
      {loading ? (
        <div className="knowledge-loading-panel"><Spin /></div>
      ) : result ? (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={4}>
            <Descriptions.Item label="状态">
              <Tag color={statusColor(result.status)}>{statusLabel(result.status)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="总体评分">{formatScorePercent(result.overallScore ?? result.overall_score)}</Descriptions.Item>
            <Descriptions.Item label="进度">
              {result.completedQuestions || result.completed_questions || 0}/
              {result.totalQuestions || result.total_questions || 0}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {(result.updatedAt || result.updated_at)
                ? formatDateTimeZh(result.updatedAt || result.updated_at || '')
                : '--'}
            </Descriptions.Item>
          </Descriptions>
          <Card size="small" title="聚合指标">
            <div className="knowledge-metadata-list">
              {Object.entries(result.metrics || {}).map(([key, value]) => (
                <div key={key} className="knowledge-metadata-item">
                  <Text type="secondary">{key}</Text>
                  <span>{typeof value === 'number' ? formatScorePercent(value) : String(value)}</span>
                </div>
              ))}
            </div>
          </Card>
          <div className="knowledge-query-topbar">
            <Space wrap>
              <Button onClick={onToggleErrorOnly}>{errorOnly ? '查看全部' : '仅查看异常'}</Button>
            </Space>
          </div>
          <Table
            rowKey="rowId"
            size="small"
            pagination={false}
            dataSource={result.details}
            columns={columns}
          />
        </Space>
      ) : (
        <Empty description="还没有评测结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Modal>
  )
}
