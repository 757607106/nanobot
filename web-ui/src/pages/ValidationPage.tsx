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
  items,
  emptyText,
  onRefresh,
}: {
  title: string
  items: ValidationActionItem[]
  emptyText: string
  onRefresh: () => Promise<void>
}) {
  return (
    <Card className="config-panel-card">
      <div className="config-card-header">
        <div className="page-section-title">
          <Typography.Title level={4}>{title}</Typography.Title>
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
        title="配置修复中心"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadValidation()} loading={loading}>
            重新检查
          </Button>
        )}
      />

      <Alert
        type={getReadinessAlertType(result.summary.status)}
        message={summary.label}
      />

      <div className="page-grid validation-page-grid">
        <ValidationList
          title="核心检查"
          items={result.checks}
          emptyText="暂无核心检查结果"
          onRefresh={loadValidation}
        />

        <ValidationList
          title="危险配置隔离区"
          items={result.dangerousOptions}
          emptyText="暂无额外风险项"
          onRefresh={loadValidation}
        />
      </div>
    </div>
  )
}
