import { Button, Card, Col, Descriptions, Empty, Row, Space, Tag, Typography, theme } from 'antd'
import {
  PauseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import PageHeader from '../../components/console/PageHeader'
import { formatDateTimeZh } from '../../locale'
import type { AgentRunSummary } from '../../types'
import { statusLabel, isCancelable } from './utils'
import { useDevMode } from '../../devMode'
import { MarkdownBubble } from '../../chat/chatPresentation'

const { Text } = Typography

interface RunDetailProps {
  run: AgentRunSummary
  loading: boolean
  cancelling: boolean
  onRefresh: () => void
  onCancel: () => void
  children: React.ReactNode
}

/** 格式化耗时 */
function formatDuration(createdAt: string, finishedAt?: string | null): string {
  if (!finishedAt) return '-'
  const start = new Date(createdAt).getTime()
  const end = new Date(finishedAt).getTime()
  const diffMs = end - start
  if (diffMs < 0 || Number.isNaN(diffMs)) return '-'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

export default function RunDetail({
  run,
  loading,
  cancelling,
  onRefresh,
  onCancel,
  children,
  }: RunDetailProps) {
  const { devMode } = useDevMode()
  const { token } = theme.useToken()

  return (
    <div className="page-stack">
      <PageHeader
        title={`${run.label}`}
        subtitle={`${statusLabel(run.status)} · ${formatDateTimeZh(run.createdAt)}`}
        actions={
          <Space wrap>
            <Button
              onClick={onRefresh}
              loading={loading}
              icon={<ReloadOutlined />}
              shape="circle"
            />
            {/* 停止按钮仅在运行中时可见 */}
            {isCancelable(run.status) && (
              <Button
                icon={<PauseCircleOutlined />}
                danger
                onClick={onCancel}
                loading={cancelling}
              >
                停止任务
              </Button>
            )}
          </Space>
        }
      />

      <div className="page-content-wrapper">
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          {/* Result Card — Markdown 渲染 */}
          {run.resultSummary?.content ? (
            <Card title="执行结果" className="page-card" variant="borderless">
              <div
                style={{
                  background: token.colorFillAlter,
                  padding: 24,
                  borderRadius: 8,
                }}
              >
                  <MarkdownBubble content={run.resultSummary.content} isStreaming={false} />
              </div>
            </Card>
          ) : (
            <Card className="page-card" variant="borderless">
              <Empty description="暂无执行结果" image={false} />
            </Card>
          )}

          {/* Basic Info — 精简版 */}
          <Row gutter={[24, 24]}>
            <Col span={24}>
              <Card
                title="基础信息"
                className="page-card"
                variant="borderless"
                size="small"
              >
                <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="middle">
                  <Descriptions.Item label="员工">
                    {run.agentId ? (
                      <Tag color="blue" bordered={false}>
                        {run.agentId}
                      </Tag>
                    ) : (
                      '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag
                      color={
                        run.status === 'succeeded'
                          ? 'success'
                          : run.status === 'failed'
                          ? 'error'
                          : run.status === 'running'
                          ? 'processing'
                          : 'default'
                      }
                      bordered={false}
                    >
                      {statusLabel(run.status)}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {formatDateTimeZh(run.createdAt)}
                  </Descriptions.Item>
                  <Descriptions.Item label="执行耗时">
                    <Text style={{ fontFamily: token.fontFamilyCode, fontSize: token.fontSizeSM }}>
                      {formatDuration(run.createdAt ?? '', run.finishedAt)}
                    </Text>
                  </Descriptions.Item>

                  {/* ━━━ devMode 独有字段 ━━━ */}
                  {devMode && (
                    <Descriptions.Item label="运行 ID">
                      <Text copyable code>
                        {run.runId}
                      </Text>
                    </Descriptions.Item>
                  )}
                  {devMode && run.threadId && (
                    <Descriptions.Item label="会话 ID">
                      <Text code copyable>
                        {run.threadId}
                      </Text>
                    </Descriptions.Item>
                  )}
                  {devMode && (
                    <Descriptions.Item label="控制范围">
                      <Tag bordered={false}>
                        {run.controlScope === 'child' ? '子任务' : '顶层任务'}
                      </Tag>
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </Card>
            </Col>
          </Row>

          {/* Tab Content */}
          {children}
        </Space>
      </div>
    </div>
  )
}
