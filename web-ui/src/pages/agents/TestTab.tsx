import { useMemo, useState } from 'react'
import { RocketOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Input, Space, Spin, Table, Tag, Typography, theme, type TableColumnsType } from 'antd'
import SectionCard from '../../components/console/SectionCard'
import { formatDateTimeZh } from '../../locale'
import type { AgentDefinition, AgentRunSummary } from '../../types'
import { statusColor } from './utils'

interface TestTabProps {
  currentAgent: AgentDefinition | null
  recentRuns: AgentRunSummary[]
  loadingRuns: boolean
  runError: string | null
  onTestRun: (agentId: string, prompt: string) => Promise<string | undefined>
  onRefreshRuns: (agentId: string) => void
}

export default function TestTab({
  currentAgent,
  recentRuns,
  loadingRuns,
  runError,
  onTestRun,
  onRefreshRuns,
}: TestTabProps) {
  const { token } = theme.useToken()
  const [testPrompt, setTestPrompt] = useState('请基于当前配置，给我一个可执行的任务处理方案。')
  const [lastResult, setLastResult] = useState<string | null>(null)

  const runColumns: TableColumnsType<AgentRunSummary> = useMemo(
    () => [
      {
        title: '任务',
        key: 'label',
        render: (_value, run) => (
          <Flex vertical gap={1}>
            <Typography.Text strong>{run.label}</Typography.Text>
            <Typography.Text type="secondary">{run.taskPreview}</Typography.Text>
          </Flex>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (status) => <Tag color={statusColor(status)}>{status}</Tag>,
      },
      {
        title: '结果摘要',
        key: 'summary',
        render: (_value, run) => (
          <Typography.Text type={run.lastErrorMessage ? 'danger' : 'secondary'}>
            {run.lastErrorMessage || run.resultSummary?.content || '暂无返回摘要'}
          </Typography.Text>
        ),
      },
      {
        title: '发起时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 170,
        align: 'right',
        render: (createdAt) => (
          <Typography.Text type="secondary">{createdAt ? formatDateTimeZh(createdAt) : '--'}</Typography.Text>
        ),
      },
    ],
    [],
  )

  async function handleTestRun() {
    if (!currentAgent) return
    try {
      const result = await onTestRun(currentAgent.agentId, testPrompt.trim())
      setLastResult(result ?? null)
    } catch {
      // Error handled by parent
    }
  }

  return (
    <Flex vertical gap={6}>
      <SectionCard
        title="员工试运行"
        action={currentAgent ? <Tag>{currentAgent.agentId}</Tag> : <Tag>未保存</Tag>}
      >
        <Flex vertical gap={6}>
          <Input.TextArea
            value={testPrompt}
            onChange={(event) => setTestPrompt(event.target.value)}
            rows={5}
            placeholder="测试任务"
            aria-label="试运行任务"
          />
          <Space wrap size={[8, 8]}>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={handleTestRun}
              disabled={!currentAgent}
            >
              开始试运行
            </Button>
            {currentAgent ? (
              <Button icon={<ReloadOutlined />} onClick={() => onRefreshRuns(currentAgent.agentId)} loading={loadingRuns}>
                刷新
              </Button>
            ) : null}
          </Space>
          {runError ? <Alert type="error" message={runError} showIcon /> : null}
          {lastResult ? (
            <div
              style={{
                padding: 16,
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorPrimaryBg,
              }}
            >
              <Typography.Text strong>最近一次返回摘要</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0' }}>
                {lastResult}
              </Typography.Paragraph>
            </div>
          ) : null}
        </Flex>
      </SectionCard>

      <SectionCard title="最近执行">
        {loadingRuns ? (
          <Flex justify="center" align="center" style={{ minHeight: 180 }}>
            <Spin tip="正在加载执行记录..." />
          </Flex>
        ) : recentRuns.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行记录。" />
        ) : (
          <Table
            size="small"
            rowKey="runId"
            columns={runColumns}
            dataSource={recentRuns}
            pagination={false}
          />
        )}
      </SectionCard>
    </Flex>
  )
}
