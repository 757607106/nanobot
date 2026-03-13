import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Col, Empty, Row, Space, Spin, Switch, Tag, Typography } from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { channelCategoryLabels, channelCategoryOrder, channelMetas } from '../configMeta'
import { testIds } from '../testIds'
import type { ChannelDeliverySettings, ChannelListResponse, ChannelStateItem } from '../types'

const { Text } = Typography

const statusColorMap: Record<ChannelStateItem['status'], string> = {
  unconfigured: 'default',
  configured: 'blue',
  enabled: 'green',
  incomplete: 'orange',
}

function getMissingFieldLabels(channelName: string, fields: string[]) {
  const meta = channelMetas.find((item) => item.name === channelName)
  if (!meta) {
    return fields
  }
  return fields.map((field) => meta.primaryFields.find((item) => item.path[0] === field)?.label || field)
}

export default function ChannelsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [data, setData] = useState<ChannelListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [deliveryDraft, setDeliveryDraft] = useState<ChannelDeliverySettings>({
    sendProgress: true,
    sendToolHints: false,
  })

  useEffect(() => {
    void loadChannels()
  }, [])

  const itemsByName = useMemo(
    () => new Map((data?.items ?? []).map((item) => [item.name, item])),
    [data?.items],
  )

  const stats = useMemo(() => {
    const items = data?.items ?? []
    return {
      enabled: items.filter((item) => item.status === 'enabled').length,
      configured: items.filter((item) => item.status === 'configured' || item.status === 'enabled').length,
      incomplete: items.filter((item) => item.status === 'incomplete').length,
      total: items.length,
    }
  }, [data?.items])

  async function loadChannels() {
    try {
      setLoading(true)
      const result = await api.getChannels()
      setData(result)
      setDeliveryDraft(result.delivery)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载渠道列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function saveDelivery() {
    try {
      setSavingDelivery(true)
      const result = await api.updateChannelDelivery(deliveryDraft)
      setData(result)
      setDeliveryDraft(result.delivery)
      message.success('投递行为已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存投递行为失败')
    } finally {
      setSavingDelivery(false)
    }
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!data) {
    return <Empty description="当前无法读取渠道列表" className="page-card" />
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="渠道接入"
        title="把聊天渠道接进实例"
        description="这个页面只处理渠道列表、启用状态和配置入口，不再把渠道配置埋在通用配置页里。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadChannels()}>
              刷新列表
            </Button>
          </Space>
        )}
        stats={[
          { label: '已启用', value: stats.enabled },
          { label: '已配置', value: stats.configured },
          { label: '待补全', value: stats.incomplete },
          { label: '总数', value: stats.total },
        ]}
      />

      <Card className="config-panel-card">
        <div className="config-card-header">
          <div className="page-section-title">
            <Typography.Title level={4}>统一投递行为</Typography.Title>
            <Text type="secondary">先定义所有已启用渠道是否展示实时进度和工具提示。</Text>
          </div>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={savingDelivery}
            onClick={() => void saveDelivery()}
            data-testid={testIds.channels.deliverySave}
          >
            保存
          </Button>
        </div>

        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <div className="channel-flag-card">
              <div>
                <Text strong>发送进度</Text>
                <Text type="secondary">把 agent 的中间进度流式发送到聊天渠道。</Text>
              </div>
              <Switch
                checked={deliveryDraft.sendProgress}
                onChange={(checked) => setDeliveryDraft((current) => ({ ...current, sendProgress: checked }))}
              />
            </div>
          </Col>
          <Col xs={24} md={12}>
            <div className="channel-flag-card">
              <div>
                <Text strong>发送工具提示</Text>
                <Text type="secondary">在渠道内展示工具调用提示，例如读取文件或搜索网页。</Text>
              </div>
              <Switch
                checked={deliveryDraft.sendToolHints}
                onChange={(checked) => setDeliveryDraft((current) => ({ ...current, sendToolHints: checked }))}
              />
            </div>
          </Col>
        </Row>
      </Card>

      {channelCategoryOrder.map((category) => {
        const items = channelMetas
          .map((meta) => ({
            meta,
            state: itemsByName.get(meta.name),
          }))
          .filter((item) => item.meta.category === category)

        if (items.length === 0) {
          return null
        }

        return (
          <div key={category} className="config-section-stack">
            <div className="section-heading-row">
                <div className="page-section-title">
                  <Typography.Title level={4}>{channelCategoryLabels[category]}</Typography.Title>
                  <Text type="secondary">这里聚焦接入状态与配置入口，单渠道详情页已支持直接发起测试。</Text>
                </div>
              <Tag>{items.length} 个渠道</Tag>
            </div>

            <Row gutter={[16, 16]}>
              {items.map(({ meta, state }) => {
                const missingLabels = getMissingFieldLabels(meta.name, state?.missingRequiredFields ?? [])
                return (
                  <Col xs={24} xl={12} key={meta.name}>
                    <Card className={`config-panel-card ${state?.status === 'enabled' ? 'is-configured' : ''}`}>
                      <div className="config-card-header">
                        <div>
                          <Space wrap>
                            <Typography.Title level={4}>{meta.label}</Typography.Title>
                            <Tag color={statusColorMap[state?.status ?? 'unconfigured']}>
                              {state?.statusLabel ?? '未配置'}
                            </Tag>
                          </Space>
                          <Text type="secondary">{meta.description}</Text>
                        </div>
                      </div>

                      <Text type="secondary">{state?.statusDetail ?? '尚未读取到当前状态。'}</Text>

                      {missingLabels.length > 0 ? (
                        <div className="config-meta-row">
                          <div className="config-meta-chip">
                            <span>仍缺字段</span>
                            <strong>{missingLabels.join('、')}</strong>
                          </div>
                        </div>
                      ) : null}

                      <div className="config-card-footer">
                        <Text type="secondary">
                          {state?.enabled ? '当前实例会在运行时加载这个渠道。' : '先完成配置，再决定是否启用。'}
                        </Text>
                        <Button
                          type="primary"
                          onClick={() => navigate(`/channels/${meta.name}`)}
                          data-testid={`${testIds.channels.detailLinkPrefix}${meta.name}`}
                        >
                          进入配置
                        </Button>
                      </div>
                    </Card>
                  </Col>
                )
              })}
            </Row>
          </div>
        )
      })}
    </div>
  )
}
