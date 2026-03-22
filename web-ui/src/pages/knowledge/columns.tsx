import { DeleteOutlined, DownloadOutlined, FileSearchOutlined } from '@ant-design/icons'
import { Button, Space, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api } from '../../api'
import { formatDateTimeZh } from '../../locale'
import type {
  KnowledgeBenchmark,
  KnowledgeEvaluationSummary,
} from '../../types'
import {
  canDeleteKnowledgeFile,
  formatScorePercent,
  statusColor,
  statusLabel,
  type KnowledgeTreeNode,
} from './shared'

const { Text } = Typography

interface KnowledgeFileColumnsOptions {
  currentKbId: string
  onOpenFileDetail: (record: KnowledgeTreeNode) => void
  onDeleteFiles: (targets: KnowledgeTreeNode[]) => void
}

export function buildKnowledgeFileColumns({
  currentKbId,
  onOpenFileDetail,
  onDeleteFiles,
}: KnowledgeFileColumnsOptions): ColumnsType<KnowledgeTreeNode> {
  return [
    {
      title: '名称',
      dataIndex: 'filename',
      key: 'filename',
      width: 280,
      ellipsis: true,
      onCell: (record) => record.isFolder
        ? {}
        : {
            className: 'knowledge-file-name-cell',
            onClick: () => onOpenFileDetail(record),
          },
      render: (_value, record) => (
        <div className="knowledge-file-cell">
          <span className={`knowledge-file-kind ${record.isFolder ? 'is-folder' : 'is-file'}`}>
            {record.isFolder ? 'DIR' : 'DOC'}
          </span>
          {record.isFolder ? (
            <Text>{record.filename}</Text>
          ) : (
            <button
              type="button"
              className="knowledge-file-link"
              onClick={(event) => {
                event.stopPropagation()
                onOpenFileDetail(record)
              }}
            >
              {record.filename}
            </button>
          )}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'fileType',
      key: 'fileType',
      width: 120,
    },
    {
      title: '路径',
      dataIndex: 'path',
      key: 'path',
      width: 180,
      ellipsis: true,
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
      render: (value?: string) => (value ? formatDateTimeZh(value) : '--'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_value, record) => (
        <Space size={4}>
          {!record.isFolder ? (
            <>
              <Button
                size="small"
                icon={<FileSearchOutlined />}
                onClick={() => onOpenFileDetail(record)}
              />
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => window.open(api.downloadKnowledgeFileUrl(currentKbId, record.fileId, 'raw'), '_blank', 'noopener')}
              />
              {record.markdownFile ? (
                <Button
                  size="small"
                  icon={<FileSearchOutlined />}
                  onClick={() => window.open(api.downloadKnowledgeFileUrl(currentKbId, record.fileId, 'parsed'), '_blank', 'noopener')}
                />
              ) : null}
            </>
          ) : null}
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!record.isFolder && !canDeleteKnowledgeFile(record.status)}
            onClick={() => onDeleteFiles([record])}
          />
        </Space>
      ),
    },
  ]
}

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
          <Tag color={(record.hasGoldChunks || record.has_gold_chunks) ? 'blue' : 'default'}>检索黄金集</Tag>
          <Tag color={(record.hasGoldAnswers || record.has_gold_answers) ? 'green' : 'default'}>标准答案</Tag>
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
}

export function buildKnowledgeEvaluationColumns({
  onViewEvaluationResult,
  onDeleteEvaluationResult,
}: KnowledgeEvaluationColumnsOptions): ColumnsType<KnowledgeEvaluationSummary> {
  return [
    {
      title: '任务 ID',
      key: 'taskId',
      render: (_value, record) => <Text code>{record.taskId}</Text>,
    },
    {
      title: '基准',
      key: 'benchmarkId',
      render: (_value, record) => record.benchmarkId,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
    },
    {
      title: '总体评分',
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
