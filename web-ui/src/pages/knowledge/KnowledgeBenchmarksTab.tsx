import { Button, Empty, Space, Table } from 'antd'
import { ReloadOutlined, DatabaseOutlined, ProfileOutlined, CheckSquareOutlined, AimOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import SectionCard from '../../components/console/SectionCard'
import MetricCard from '../../components/console/MetricCard'
import type { KnowledgeBenchmark } from '../../types'

interface KnowledgeBenchmarksTabProps {
  benchmarkLoading: boolean
  benchmarks: KnowledgeBenchmark[]
  columns: ColumnsType<KnowledgeBenchmark>
  onOpenGenerate: () => void
  onOpenUpload: () => void
  onRefresh: () => void
}

export function KnowledgeBenchmarksTab({
  benchmarkLoading,
  benchmarks,
  columns,
  onOpenGenerate,
  onOpenUpload,
  onRefresh,
}: KnowledgeBenchmarksTabProps) {
  const totalQuestions = benchmarks.reduce(
    (sum, item) => sum + (item.questionCount || item.question_count || 0),
    0,
  )
  const goldAnswerCount = benchmarks.filter((item) => item.hasGoldAnswers || item.has_gold_answers).length
  const goldChunkCount = benchmarks.filter((item) => item.hasGoldChunks || item.has_gold_chunks).length

  return (
    <div className="knowledge-tab-panel">
      <SectionCard
        title="评测基准库"
        action={(
          <Space wrap size={[8, 8]}>
            <Button onClick={onOpenGenerate}>生成基准</Button>
            <Button onClick={onOpenUpload}>上传 JSONL</Button>
            <Button icon={<ReloadOutlined />} loading={benchmarkLoading} onClick={onRefresh}>
              刷新
            </Button>
          </Space>
        )}
      >
        <div className="knowledge-metrics-grid" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <MetricCard
            label="基准数量"
            value={benchmarks.length}
            icon={<DatabaseOutlined />}
            tone="neutral"
          />
          <MetricCard
            label="题目总数"
            value={totalQuestions}
            icon={<ProfileOutlined />}
            tone="neutral"
          />
          <MetricCard
            label="标准答案"
            value={goldAnswerCount}
            icon={<CheckSquareOutlined />}
            tone="success"
          />
          <MetricCard
            label="标准命中块"
            value={goldChunkCount}
            icon={<AimOutlined />}
            tone="success"
          />
        </div>

        <Table
          rowKey="benchmarkId"
          size="small"
          loading={benchmarkLoading}
          pagination={{ pageSize: 8 }}
          dataSource={benchmarks}
          columns={columns}
          locale={{
            emptyText: (
              <Empty image={false} className="minimal-empty" description="暂无评测基准" />
            ),
          }}
        />
      </SectionCard>
    </div>
  )
}
