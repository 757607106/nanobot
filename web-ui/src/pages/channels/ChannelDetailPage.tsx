import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
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
import { testIds } from '../../testIds'
import type { ChannelDetailResponse, ChannelProbeResult, WhatsAppBindingStatus, WeixinBindingStatus } from '../../types'
import {
  ChannelAvatar,
  getChannelStatusColor,
  getProbeStatusColor,
  getProbeCheckColor,
  parseListValue,
  getFieldValue,
  updateNestedValue,
} from './shared'

export default function ChannelDetailPage() {
  const { message } = App.useApp()
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

  const completedFieldCount = useMemo(
    () => (meta ? meta.primaryFields.length - missingLabels.length : 0),
    [meta, missingLabels.length],
  )

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

    switch (field.kind) {
      case 'switch':
        return (
          <Form.Item key={key} label={field.label} valuePropName="checked">
            <Switch checked={Boolean(value)} onChange={(checked) => updateField(field.path, checked)} />
          </Form.Item>
        )
      case 'select':
        return (
          <Form.Item key={key} label={field.label}>
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
          <Form.Item key={key} label={field.label}>
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
          <Form.Item key={key} label={field.label}>
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
          <Form.Item key={key} label={field.label}>
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
          <Form.Item key={key} label={field.label}>
            <Input.Password
              value={String(value ?? '')}
              placeholder={field.placeholder}
              onChange={(e) => updateField(field.path, e.target.value)}
            />
          </Form.Item>
        )
      default:
        return (
          <Form.Item key={key} label={field.label}>
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
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-start" gap={12} wrap="wrap">
        <Flex align="center" gap={12}>
          <ChannelAvatar channelName={meta.name} label={meta.label} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {meta.label}
            </Typography.Title>
            <Space size={4}>
              <Tag>{channelCategoryLabels[meta.category]}</Tag>
              <Tag color={getChannelStatusColor(detail.channel.status)}>
                {detail.channel.statusLabel}
              </Tag>
            </Space>
          </div>
        </Flex>
        <Space>
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
      </Flex>

      {missingLabels.length > 0 && (
        <Alert
          showIcon
          type={detail.channel.enabled ? 'warning' : 'info'}
          message={`缺少必填字段：${missingLabels.join('、')}`}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <Flex justify="space-between" align="center">
                <span>配置字段</span>
                <Tag>
                  {completedFieldCount}/{meta.primaryFields.length}
                </Tag>
              </Flex>
            }
          >
            <Form form={form} layout="vertical">
              <Row gutter={[12, 0]}>
                {meta.primaryFields.map((field) => (
                  <Col
                    key={field.path.join('.')}
                    xs={24}
                    md={field.kind === 'textarea' || field.kind === 'list' ? 24 : 12}
                  >
                    {renderField(field)}
                  </Col>
                ))}
              </Row>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Flex vertical gap={16}>
            <Card
              title="运行状态"
              extra={
                <Switch
                  checked={Boolean(draftConfig.enabled)}
                  onChange={(checked) => updateField(['enabled'], checked)}
                />
              }
            >
              <Flex vertical gap={8}>
                <Flex justify="space-between">
                  <Typography.Text type="secondary">当前状态</Typography.Text>
                  <Tag color={getChannelStatusColor(detail.channel.status)}>
                    {detail.channel.statusLabel}
                  </Tag>
                </Flex>
                <Flex justify="space-between">
                  <Typography.Text type="secondary">缺失字段</Typography.Text>
                  <Typography.Text>{missingLabels.length || '已齐全'}</Typography.Text>
                </Flex>
              </Flex>
            </Card>

            <Card
              title="连通性检测"
              extra={
                <Button
                  size="small"
                  icon={<SearchOutlined />}
                  loading={testing}
                  onClick={() => void testChannel()}
                  data-testid={testIds.channels.detailTest}
                >
                  测试
                </Button>
              }
            >
              {probeResult ? (
                <Flex vertical gap={8}>
                  <Space wrap>
                    <Tag color={getProbeStatusColor(probeResult.status)}>
                      {probeResult.statusLabel}
                    </Tag>
                    {probeResult.bindingRequired && <Tag color="warning">仍需绑定</Tag>}
                  </Space>
                  <Typography.Text strong>{probeResult.summary}</Typography.Text>
                  {probeResult.detail && (
                    <Typography.Text type="secondary">{probeResult.detail}</Typography.Text>
                  )}
                  {probeResult.checks.length > 0 && (
                    <Flex vertical gap={4} style={{ marginTop: 8 }}>
                      {probeResult.checks.map((check) => (
                        <Flex key={check.key} justify="space-between" align="center" gap={8}>
                          <Typography.Text type="secondary">{check.label}</Typography.Text>
                          <Tag color={getProbeCheckColor(check.status)}>
                            {check.status === 'pass' ? '通过' : check.status === 'warn' ? '警告' : '失败'}
                          </Tag>
                        </Flex>
                      ))}
                    </Flex>
                  )}
                </Flex>
              ) : (
                <Typography.Text type="secondary">点击测试按钮检测连接状态</Typography.Text>
              )}
            </Card>

            {isWhatsApp && (
              <Card
                title="绑定流程"
                extra={
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
                }
              >
                {whatsappBinding ? (
                  <Flex vertical gap={12}>
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
                        {whatsappBinding.authPresent ? '已存在认证数据' : '启动后显示二维码'}
                      </Typography.Text>
                    )}
                    {whatsappBinding.lastError && (
                      <Alert type="error" message={whatsappBinding.lastError} />
                    )}
                  </Flex>
                ) : (
                  <Typography.Text type="secondary">暂未读取到绑定状态</Typography.Text>
                )}
              </Card>
            )}

            {isWeixin && (
              <Card
                title="微信扫码绑定"
                extra={
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
                }
              >
                {weixinBinding ? (
                  <Flex vertical gap={12}>
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
                        {weixinBinding.authenticated ? '已成功登录' : '点击获取二维码'}
                      </Typography.Text>
                    )}
                    {weixinBinding.lastError && (
                      <Alert type="error" message={weixinBinding.lastError} />
                    )}
                  </Flex>
                ) : (
                  <Typography.Text type="secondary">暂未读取到状态</Typography.Text>
                )}
              </Card>
            )}
          </Flex>
        </Col>
      </Row>
    </Flex>
  )
}
