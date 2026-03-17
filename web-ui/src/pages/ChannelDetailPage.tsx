import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  QRCode,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd'
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { channelCategoryLabels, channelMetas, type FieldMeta } from '../configMeta'
import { testIds } from '../testIds'
import type { ChannelDetailResponse, ChannelProbeResult, WhatsAppBindingStatus } from '../types'

const { Text } = Typography

const statusColorMap = {
  unconfigured: 'default',
  configured: 'blue',
  enabled: 'green',
  incomplete: 'orange',
} as const

const probeColorMap: Record<ChannelProbeResult['status'], string> = {
  passed: 'green',
  warning: 'orange',
  failed: 'red',
  manual: 'blue',
}

const probeCheckColorMap: Record<ChannelProbeResult['checks'][number]['status'], string> = {
  pass: 'green',
  warn: 'orange',
  fail: 'red',
}

const whatsappStatusColorMap: Record<string, string> = {
  connected: 'green',
  qr: 'orange',
  disconnected: 'red',
  starting: 'blue',
  stopped: 'default',
}

function parseList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getFieldValue(root: Record<string, unknown>, path: string[]) {
  return path.reduce<unknown>((cursor, segment) => {
    if (cursor && typeof cursor === 'object') {
      return (cursor as Record<string, unknown>)[segment]
    }
    return undefined
  }, root)
}

