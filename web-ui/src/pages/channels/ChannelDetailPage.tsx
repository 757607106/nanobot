import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Col,
  Empty,
  Flex,
  Form,
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
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api'
import { channelCategoryLabels, channelMetas, type FieldMeta } from '../../configMeta'
import PageHeader from '../../components/console/PageHeader'
import SectionCard from '../../components/console/SectionCard'
import { testIds } from '../../testIds'
import type { ChannelDetailResponse, ChannelProbeResult, WhatsAppBindingStatus, WeixinBindingStatus } from '../../types'
import {
  getChannelStatusColor,
  getProbeStatusColor,
  getProbeCheckColor,
  parseListValue,
  getFieldValue,
  updateNestedValue,
} from './shared'
import { useToast } from '../../toast'

type ChannelFieldSectionKey = 'credentials' | 'routing' | 'experience' | 'advanced'

const channelFieldSectionMeta: Record<ChannelFieldSectionKey, { title: string }> = {
  credentials: {
    title: '接入凭据',
  },
  routing: {
    title: '路由范围',
  },
  experience: {
    title: '消息体验',
  },
  advanced: {
    title: '附加配置',
  },
}

function resolveChannelFieldSection(field: FieldMeta): ChannelFieldSectionKey {
  const key = `${field.path.join('.')}:${field.label}`.toLowerCase()

  if (
    ['allowfrom', 'groupallowfrom', 'grouppolicy', 'sessions', 'panels'].some((token) => key.includes(token))
  ) {
    return 'routing'
  }

  if (
    ['reply', 'welcome', 'emoji', 'msgformat', 'consent', 'e2ee', 'proxy', 'gateway', 'intents', 'delay'].some((token) => key.includes(token))
  ) {
    return 'experience'
  }

  if (
    ['token', 'secret', 'key', 'client', 'appid', 'appsecret', 'bridge', 'host', 'baseurl', 'homeserver', 'userid', 'deviceid', 'botid', 'imap'].some((token) => key.includes(token))
  ) {
    return 'credentials'
  }

  return 'advanced'
}

