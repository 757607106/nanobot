import { Button, Space, Table } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
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
  return (
    <div className="knowledge-tab-panel">
      <div className="knowledge-query-topbar">
        <Space wrap>
          <Button onClick={onOpenGenerate}>生成基准</Button>
          <Button onClick={onOpenUpload}>上传 JSONL</Button>
          <Button icon={<ReloadOutlined />} loading={benchmarkLoading} onClick={onRefresh}>
            刷新
          </Button>
        </Space>
      </div>

      <Table
        rowKey="benchmarkId"
        size="small"
        loading={benchmarkLoading}
        pagination={{ pageSize: 8 }}
        dataSource={benchmarks}
        columns={columns}
        locale={{ emptyText: '还没有评估基准' }}
      />
    </div>
  )
}
