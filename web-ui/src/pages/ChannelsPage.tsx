import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Col, Empty, Row, Space, Spin, Switch, Tag, Typography } from 'antd'
import { LinkOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import DevOnly from '../components/DevOnly'
import { MotionGroup, MotionPanel } from '../components/MotionSurface'
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

  const nextActionCount = useMemo(() => {
    const items = data?.items ?? []
    return items.filter((item) => item.status === 'incomplete' || item.status === 'unconfigured').length
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
        className="page-hero-compact studio-hero"
        eyebrow="渠道接入"
        title="消息渠道"
        description="先确认每个渠道的接入状态，再进入详情页补字段和测试，最后到消息路由里决定消息应该落到哪个员工或团队。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadChannels()}>
              刷新
            </Button>
            <Button onClick={() => navigate('/channels/bindings')}>
              查看消息路由
            </Button>
          </Space>
        )}
        stats={[
          { label: '已启用', value: stats.enabled },
          { label: '已配置', value: stats.configured },
          { label: '待补全', value: stats.incomplete },
          { label: '总数', value: stats.total },
        ]}
        badges={[
          <Tag key="status" color="processing">先接入再路由</Tag>,
          <Tag key="route">{nextActionCount > 0 ? `${nextActionCount} 个渠道待补全` : '渠道接入状态已收拢'}</Tag>,
        ]}
      />

      <div className="page-grid channels-overview-grid">
        <MotionPanel hover={false} standalone>
          <Card className="config-panel-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>消息推送设置</Typography.Title>
              <Text type="secondary">统一控制进度和工具提示是否出现在渠道里。</Text>
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
                  <Text strong>推送执行进度</Text>
                  <Text type="secondary">把执行进度同步到聊天渠道。</Text>
                </div>
                <Switch
                  checked={deliveryDraft.sendProgress}
                  onChange={(checked) => setDeliveryDraft((current) => ({ ...current, sendProgress: checked }))}
                />
              </div>
            </Col>
            <DevOnly>
              <Col xs={24} md={12}>
                <div className="channel-flag-card">
                  <div>
                    <Text strong>推送操作提示</Text>
                    <Text type="secondary">在渠道里显示工具调用提示。</Text>
                  </div>
                  <Switch
                    checked={deliveryDraft.sendToolHints}
                    onChange={(checked) => setDeliveryDraft((current) => ({ ...current, sendToolHints: checked }))}
                  />
                </div>
              </Col>
              </DevOnly>
            </Row>
          </Card>
        </MotionPanel>

        <MotionPanel hover={false} standalone>
          <Card className="config-panel-card channel-route-summary-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>消息路由</Typography.Title>
              <Text type="secondary">渠道接入完成后，再决定每个渠道或聊天 ID 应该交给哪个员工或团队。</Text>
            </div>
            <Tag color="blue">下一步</Tag>
          </div>

          <div className="config-meta-row">
            <div className="config-meta-chip">
              <span>建议顺序</span>
              <strong>补字段 → 测试 → 建路由</strong>
            </div>
            <div className="config-meta-chip">
              <span>当前待处理</span>
              <strong>{nextActionCount} 个渠道</strong>
            </div>
          </div>

          <div className="channel-route-summary-copy">
            <Text type="secondary">
              如果某个渠道已经显示“已启用”，下一步通常就是去消息路由里把消息分发到 AI 员工或团队。
            </Text>
          </div>

          <div className="config-card-footer">
            <Text type="secondary">规则支持按渠道和聊天 ID 进行匹配。</Text>
            <Button type="primary" icon={<LinkOutlined />} onClick={() => navigate('/channels/bindings')}>
              打开消息路由
            </Button>
          </div>
          </Card>
        </MotionPanel>
      </div>

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
          <MotionGroup key={category} className="config-section-stack">
            <div className="section-heading-row">
              <div className="page-section-title">
                <Typography.Title level={4}>{channelCategoryLabels[category]}</Typography.Title>
                <Text type="secondary">这里看接入状态，补字段和测试放到详情页，路由统一放到消息路由页。</Text>
              </div>
              <Tag>{items.length} 个渠道</Tag>
            </div>

            <Row gutter={[16, 16]}>
              {items.map(({ meta, state }) => {
                const missingLabels = getMissingFieldLabels(meta.name, state?.missingRequiredFields ?? [])
                return (
                  <Col xs={24} xl={12} key={meta.name}>
                    <MotionPanel standalone>
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

                        <Text type="secondary">{state?.statusDetail ?? '暂未读取状态。'}</Text>

                        <div className="channel-card-meta">
                          <Tag>{meta.primaryFields.length} 个核心字段</Tag>
                          <Tag>{channelCategoryLabels[meta.category]}</Tag>
                          {state?.enabled ? <Tag color="success">已接入运行时</Tag> : null}
                        </div>

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
                            {state?.enabled ? '下一步可直接进入消息路由配置分发规则。' : '先补齐配置，再决定是否启用。'}
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
                    </MotionPanel>
                  </Col>
                )
              })}
            </Row>
          </MotionGroup>
        )
      })}
    </div>
  )
}
