import { Button, Empty, Select, Space, Table } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import SectionCard from '../../components/console/SectionCard'
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
  const selectedBenchmark = benchmarks.find((item) => item.benchmarkId === selectedBenchmarkId) || null
  const questionCount = selectedBenchmark?.questionCount || selectedBenchmark?.question_count || 0

  return (
    <div className="knowledge-tab-panel">
      <SectionCard
        title="评测运行"
        action={(
          <Button icon={<ReloadOutlined />} loading={benchmarkLoading} onClick={onRefresh}>
            刷新
          </Button>
        )}
      >
        <div className="resource-summary-strip">
          <div className="resource-summary-tile">
            <span className="resource-summary-label">当前基准</span>
            <span className="resource-summary-value" style={{ fontSize: 16 }}>
              {selectedBenchmark?.name || '未选择'}
            </span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">题目数量</span>
            <span className="resource-summary-value">{questionCount}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">历史任务</span>
            <span className="resource-summary-value">{evaluationHistory.length}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">当前状态</span>
            <span className="resource-summary-value" style={{ fontSize: 16 }}>
              {runningEvaluation ? '运行中' : selectedBenchmarkId ? '可开始' : '待选择'}
            </span>
          </div>
        </div>

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
              style={{ width: 300 }}
            />
            <Button type="primary" loading={runningEvaluation} disabled={!selectedBenchmarkId} onClick={onRun}>
              开始评测
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
          locale={{
            emptyText: benchmarks.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无评测基准" />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无评测历史" />
            ),
          }}
        />
      </SectionCard>
    </div>
  )
}
