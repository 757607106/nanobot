import { Button, Select, Space, Table } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { KnowledgeBenchmark, KnowledgeEvaluationSummary } from '../../types'

interface KnowledgeEvaluationTabProps {
  selectedBenchmarkId: string | null
  benchmarks: KnowledgeBenchmark[]
  runningEvaluation: boolean
  benchmarkLoading: boolean
  evaluationHistory: KnowledgeEvaluationSummary[]
  columns: ColumnsType<KnowledgeEvaluationSummary>
  onBenchmarkChange: (value: string) => void
  onRun: () => void
  onRefresh: () => void
}

export function KnowledgeEvaluationTab({
  selectedBenchmarkId,
  benchmarks,
  runningEvaluation,
  benchmarkLoading,
  evaluationHistory,
  columns,
  onBenchmarkChange,
  onRun,
  onRefresh,
}: KnowledgeEvaluationTabProps) {
  return (
    <div className="knowledge-tab-panel">
      <div className="knowledge-query-topbar">
        <Space wrap>
          <Select
            placeholder="选择评估基准"
            value={selectedBenchmarkId}
            options={benchmarks.map((item) => ({
              label: `${item.name} (${item.questionCount || item.question_count || 0} 题)`,
              value: item.benchmarkId,
            }))}
            onChange={onBenchmarkChange}
            style={{ width: 260 }}
          />
          <Button type="primary" loading={runningEvaluation} disabled={!selectedBenchmarkId} onClick={onRun}>
            开始评测
          </Button>
          <Button icon={<ReloadOutlined />} loading={benchmarkLoading} onClick={onRefresh}>
            刷新
          </Button>
        </Space>
      </div>

      <Table
        rowKey="taskId"
        size="small"
        loading={benchmarkLoading}
        pagination={{ pageSize: 8 }}
        dataSource={evaluationHistory}
        columns={columns}
        locale={{ emptyText: '还没有评测历史' }}
      />
    </div>
  )
}