export default function ChannelDetailPage() {
  const message = useToast()
  const navigate = useNavigate()
  const params = useParams()
  const [form] = Form.useForm()

  const channelName = String(params.channelName || '').trim()
  const meta = channelMetas.find((item) => item.name === channelName) ?? null
  const isWhatsApp = channelName === 'whatsapp'
  const isWeixin = channelName === 'weixin'

  const [detail, setDetail] = useState<ChannelDetailResponse | null>(null)
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [probeResult, setProbeResult] = useState<ChannelProbeResult | null>(null)

  const [whatsappBinding, setWhatsAppBinding] = useState<WhatsAppBindingStatus | null>(null)
  const [weixinBinding, setWeixinBinding] = useState<WeixinBindingStatus | null>(null)
  const [bindingLoading, setBindingLoading] = useState(false)
  const [bindingStarting, setBindingStarting] = useState(false)
  const [bindingStopping, setBindingStopping] = useState(false)

  useEffect(() => {
    if (!channelName) return
    void loadChannel()
  }, [channelName])

  useEffect(() => {
    if (isWhatsApp) void loadWhatsAppBindingStatus()
    else setWhatsAppBinding(null)
  }, [isWhatsApp])

  useEffect(() => {
    if (isWeixin) void loadWeixinBindingStatus()
    else setWeixinBinding(null)
  }, [isWeixin])

  const missingLabels = useMemo(() => {
    if (!meta || !detail) return []
    return detail.channel.missingRequiredFields.map(
      (field) => meta.primaryFields.find((item) => item.path[0] === field)?.label || field,
    )
  }, [detail, meta])

  const missingFieldRoots = useMemo(
    () => new Set(detail?.channel.missingRequiredFields ?? []),
    [detail],
  )

  const completedFieldCount = useMemo(
    () => (meta ? meta.primaryFields.length - missingLabels.length : 0),
    [meta, missingLabels.length],
  )

  const fieldSections = useMemo(() => {
    if (!meta) return []
    const groups = Object.entries(channelFieldSectionMeta).map(([key, value]) => ({
      key: key as ChannelFieldSectionKey,
      ...value,
      fields: [] as FieldMeta[],
    }))
    const groupMap = new Map(groups.map((item) => [item.key, item]))

    meta.primaryFields.forEach((field) => {
      const sectionKey = resolveChannelFieldSection(field)
      groupMap.get(sectionKey)?.fields.push(field)
    })

    return groups.filter((item) => item.fields.length > 0)
  }, [meta])

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
    if (!isWhatsApp) return
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

  async function loadWeixinBindingStatus() {
    if (!isWeixin) return
    try {
      setBindingLoading(true)
      const result = await api.getWeixinBindingStatus()
      setWeixinBinding(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 WeChat 绑定状态失败')
    } finally {
      setBindingLoading(false)
    }
  }

  function updateField(path: string[], value: unknown) {
    setDraftConfig((current) => updateNestedValue(current, path, value))
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
      message.success(result.bindingRequired ? '会话桥接已启动，请扫码完成认证' : 'WhatsApp 绑定已就绪')
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
      message.success('WhatsApp 会话桥接已停止')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '停止 WhatsApp 绑定失败')
    } finally {
      setBindingStopping(false)
    }
  }

  async function startWeixinBinding() {
    try {
      setBindingStarting(true)
      const result = await api.startWeixinBinding({ force: true })
      setWeixinBinding(result)
      message.success(result.authenticated ? 'WeChat 绑定已就绪' : '会话桥接已启动，请扫码')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '启动 WeChat 绑定失败')
    } finally {
      setBindingStarting(false)
    }
  }

  async function stopWeixinBinding() {
    try {
      setBindingStopping(true)
      const result = await api.stopWeixinBinding()
      setWeixinBinding(result)
      message.success('WeChat 会话桥接已停止')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '停止 WeChat 绑定失败')
    } finally {
      setBindingStopping(false)
    }
  }

  function renderField(field: FieldMeta) {
    const value = getFieldValue(draftConfig, field.path)
    const key = field.path.join('.')
    const isMissing = missingFieldRoots.has(field.path[0])
    const labelNode = (
      <Space wrap size={[6, 6]}>
        <span>{field.label}</span>
        {isMissing ? <Tag color="warning">待补齐</Tag> : null}
      </Space>
    )

    switch (field.kind) {
      case 'switch':
        return (
          <Form.Item key={key} label={labelNode} valuePropName="checked">
            <Switch checked={Boolean(value)} onChange={(checked) => updateField(field.path, checked)} />
          </Form.Item>
        )
      case 'select':
        return (
          <Form.Item key={key} label={labelNode}>
            <Select
              value={typeof value === 'string' ? value : undefined}
              onChange={(val) => updateField(field.path, val)}
              options={field.options}
              style={{ width: '100%' }}
            />
          </Form.Item>
        )
      case 'number':
        return (
          <Form.Item key={key} label={labelNode}>
            <InputNumber
              value={typeof value === 'number' ? value : undefined}
              onChange={(val) => updateField(field.path, val ?? 0)}
              min={field.min}
              max={field.max}
              step={field.step}
              style={{ width: '100%' }}
            />
          </Form.Item>
        )
      case 'list':
        return (
          <Form.Item key={key} label={labelNode}>
            <Input.TextArea
              rows={3}
              value={Array.isArray(value) ? value.join('\n') : ''}
              placeholder={field.placeholder}
              onChange={(e) => updateField(field.path, parseListValue(e.target.value))}
            />
          </Form.Item>
        )
      case 'textarea':
        return (
          <Form.Item key={key} label={labelNode}>
            <Input.TextArea
              rows={3}
              value={String(value ?? '')}
              placeholder={field.placeholder}
              onChange={(e) => updateField(field.path, e.target.value)}
            />
          </Form.Item>
        )
      case 'password':
        return (
          <Form.Item key={key} label={labelNode}>
            <Input.Password
              value={String(value ?? '')}
              placeholder={field.placeholder}
              onChange={(e) => updateField(field.path, e.target.value)}
            />
          </Form.Item>
        )
      default:
        return (
          <Form.Item key={key} label={labelNode}>
            <Input
              value={String(value ?? '')}
              placeholder={field.placeholder}
              onChange={(e) => updateField(field.path, e.target.value)}
            />
          </Form.Item>
        )
    }
  }

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 400 }}>
        <Spin size="large" />
      </Flex>
    )
  }

  if (!meta || !detail) {
    return <Empty description="当前无法读取渠道详情" />
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={meta.label}
        subtitle={meta.description}
        actions={(
          <Space wrap size={[8, 8]}>
            <Button icon={<ReloadOutlined />} onClick={() => void loadChannel()}>
              刷新
            </Button>
            <Button onClick={() => navigate('/channels/bindings')}>消息路由</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void saveChannel()}
              data-testid={testIds.channels.detailSave}
            >
              保存
            </Button>
          </Space>
        )}
      />

      <div className="resource-summary-strip">
        <div className="resource-summary-tile">
          <span className="resource-summary-label">渠道分类</span>
          <span className="resource-summary-value" style={{ fontSize: 18 }}>
            {channelCategoryLabels[meta.category]}
          </span>
        </div>
        <div className="resource-summary-tile">
          <span className="resource-summary-label">配置进度</span>
          <span className="resource-summary-value">{completedFieldCount}/{meta.primaryFields.length}</span>
        </div>
        <div className="resource-summary-tile">
          <span className="resource-summary-label">运行状态</span>
          <span className="resource-summary-value" style={{ fontSize: 18 }}>
            {detail.channel.statusLabel}
          </span>
        </div>
        <div className="resource-summary-tile">
          <span className="resource-summary-label">验证结果</span>
          <span className="resource-summary-value" style={{ fontSize: 18 }}>
            {probeResult ? probeResult.statusLabel : '未测试'}
          </span>
        </div>
      </div>

      {missingLabels.length > 0 && (
        <Alert
          showIcon
          type={detail.channel.enabled ? 'warning' : 'info'}
          message={`缺少必填字段：${missingLabels.join('、')}`}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Form form={form} layout="vertical" requiredMark={false} component={false}>
            <Flex vertical gap={16}>
              {fieldSections.map((section) => (
                <SectionCard
                  key={section.key}
                  title={section.title}
                  action={<Tag>{section.fields.length} 项</Tag>}
                >
                  <Row gutter={[12, 0]}>
                    {section.fields.map((field) => (
                      <Col
                        key={field.path.join('.')}
                        xs={24}
                        md={field.kind === 'textarea' || field.kind === 'list' ? 24 : 12}
                      >
                        {renderField(field)}
                      </Col>
                    ))}
                  </Row>
                </SectionCard>
              ))}
            </Flex>
          </Form>
        </Col>

        <Col xs={24} lg={10}>
          <Flex vertical gap={16}>
            <SectionCard
              title="状态"
              action={(
                <Switch
                  checked={Boolean(draftConfig.enabled)}
                  onChange={(checked) => updateField(['enabled'], checked)}
                />
              )}
            >
              <div className="resource-summary-strip">
                <div className="resource-summary-tile">
                  <span className="resource-summary-label">当前状态</span>
                  <span className="resource-summary-value" style={{ fontSize: 18 }}>{detail.channel.statusLabel}</span>
                </div>
                <div className="resource-summary-tile">
                  <span className="resource-summary-label">缺失字段</span>
                  <span className="resource-summary-value">{missingLabels.length}</span>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="检测"
              action={(
                <Button
                  size="small"
                  icon={<SearchOutlined />}
                  loading={testing}
                  onClick={() => void testChannel()}
                  data-testid={testIds.channels.detailTest}
                >
                  测试
                </Button>
              )}
            >
              {probeResult ? (
                <Flex vertical gap={12}>
                  <div className="resource-summary-strip">
                    <div className="resource-summary-tile">
                      <span className="resource-summary-label">检测结论</span>
                      <span className="resource-summary-value" style={{ fontSize: 18 }}>{probeResult.statusLabel}</span>
                    </div>
                    <div className="resource-summary-tile">
                      <span className="resource-summary-label">绑定状态</span>
                      <span className="resource-summary-value" style={{ fontSize: 18 }}>
                        {probeResult.bindingRequired ? '仍需绑定' : '已就绪'}
                      </span>
                    </div>
                  </div>

                  {probeResult.checks.length > 0 && (
                    <div className="resource-rail-list">
                      {probeResult.checks.map((check) => (
                        <div key={check.key} className="resource-rail-item">
                          <Flex justify="space-between" align="flex-start" gap={12}>
                            <Flex vertical gap={6} style={{ minWidth: 0, flex: 1 }}>
                              <Typography.Text strong className="resource-rail-item-title">{check.label}</Typography.Text>
                              <Typography.Text type="secondary" className="resource-rail-item-description">
                                {check.detail}
                              </Typography.Text>
                            </Flex>
                            <Tag color={getProbeCheckColor(check.status)}>
                              {check.status === 'pass' ? '通过' : check.status === 'warn' ? '警告' : '失败'}
                            </Tag>
                          </Flex>
                        </div>
                      ))}
                    </div>
                  )}
                </Flex>
              ) : (
                <div className="workspace-empty-state" style={{ minHeight: 160 }}>
                  <Empty description="暂无检测结果" image={false} className="minimal-empty" />
                </div>
              )}
            </SectionCard>

            {isWhatsApp && (
              <SectionCard
                title="绑定流程"
                action={(
                  <Space>
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={bindingLoading}
                      onClick={() => void loadWhatsAppBindingStatus()}
                      data-testid={testIds.channels.whatsappBindRefresh}
                    >
                      刷新
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      loading={bindingStarting}
                      onClick={() => void startWhatsAppBinding()}
                      data-testid={testIds.channels.whatsappBindStart}
                    >
                      启动绑定
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<PauseCircleOutlined />}
                      loading={bindingStopping}
                      onClick={() => void stopWhatsAppBinding()}
                      data-testid={testIds.channels.whatsappBindStop}
                    >
                      停止
                    </Button>
                  </Space>
                )}
              >
                {whatsappBinding ? (
                  <Flex vertical gap={12}>
                    <div className="resource-summary-strip">
                      <div className="resource-summary-tile">
                        <span className="resource-summary-label">桥接进程</span>
                        <span className="resource-summary-value" style={{ fontSize: 18 }}>
                          {whatsappBinding.running ? '运行中' : '未运行'}
                        </span>
                      </div>
                      <div className="resource-summary-tile">
                        <span className="resource-summary-label">认证状态</span>
                        <span className="resource-summary-value" style={{ fontSize: 18 }}>
                          {whatsappBinding.authPresent ? '已认证' : '未认证'}
                        </span>
                      </div>
                    </div>
                    <Space wrap>
                      <Tag color={whatsappBinding.running ? 'success' : 'default'}>
                        {whatsappBinding.running ? '运行中' : '未运行'}
                      </Tag>
                      <Tag color={whatsappBinding.authPresent ? 'success' : 'warning'}>
                        {whatsappBinding.authPresent ? '已认证' : '未认证'}
                      </Tag>
                    </Space>
                    {whatsappBinding.qrCode ? (
                      <Flex vertical gap={8}>
                        <Typography.Text strong>扫码绑定</Typography.Text>
                        <QRCode value={whatsappBinding.qrCode} size={180} />
                      </Flex>
                    ) : (
                      <Typography.Text type="secondary">
                        {whatsappBinding.authPresent ? '已存在认证数据' : '未生成二维码'}
                      </Typography.Text>
                    )}
                    {whatsappBinding.lastError && (
                      <Alert type="error" message={whatsappBinding.lastError} />
                    )}
                  </Flex>
                ) : (
                  <Typography.Text type="secondary">暂未读取到绑定状态</Typography.Text>
                )}
              </SectionCard>
            )}

            {isWeixin && (
              <SectionCard
                title="微信扫码绑定"
                action={(
                  <Space>
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={bindingLoading}
                      onClick={() => void loadWeixinBindingStatus()}
                    >
                      刷新
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      loading={bindingStarting}
                      onClick={() => void startWeixinBinding()}
                    >
                      获取二维码
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<PauseCircleOutlined />}
                      loading={bindingStopping}
                      onClick={() => void stopWeixinBinding()}
                    >
                      停止
                    </Button>
                  </Space>
                )}
              >
                {weixinBinding ? (
                  <Flex vertical gap={12}>
                    <div className="resource-summary-strip">
                      <div className="resource-summary-tile">
                        <span className="resource-summary-label">桥接进程</span>
                        <span className="resource-summary-value" style={{ fontSize: 18 }}>
                          {weixinBinding.running ? '运行中' : '未运行'}
                        </span>
                      </div>
                      <div className="resource-summary-tile">
                        <span className="resource-summary-label">认证状态</span>
                        <span className="resource-summary-value" style={{ fontSize: 18 }}>
                          {weixinBinding.authenticated ? '已认证' : '未认证'}
                        </span>
                      </div>
                    </div>
                    <Space wrap>
                      <Tag color={weixinBinding.running ? 'processing' : 'default'}>
                        {weixinBinding.running ? '运行中' : '未运行'}
                      </Tag>
                      <Tag color={weixinBinding.authenticated ? 'success' : 'warning'}>
                        {weixinBinding.authenticated ? '已认证' : '未认证'}
                      </Tag>
                    </Space>
                    {weixinBinding.qrCode ? (
                      <Flex vertical gap={8}>
                        <Typography.Text strong>扫码登录</Typography.Text>
                        <QRCode value={weixinBinding.qrCode} size={180} />
                      </Flex>
                    ) : (
                      <Typography.Text type="secondary">
                        {weixinBinding.authenticated ? '已成功登录' : '未生成二维码'}
                      </Typography.Text>
                    )}
                    {weixinBinding.lastError && (
                      <Alert type="error" message={weixinBinding.lastError} />
                    )}
                  </Flex>
                ) : (
                  <Typography.Text type="secondary">暂未读取到状态</Typography.Text>
                )}
              </SectionCard>
            )}
          </Flex>
        </Col>
      </Row>
    </div>
  )
}
