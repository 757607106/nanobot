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

const { Text, Title } = Typography

interface RunDetailProps {
  run: AgentRunSummary
  loading: boolean
  cancelling: boolean
  onRefresh: () => void
  onCancel: () => void
  children: React.ReactNode
}

export default function RunDetail({
  run,
  loading,
  cancelling,
  onRefresh,
  onCancel,
  children,
}: RunDetailProps) {
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
            <Button
              icon={<PauseCircleOutlined />}
              danger
              onClick={onCancel}
              loading={cancelling}
              disabled={!isCancelable(run.status)}
            >
              停止任务
            </Button>
          </Space>
        }
      />

      <div className="page-content-wrapper">
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          {/* Result Card */}
          {run.resultSummary?.content ? (
            <Card title="执行结果" className="page-card" variant="borderless">
              <div
                style={{
                  background: 'var(--nb-surface-strong)',
                  padding: 24,
                  borderRadius: 8,
                }}
              >
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {run.resultSummary.content}
                </pre>
              </div>
            </Card>
          ) : (
            <Card className="page-card" variant="borderless">
              <Empty description="暂无执行结果" image={false} />
            </Card>
          )}

          {/* Basic Info */}
          <Row gutter={[24, 24]}>
            <Col span={24}>
              <Card
                title="基础信息"
                className="page-card"
                variant="borderless"
                size="small"
              >
                <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="middle">
                  <Descriptions.Item label="Run ID">
                    <Text copyable code>
                      {run.runId}
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Agent">
                    {run.agentId ? (
                      <Tag color="blue" bordered={false}>
                        {run.agentId}
                      </Tag>
                    ) : (
                      '-'
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {formatDateTimeZh(run.createdAt)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Thread ID">
                    {run.threadId ? (
                      <Text code copyable>
                        {run.threadId}
                      </Text>
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
                  <Descriptions.Item label="控制范围">
                    <Tag bordered={false}>
                      {run.controlScope === 'child' ? '子任务' : '顶层任务'}
                    </Tag>
                  </Descriptions.Item>
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
