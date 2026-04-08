import { Button, Empty, Select, Space, Table } from 'antd'
import { ReloadOutlined, AppstoreOutlined, ProfileOutlined, HistoryOutlined, FieldTimeOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import SectionCard from '../../components/console/SectionCard'
import MetricCard from '../../components/console/MetricCard'
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
        <div className="knowledge-metrics-grid" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <MetricCard
            label="当前基准"
            value={selectedBenchmark?.name || '未选择'}
            icon={<AppstoreOutlined />}
            tone={selectedBenchmarkId ? 'primary' : 'neutral'}
          />
          <MetricCard
            label="题目数量"
            value={questionCount}
            icon={<ProfileOutlined />}
            tone="neutral"
          />
          <MetricCard
            label="历史任务"
            value={evaluationHistory.length}
            icon={<HistoryOutlined />}
            tone="neutral"
          />
          <MetricCard
            label="当前状态"
            value={runningEvaluation ? '运行中' : selectedBenchmarkId ? '可开始' : '待选择'}
            icon={<FieldTimeOutlined />}
            tone={runningEvaluation ? 'warning' : 'neutral'}
          />
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
              <Empty image={false} className="minimal-empty" description="暂无评测基准" />
            ) : (
              <Empty image={false} className="minimal-empty" description="暂无评测历史" />
            ),
          }}
        />
      </SectionCard>
    </div>
  )
}
