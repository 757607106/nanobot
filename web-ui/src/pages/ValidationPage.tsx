import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Empty, List, Spin, Tag, Typography } from 'antd'
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type { ValidationCheck, ValidationRunResult } from '../types'
import {
  getReadinessAlertType,
  readinessSummaryMeta,
  validationStatusMeta,
} from '../validationMeta'

const { Text, Paragraph } = Typography

type ValidationActionItem = Pick<
  ValidationCheck,
  'key' | 'status' | 'label' | 'summary' | 'detail' | 'href' | 'actionLabel'
> & {
  category?: ValidationCheck['category']
}

function ValidationActions({
  href,
  actionLabel,
  category,
  checkKey,
  onRefresh,
}: {
  href: string
  actionLabel: string
  category?: ValidationCheck['category']
  checkKey?: string
  onRefresh: () => Promise<void>
}) {
  const navigate = useNavigate()

  return (
    <div className="mcp-hero-actions">
      <Button
        type="primary"
        icon={<SettingOutlined />}
        onClick={() => navigate(href)}
      >
        {actionLabel}
      </Button>
      <Button icon={<ReloadOutlined />} onClick={() => void onRefresh()}>
        重新运行
      </Button>
    </div>
  )
}

function ValidationList({
  title,
  description,
  items,
  emptyText,
  onRefresh,
}: {
  title: string
  description: string
  items: ValidationActionItem[]
  emptyText: string
  onRefresh: () => Promise<void>
}) {
  return (
    <Card className="config-panel-card">
      <div className="config-card-header">
        <div className="page-section-title">
          <Typography.Title level={4}>{title}</Typography.Title>
          <Text type="secondary">{description}</Text>
        </div>
      </div>

      {items.length > 0 ? (
        <List
          dataSource={items}
          renderItem={(item) => {
            const check = item as ValidationActionItem
            const meta = validationStatusMeta[check.status]
            return (
              <List.Item>
                <div className="page-stack">
                  <div className="config-card-header">
                    <div className="page-section-title">
                      <Typography.Title level={5}>{check.label}</Typography.Title>
                      <Text type="secondary">{check.summary}</Text>
                    </div>
                    <Tag color={meta.alert === 'error' ? 'red' : meta.alert === 'warning' ? 'gold' : 'green'}>{meta.label}</Tag>
                  </div>
                  <Paragraph>{check.detail}</Paragraph>
                  <ValidationActions
                    href={check.href}
                    actionLabel={check.actionLabel}
                    category={check.category}
                    checkKey={check.key}
                    onRefresh={onRefresh}
                  />
                </div>
              </List.Item>
            )
          }}
        />
      ) : (
        <Empty description={emptyText} className="empty-block" />
      )}
    </Card>
  )
}

export default function ValidationPage() {
  const { message } = App.useApp()
  const [result, setResult] = useState<ValidationRunResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadValidation()
  }, [])

  async function loadValidation() {
    try {
      setLoading(true)
      const next = await api.runValidation()
      setResult(next)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '运行验证失败')
    } finally {
      setLoading(false)
    }
  }

  const summary = useMemo(() => {
    if (!result) {
      return readinessSummaryMeta.attention
    }
    return readinessSummaryMeta[result.summary.status]
  }, [result])

  if (loading && !result) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!result) {
    return <Empty description="当前无法生成验证结果" className="page-card" />
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="配置验证"
        title="配置修复中心"
        description="查看配置状态与风险项。"
        badges={[
          <Tag key="summary">{summary.label}</Tag>,
          <Tag key="danger">危险配置 {result.dangerousOptions.length}</Tag>,
        ]}
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadValidation()} loading={loading}>
            重新检查
          </Button>
        )}
        stats={[
          { label: '通过', value: result.summary.passed },
          { label: '提醒', value: result.summary.warnings },
          { label: '阻塞', value: result.summary.failures },
          { label: '生成时间', value: formatDateTimeZh(result.generatedAt) },
        ]}
      />

      <Alert
        type={getReadinessAlertType(result.summary.status)}
        message={summary.label}
        description={summary.description}
      />

      <div className="page-grid validation-page-grid">
        <ValidationList
          title="核心检查"
          description="直接影响实例可用性。"
          items={result.checks}
          emptyText="暂无核心检查结果"
          onRefresh={loadValidation}
        />

        <ValidationList
          title="危险配置隔离区"
          description="高风险项单独列出。"
          items={result.dangerousOptions}
          emptyText="暂无额外风险项"
          onRefresh={loadValidation}
        />
      </div>
    </div>
  )
}
