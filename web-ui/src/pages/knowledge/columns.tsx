import { DeleteOutlined, DownloadOutlined } from '@ant-design/icons'
import { Button, Space, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api } from '../../api'
import { formatDateTimeZh } from '../../locale'
import type {
  KnowledgeBenchmark,
  KnowledgeEvaluationSummary,
} from '../../types'
import {
  formatScorePercent,
  statusColor,
  statusLabel,
} from './shared'

const { Text } = Typography

interface KnowledgeBenchmarkColumnsOptions {
  currentKbId: string
  onPreviewBenchmark: (benchmark: KnowledgeBenchmark) => void
  onDeleteBenchmark: (benchmark: KnowledgeBenchmark) => void
}

export function buildKnowledgeBenchmarkColumns({
  currentKbId,
  onPreviewBenchmark,
  onDeleteBenchmark,
}: KnowledgeBenchmarkColumnsOptions): ColumnsType<KnowledgeBenchmark> {
  return [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string, record) => (
        <div>
          <Text strong>{value}</Text>
          <div>
            <Text type="secondary">{record.description || '暂无描述'}</Text>
          </div>
        </div>
      ),
    },
    {
      title: '问题数',
      key: 'questionCount',
      width: 100,
      render: (_value, record) => record.questionCount || record.question_count || 0,
    },
    {
      title: '类型',
      key: 'flags',
      width: 180,
      render: (_value, record) => (
        <Space wrap size={4}>
          <Tag color={(record.hasGoldChunks || record.has_gold_chunks) ? 'blue' : 'default'}>含参考片段</Tag>
          <Tag color={(record.hasGoldAnswers || record.has_gold_answers) ? 'green' : 'default'}>含标准答案</Tag>
        </Space>
      ),
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: 160,
      render: (_value, record) => {
        const value = record.updatedAt || record.updated_at || record.createdAt || record.created_at
        return value ? formatDateTimeZh(value) : '--'
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" onClick={() => onPreviewBenchmark(record)}>预览</Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => window.open(api.downloadKnowledgeBenchmarkUrl(currentKbId, record.benchmarkId), '_blank', 'noopener')}
          />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDeleteBenchmark(record)} />
        </Space>
      ),
    },
  ]
}

interface KnowledgeEvaluationColumnsOptions {
  onViewEvaluationResult: (taskId: string) => void
  onDeleteEvaluationResult: (taskId: string) => void
  benchmarkNameById?: Record<string, string>
}

export function buildKnowledgeEvaluationColumns({
  onViewEvaluationResult,
  onDeleteEvaluationResult,
  benchmarkNameById,
}: KnowledgeEvaluationColumnsOptions): ColumnsType<KnowledgeEvaluationSummary> {
  return [
    {
      title: '记录 ID',
      key: 'taskId',
      render: (_value, record) => <Text code>{record.taskId}</Text>,
    },
    {
      title: '题库',
      key: 'benchmarkId',
      render: (_value, record) => {
        const name = benchmarkNameById?.[record.benchmarkId]
        return name ? (
          <div>
            <Text strong>{name}</Text>
            <div>
              <Text type="secondary">{record.benchmarkId}</Text>
            </div>
          </div>
        ) : (
          record.benchmarkId
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
    },
    {
      title: '总分',
      key: 'overallScore',
      width: 120,
      render: (_value, record) => formatScorePercent(record.overallScore ?? record.overall_score),
    },
    {
      title: '进度',
      key: 'progress',
      width: 120,
      render: (_value, record) => `${record.completedQuestions || record.completed_questions || 0}/${record.totalQuestions || record.total_questions || 0}`,
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: 160,
      render: (_value, record) => {
        const value = record.updatedAt || record.updated_at || record.createdAt || record.created_at
        return value ? formatDateTimeZh(value) : '--'
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_value, record) => (
        <Space size={4}>
          <Button size="small" onClick={() => onViewEvaluationResult(record.taskId)}>
            查看
          </Button>
          <Button size="small" danger onClick={() => onDeleteEvaluationResult(record.taskId)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]
}
