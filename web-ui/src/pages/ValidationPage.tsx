import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Tag, Typography, theme } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import MetricCard from '../components/console/MetricCard'
import PageHeader from '../components/console/PageHeader'
import SectionCard from '../components/console/SectionCard'
import { useToast } from '../toast'
import type { ValidationCheck, ValidationRunResult } from '../types'
import {
  getReadinessAlertType,
  readinessSummaryMeta,
  validationStatusMeta,
} from '../validationMeta'

type ValidationActionItem = Pick<
  ValidationCheck,
  'key' | 'status' | 'label' | 'summary' | 'detail' | 'href' | 'actionLabel'
>

function statusTagColor(status: ValidationActionItem['status']) {
  if (status === 'fail') return 'red'
  if (status === 'warn') return 'orange'
  return 'green'
}

function ValidationQueue({
  title,
  description,
  items,
  emptyText,
  loading,
  onRefresh,
}: {
  title: string
  description: string
  items: ValidationActionItem[]
  emptyText: string
  loading: boolean
  onRefresh: () => Promise<void>
}) {
  const navigate = useNavigate()
  const { token } = theme.useToken()

  return (
    <SectionCard
      title={title}
      description={description}
      action={(
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void onRefresh()} loading={loading}>
          刷新
        </Button>
      )}
    >
      {items.length > 0 ? (
        <Flex vertical gap={12}>
          {items.map((item) => {
            const meta = validationStatusMeta[item.status]

            return (
              <div
                key={item.key}
                className="p-[18px] rounded-2xl"
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgLayout,
                }}
              >
                <Flex vertical gap={12}>
                  <Flex justify="space-between" align="flex-start" gap={12} wrap="wrap">
                    <Flex vertical gap={6} className="min-w-0">
                      <Typography.Text strong>{item.label}</Typography.Text>
                      <Typography.Paragraph type="secondary" className="!mb-0">
                        {item.summary}
                      </Typography.Paragraph>
                    </Flex>
                    <Tag color={statusTagColor(item.status)}>{meta.label}</Tag>
                  </Flex>

                  <Typography.Paragraph type="secondary" className="!mb-0 leading-relaxed">
                    {item.detail}
                  </Typography.Paragraph>

                  <Flex gap={8} wrap="wrap">
                    <Button type="primary" size="small" icon={<SettingOutlined />} onClick={() => navigate(item.href)}>
                      {item.actionLabel}
                    </Button>
                    <Button size="small" onClick={() => void onRefresh()} loading={loading}>
                      重新检查
                    </Button>
                  </Flex>
                </Flex>
              </div>
            )
          })}
        </Flex>
      ) : (
        <div
          className="min-h-[160px] grid place-items-center rounded-2xl"
          style={{
            border: `1px dashed ${token.colorBorderSecondary}`,
            background: token.colorBgLayout,
          }}
        >
          <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}
    </SectionCard>
  )
}

export default function ValidationPage() {
  const toast = useToast()
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
      toast.error(error instanceof Error ? error.message : '运行验证失败')
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

  const actionItems = useMemo(
    () => [...(result?.checks ?? []), ...(result?.dangerousOptions ?? [])],
    [result],
  )

  if (!result && loading) {
    return (
      <Flex vertical gap={24}>
        <PageHeader
          title="配置修复中心"
          subtitle="正在收集实例配置、运行环境和风险项。"
        />
      </Flex>
    )
  }

  if (!result) {
    return (
      <Flex vertical gap={24}>
        <PageHeader
          title="配置修复中心"
          subtitle="当前无法生成验证结果。"
          actions={(
            <Button icon={<ReloadOutlined />} onClick={() => void loadValidation()}>
              重试
            </Button>
          )}
        />
        <Alert type="error" showIcon message="当前无法生成验证结果。" />
      </Flex>
    )
  }

  return (
    <div className="page-stack">
    <Flex vertical gap={24}>
      <PageHeader
        title="配置修复中心"
        subtitle="把阻塞项、提醒项和风险配置收拢到一个排查视图里。"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadValidation()} loading={loading}>
            重新检查
          </Button>
        )}
      />

      <Alert
        type={getReadinessAlertType(result.summary.status)}
        showIcon
        message={summary.label}
        description={summary.description}
      />

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        <MetricCard
          label="当前状态"
          value={summary.label}
          helper="以当前校验结果为准"
          icon={
            result.summary.status === 'ready'
              ? <CheckCircleOutlined />
              : result.summary.status === 'blocked'
                ? <CloseCircleOutlined />
                : <WarningOutlined />
          }
          tone={
            result.summary.status === 'ready'
              ? 'success'
              : result.summary.status === 'blocked'
                ? 'error'
                : 'warning'
          }
        />
        <MetricCard
          label="阻塞项"
          value={result.summary.failures}
          helper="需要先处理后再继续"
          icon={<CloseCircleOutlined />}
          tone={result.summary.failures > 0 ? 'error' : 'neutral'}
        />
        <MetricCard
          label="提醒项"
          value={result.summary.warnings}
          helper="影响稳定性或完整性"
          icon={<WarningOutlined />}
          tone={result.summary.warnings > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="检查总数"
          value={actionItems.length}
          helper="包含额外风险配置"
          icon={<CheckCircleOutlined />}
          tone="primary"
        />
      </div>

      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
        <ValidationQueue
          title="核心检查"
          description="处理模型、运行环境、入口和路径相关问题。"
          items={result.checks}
          emptyText="暂无核心检查结果"
          loading={loading}
          onRefresh={loadValidation}
        />
        <ValidationQueue
          title="危险配置隔离区"
          description="隔离危险配置和会影响实例稳定性的额外风险。"
          items={result.dangerousOptions}
          emptyText="暂无额外风险项"
          loading={loading}
          onRefresh={loadValidation}
        />
      </div>
    </Flex>
    </div>
  )
}
