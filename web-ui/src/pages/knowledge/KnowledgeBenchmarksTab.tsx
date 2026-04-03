import { Button, Empty, Space, Table } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import SectionCard from '../../components/console/SectionCard'
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
        <div className="resource-summary-strip">
          <div className="resource-summary-tile">
            <span className="resource-summary-label">基准数量</span>
            <span className="resource-summary-value">{benchmarks.length}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">题目总数</span>
            <span className="resource-summary-value">{totalQuestions}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">标准答案</span>
            <span className="resource-summary-value">{goldAnswerCount}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">标准命中块</span>
            <span className="resource-summary-value">{goldChunkCount}</span>
          </div>
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