export default function ChannelDetailPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const params = useParams()
  const channelName = String(params.channelName || '').trim()
  const meta = channelMetas.find((item) => item.name === channelName) ?? null
  const isWhatsApp = channelName === 'whatsapp'
  const [detail, setDetail] = useState<ChannelDetailResponse | null>(null)
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [probeResult, setProbeResult] = useState<ChannelProbeResult | null>(null)
  const [whatsappBinding, setWhatsAppBinding] = useState<WhatsAppBindingStatus | null>(null)
  const [bindingLoading, setBindingLoading] = useState(false)
  const [bindingStarting, setBindingStarting] = useState(false)
  const [bindingStopping, setBindingStopping] = useState(false)

  useEffect(() => {
    if (!channelName) {
      return
    }
    void loadChannel()
  }, [channelName])

  useEffect(() => {
    if (!isWhatsApp) {
      setWhatsAppBinding(null)
      return
    }
    void loadWhatsAppBindingStatus()
  }, [isWhatsApp, channelName])

  const missingLabels = useMemo(() => {
    if (!meta || !detail) {
      return []
    }
    return detail.channel.missingRequiredFields.map(
      (field) => meta.primaryFields.find((item) => item.path[0] === field)?.label || field,
    )
  }, [detail, meta])
  const completedFieldCount = useMemo(() => {
    if (!meta) {
      return 0
    }
    return meta.primaryFields.length - missingLabels.length
  }, [meta, missingLabels.length])
  const nextStepCopy = useMemo(() => {
    if (!detail) {
      return '补齐字段后继续。'
    }
    if (missingLabels.length > 0) {
      return `补齐 ${missingLabels.join('、')} 后再测。`
    }
    if (!detail.channel.enabled) {
      return '字段已齐，可直接启用。'
    }
    return '当前可用，可继续配置路由。'
  }, [detail, missingLabels])

  async function loadChannel() {
    try {
      setLoading(true)
      const result = await api.getChannel(channelName)
      setDetail(result)
      setDraftConfig(result.config)
      setProbeResult(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载渠道详情失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadWhatsAppBindingStatus() {
    if (!isWhatsApp) {
      return
    }
    try {
      setBindingLoading(true)
      const result = await api.getWhatsAppBindingStatus()
      setWhatsAppBinding(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 WhatsApp 绑定状态失败')
    } finally {
      setBindingLoading(false)
    }
  }

  function updateField(path: string[], value: unknown) {
    setDraftConfig((current) => {
      const next = structuredClone(current) as Record<string, unknown>
      let cursor: Record<string, unknown> = next
      path.slice(0, -1).forEach((segment) => {
        const existing = cursor[segment]
        if (!existing || typeof existing !== 'object') {
          cursor[segment] = {}
        }
        cursor = cursor[segment] as Record<string, unknown>
      })
      cursor[path[path.length - 1]] = value
      return next
    })
  }

  async function saveChannel() {
    try {
      setSaving(true)
      const result = await api.updateChannel(channelName, draftConfig)
      setDetail(result)
      setDraftConfig(result.config)
      message.success('渠道配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存渠道配置失败')
    } finally {
      setSaving(false)
    }
  }

  async function testChannel() {
    try {
      setTesting(true)
      const result = await api.testChannel(channelName, draftConfig)
      setProbeResult(result)
      message.success(result.status === 'passed' ? '渠道测试通过' : '渠道测试已完成')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试渠道失败')
    } finally {
      setTesting(false)
    }
  }

  async function startWhatsAppBinding() {
    try {
      setBindingStarting(true)
      const result = await api.startWhatsAppBinding(draftConfig)
      setWhatsAppBinding(result)
      message.success(result.bindingRequired ? '绑定流程已启动，请按页面提示继续完成扫码。' : 'WhatsApp 绑定已就绪')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '启动 WhatsApp 绑定失败')
    } finally {
      setBindingStarting(false)
    }
  }

  async function stopWhatsAppBinding() {
    try {
      setBindingStopping(true)
      const result = await api.stopWhatsAppBinding()
      setWhatsAppBinding(result)
      message.success('WhatsApp 绑定流程已停止')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '停止 WhatsApp 绑定失败')
    } finally {
      setBindingStopping(false)
    }
  }

  function renderField(field: FieldMeta) {
    const value = getFieldValue(draftConfig, field.path)

    if (field.kind === 'switch') {
      return (
        <div className="config-field-block" key={field.path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <Switch checked={Boolean(value)} onChange={(checked) => updateField(field.path, checked)} />
        </div>
      )
    }

    if (field.kind === 'number') {
      return (
        <div className="config-field-block" key={field.path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <InputNumber
            min={field.min}
            max={field.max}
            step={field.step}
            value={typeof value === 'number' ? value : undefined}
            style={{ width: '100%' }}
            onChange={(next) => updateField(field.path, next ?? 0)}
          />
        </div>
      )
    }

    if (field.kind === 'list') {
      return (
        <div className="config-field-block" key={field.path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <Input.TextArea
            rows={4}
            value={Array.isArray(value) ? value.join('\n') : ''}
            placeholder={field.placeholder}
            onChange={(event) => updateField(field.path, parseList(event.target.value))}
          />
        </div>
      )
    }

    if (field.kind === 'textarea') {
      return (
        <div className="config-field-block" key={field.path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <Input.TextArea
            rows={4}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            onChange={(event) => updateField(field.path, event.target.value)}
          />
        </div>
      )
    }

    if (field.kind === 'select') {
      return (
        <div className="config-field-block" key={field.path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <Select
            value={typeof value === 'string' ? value : undefined}
            options={field.options}
            style={{ width: '100%' }}
            onChange={(next) => updateField(field.path, next)}
          />
        </div>
      )
    }

    const sharedProps = {
      value: String(value ?? ''),
      placeholder: field.placeholder,
      onChange: (event: ChangeEvent<HTMLInputElement>) => updateField(field.path, event.target.value),
    }

    return (
      <div className="config-field-block" key={field.path.join('.')}>
        <div className="config-field-label-row">
          <Text>{field.label}</Text>
        </div>
        {field.kind === 'password' ? <Input.Password {...sharedProps} /> : <Input {...sharedProps} />}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!meta || !detail) {
    return <Empty description="当前无法读取渠道详情" className="page-card" />
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="渠道详情"
        title={`配置 ${meta.label}`}
        description="管理接入字段、状态和连通性。"
        badges={[
          <Tag color={statusColorMap[detail.channel.status]} key="status">{detail.channel.statusLabel}</Tag>,
          <Tag key="category">{channelCategoryLabels[meta.category]}</Tag>,
        ]}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadChannel()}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void saveChannel()}
              data-testid={testIds.channels.detailSave}
            >
              保存
            </Button>
            <Button onClick={() => navigate('/channels/bindings')}>
              查看消息路由
            </Button>
          </Space>
        )}
        stats={[
          { label: '当前状态', value: detail.channel.statusLabel },
          { label: '是否启用', value: detail.channel.enabled ? '是' : '否' },
          { label: '字段完成度', value: `${completedFieldCount}/${meta.primaryFields.length}` },
          { label: '缺失字段', value: detail.channel.missingRequiredFields.length },
        ]}
      />

      {missingLabels.length > 0 ? (
        <Alert
          showIcon
          type={detail.channel.enabled ? 'warning' : 'info'}
          message="当前配置未完成"
          description={`缺少：${missingLabels.join('、')}。${nextStepCopy}`}
        />
      ) : null}

      <div className="page-grid channel-detail-grid">
        <Card className="config-panel-card channel-detail-fields-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>接入字段</Typography.Title>
              <Text type="secondary">先补齐核心字段。</Text>
            </div>
            <Tag color="blue">{completedFieldCount}/{meta.primaryFields.length}</Tag>
          </div>

          <Row gutter={[16, 16]}>
            {meta.primaryFields.map((field) => (
              <Col
                xs={24}
                md={field.kind === 'textarea' || field.kind === 'list' ? 24 : 12}
                key={field.path.join('.')}
              >
                {renderField(field)}
              </Col>
            ))}
          </Row>
        </Card>

        <div className="page-stack">
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>接入进度</Typography.Title>
                <Text type="secondary">查看状态、缺失项和下一步。</Text>
              </div>
              <Switch
                checked={Boolean(draftConfig.enabled)}
                onChange={(checked) => updateField(['enabled'], checked)}
              />
            </div>

            <div className="config-meta-row">
              <div className="config-meta-chip">
                <span>当前状态</span>
                <strong>{detail.channel.statusLabel}</strong>
              </div>
              <div className="config-meta-chip">
                <span>缺失字段</span>
                <strong>{missingLabels.length}</strong>
              </div>
            </div>

            <Text type="secondary">{detail.channel.statusDetail}</Text>

            <div className="channel-detail-note">
              <Text strong>下一步</Text>
              <Text type="secondary">{nextStepCopy}</Text>
            </div>

            {missingLabels.length > 0 ? (
              <div className="channel-card-meta">
                {missingLabels.map((label) => (
                  <Tag key={label} color="orange">{label}</Tag>
                ))}
              </div>
            ) : (
              <div className="channel-card-meta">
                <Tag color="success">核心字段已齐全</Tag>
                {Boolean(draftConfig.enabled) ? <Tag color="processing">可进入消息路由</Tag> : <Tag>下一步建议启用</Tag>}
              </div>
            )}
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>测试连接</Typography.Title>
                <Text type="secondary">可直接用当前草稿测试。</Text>
              </div>
              <Button
                icon={<SearchOutlined />}
                loading={testing}
                onClick={() => void testChannel()}
                data-testid={testIds.channels.detailTest}
              >
                测试
              </Button>
            </div>

            {probeResult ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color={probeColorMap[probeResult.status]}>{probeResult.statusLabel}</Tag>
                  {probeResult.bindingRequired ? <Tag color="orange">仍需绑定</Tag> : null}
                </Space>
                <Text strong>{probeResult.summary}</Text>
                {probeResult.detail ? <Text type="secondary">{probeResult.detail}</Text> : null}
                <div className="config-section-stack">
                  {probeResult.checks.map((check) => (
                    <div className="config-card-footer" key={check.key}>
                      <Space wrap>
                        <Tag color={probeCheckColorMap[check.status]}>{check.label}</Tag>
                        <Text type="secondary">{check.detail}</Text>
                      </Space>
                    </div>
                  ))}
                </div>
              </Space>
            ) : (
              <Text type="secondary">点击后执行探测。</Text>
            )}
          </Card>

          {isWhatsApp ? (
            <Card className="config-panel-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Typography.Title level={4}>绑定流程</Typography.Title>
                  <Text type="secondary">启动 bridge、扫码并查看状态。</Text>
                </div>
                <Space wrap>
                  <Button
                    icon={<ReloadOutlined />}
                    loading={bindingLoading}
                    onClick={() => void loadWhatsAppBindingStatus()}
                    data-testid={testIds.channels.whatsappBindRefresh}
                  >
                    刷新状态
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    loading={bindingStarting}
                    onClick={() => void startWhatsAppBinding()}
                    data-testid={testIds.channels.whatsappBindStart}
                  >
                    启动绑定
                  </Button>
                  <Button
                    danger
                    icon={<PauseCircleOutlined />}
                    loading={bindingStopping}
                    onClick={() => void stopWhatsAppBinding()}
                    data-testid={testIds.channels.whatsappBindStop}
                  >
                    停止绑定
                  </Button>
                </Space>
              </div>

              {whatsappBinding ? (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color={whatsappBinding.running ? 'green' : 'default'}>
                      {whatsappBinding.running ? 'bridge 运行中' : 'bridge 未运行'}
                    </Tag>
                    <Tag color={whatsappBinding.authPresent ? 'green' : 'orange'}>
                      {whatsappBinding.authPresent ? '已存在认证数据' : '尚未完成绑定'}
                    </Tag>
                    {whatsappBinding.lastStatus ? (
                      <Tag color={whatsappStatusColorMap[whatsappBinding.lastStatus] || 'blue'}>
                        {whatsappBinding.lastStatus}
                      </Tag>
                    ) : null}
                  </Space>

                  <div className="config-meta-row">
                    <div className="config-meta-chip">
                      <span>Bridge 地址</span>
                      <strong>{whatsappBinding.bridgeUrl || '未配置'}</strong>
                    </div>
                    <div className="config-meta-chip">
                      <span>认证目录</span>
                      <strong>{whatsappBinding.authDir}</strong>
                    </div>
                  </div>

                  {whatsappBinding.lastError ? (
                    <Alert showIcon type="error" message="最近错误" description={whatsappBinding.lastError} />
                  ) : null}

                  {whatsappBinding.qrCode ? (
                    <Space direction="vertical" size={8}>
                      <Text strong>扫码完成绑定</Text>
                      <QRCode value={whatsappBinding.qrCode} size={192} />
                      <Text type="secondary">二维码刷新后需重新扫码。</Text>
                    </Space>
                  ) : (
                    <Text type="secondary">
                      {whatsappBinding.bindingRequired
                        ? '启动后会在这里显示二维码。'
                        : '当前已存在认证数据。'}
                    </Text>
                  )}

                  {whatsappBinding.recentLogs.length > 0 ? (
                    <div className="config-section-stack">
                      <Text strong>最近日志</Text>
                      <Input.TextArea
                        rows={6}
                        readOnly
                        value={whatsappBinding.recentLogs.slice(-10).join('\n')}
                      />
                    </div>
                  ) : null}
                </Space>
              ) : (
                <Text type="secondary">暂未读取到绑定状态。</Text>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
