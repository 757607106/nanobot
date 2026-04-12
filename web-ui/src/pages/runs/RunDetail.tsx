import { Button, Card, Col, Descriptions, Empty, Row, Space, Tag, Typography } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import PageHeader from '../../components/console/PageHeader'
import { formatDateTimeZh } from '../../locale'
import type { AgentRunSummary } from '../../types'
import { statusLabel, isCancelable } from './utils'
import { useDevMode } from '../../devMode'

const { Text, Title } = Typography

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

  const getStatusIcon = () => {
    switch (run.status) {
      case 'succeeded':
        return <CheckCircleOutlined style={{ color: 'var(--ant-color-success)' }} />
      case 'failed':
        return <CloseCircleOutlined style={{ color: 'var(--ant-color-error)' }} />
      default:
        return <InfoCircleOutlined />
    }
  }

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
                  background: 'var(--nb-surface-strong)',
                  padding: 24,
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 'var(--nb-text-sm)',
                    lineHeight: 1.7,
                  }}
                  dangerouslySetInnerHTML={{
                    __html: simpleMarkdown(run.resultSummary.content),
                  }}
                />
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
                  <Descriptions.Item label="Agent">
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
                    <Text style={{ fontFamily: 'var(--nb-font-mono)', fontSize: 'var(--nb-text-sm)' }}>
                      {formatDuration(run.createdAt ?? '', run.finishedAt)}
                    </Text>
                  </Descriptions.Item>

                  {/* ━━━ devMode 独有字段 ━━━ */}
                  {devMode && (
                    <Descriptions.Item label="Run ID">
                      <Text copyable code>
                        {run.runId}
                      </Text>
                    </Descriptions.Item>
                  )}
                  {devMode && run.threadId && (
                    <Descriptions.Item label="Thread ID">
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

/**
 * 极简 Markdown → HTML：处理 **bold**, `code`, 换行
 * 仅用于执行结果的基本排版，不引入完整 Markdown 库
 */
function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;font-size:13px">$1</code>')
    .replace(/\n/g, '<br />')
}
