import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Alert,
  Button,
  Card,
  Collapse,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  QRCode,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  theme,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseOutlined,
  ExperimentOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { api } from '../../api'
import MetricCard from '../../components/console/MetricCard'
import PageHeader from '../../components/console/PageHeader'
import SectionCard from '../../components/console/SectionCard'
import { channelCategoryLabels, channelMetas, type ChannelMeta, type FieldMeta } from '../../configMeta'
import { testIds } from '../../testIds'
import type {
  ChannelDeliverySettings,
  ChannelDetailResponse,
  ChannelListResponse,
  ChannelProbeResult,
  ChannelStateItem,
  WeixinBindingStatus,
} from '../../types'
import {
  ChannelAvatar,
  ChannelStatusTag,
  getProbeStatusColor,
  getProbeCheckColor,
  parseListValue,
  getFieldValue,
  updateNestedValue,
} from './shared'
import { designTokens } from '../../ui/design/tokens'
import { useToast } from '../../toast'

interface ChannelRow {
  key: string
  name: string
  label: string
  category: ChannelMeta['category']
  description: string
  status: ChannelStateItem['status']
  statusLabel: string
  enabled: boolean
  configured: boolean
  missingFields: string[]
  state: ChannelStateItem | null
  meta: ChannelMeta
}

export default function ChannelsPage() {
  const message = useToast()
  const { token } = theme.useToken()
  const [form] = Form.useForm()

  const [data, setData] = useState<ChannelListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const [deliverySettings, setDeliverySettings] = useState<ChannelDeliverySettings>({
    sendProgress: true,
    sendToolHints: false,
  })
  const [detailMap, setDetailMap] = useState<Record<string, ChannelDetailResponse>>({})
  const [draftMap, setDraftMap] = useState<Record<string, Record<string, unknown>>>({})
  const [probeMap, setProbeMap] = useState<Record<string, ChannelProbeResult | null>>({})

  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null)

  // WeChat binding state
  const [weixinBinding, setWeixinBinding] = useState<WeixinBindingStatus | null>(null)
  const [weixinBindingLoading, setWeixinBindingLoading] = useState(false)
  const [weixinBindingStarting, setWeixinBindingStarting] = useState(false)
  const [weixinBindingStopping, setWeixinBindingStopping] = useState(false)

  useEffect(() => {
    void loadChannels()
  }, [])

  useEffect(() => {
    if (selectedChannel) {
      void loadChannelDetail(selectedChannel)
      if (selectedChannel === 'weixin') {
        void loadWeixinBindingStatus()
      }
    }
  }, [selectedChannel])

  const channels: ChannelRow[] = useMemo(() => {
    const itemsByName = new Map((data?.items ?? []).map((item) => [item.name, item]))

    const known = channelMetas
      .filter((meta) => itemsByName.has(meta.name))
      .map((meta) => {
        const state = itemsByName.get(meta.name)!
        return {
          key: meta.name,
          name: meta.name,
          label: meta.label,
          category: meta.category,
          description: meta.description,
          status: state.status,
          statusLabel: state.statusLabel,
          enabled: state.enabled,
          configured: state.configured,
          missingFields: state.missingRequiredFields || [],
          state,
          meta,
        }
      })

    const extras = (data?.items ?? [])
      .filter((item) => !channelMetas.some((meta) => meta.name === item.name))
      .map((item) => ({
        key: item.name,
        name: item.name,
        label: item.name,
        category: 'Collaboration' as ChannelMeta['category'],
        description: item.statusDetail || '未登记的渠道元数据',
        status: item.status,
        statusLabel: item.statusLabel,
        enabled: item.enabled,
        configured: item.configured,
        missingFields: item.missingRequiredFields || [],
        state: item,
        meta: {
          name: item.name,
          label: item.name,
          category: 'Collaboration' as ChannelMeta['category'],
          description: item.statusDetail || '未登记的渠道元数据',
          primaryFields: [],
        },
      }))

    return [...known, ...extras]
  }, [data?.items])



  const activeChannel = selectedChannel ? channels.find((c) => c.name === selectedChannel) : null
  const activeDetail = selectedChannel ? detailMap[selectedChannel] : null
  const activeDraft = selectedChannel ? draftMap[selectedChannel] ?? {} : {}
  const activeProbe = selectedChannel ? probeMap[selectedChannel] : null
  const activeRequiredCount = activeChannel?.meta.primaryFields.length ?? 0
  const activeCompletedCount = activeChannel ? activeRequiredCount - activeChannel.missingFields.length : 0
  const configPercent = activeRequiredCount > 0
    ? Math.round((activeCompletedCount / activeRequiredCount) * 100)
    : 100

  async function loadChannels() {
    try {
      setLoading(true)
      const result = await api.getChannels()
      setData(result)
      setDeliverySettings(result.delivery)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载渠道列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadChannelDetail(channelName: string, force = false) {
    if (!force && detailMap[channelName]) return
    try {
      const result = await api.getChannel(channelName)
      setDetailMap((current) => ({ ...current, [channelName]: result }))
      setDraftMap((current) => ({ ...current, [channelName]: result.config }))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载渠道详情失败')
    }
  }

  async function saveDelivery() {
    try {
      setSaving(true)
      const result = await api.updateChannelDelivery(deliverySettings)
      setData(result)
      setDeliverySettings(result.delivery)
      message.success('投递设置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存投递设置失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveChannel(channelName: string) {
    const draft = draftMap[channelName]
    if (!draft) return
    try {
      setSaving(true)
      const result = await api.updateChannel(channelName, draft)
      setDetailMap((current) => ({ ...current, [channelName]: result }))
      setDraftMap((current) => ({ ...current, [channelName]: result.config }))
      setData((current) => {
        if (!current) return current
        return {
          ...current,
          items: current.items.map((item) =>
            item.name === result.channel.name ? result.channel : item,
          ),
        }
      })
      message.success('渠道配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存渠道配置失败')
    } finally {
      setSaving(false)
    }
  }

  async function testChannel(channelName: string) {
    const draft = draftMap[channelName]
    if (!draft) return
    try {
      setTesting(true)
      const result = await api.testChannel(channelName, draft)
      setProbeMap((current) => ({ ...current, [channelName]: result }))
      message.success(result.status === 'passed' ? '渠道测试通过' : '渠道测试已完成')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试渠道失败')
    } finally {
      setTesting(false)
    }
  }

  async function toggleChannel(channelName: string, enabled: boolean) {
    const detail = detailMap[channelName]
    if (!detail) return
    try {
      const payload = { ...detail.config, enabled }
      const result = await api.updateChannel(channelName, payload)
      setDetailMap((current) => ({ ...current, [channelName]: result }))
      setDraftMap((current) => ({ ...current, [channelName]: result.config }))
      setData((current) => {
        if (!current) return current
        return {
          ...current,
          items: current.items.map((item) =>
            item.name === result.channel.name ? result.channel : item,
          ),
        }
      })
      message.success(enabled ? '渠道已启用' : '渠道已停用')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新渠道状态失败')
    }
  }

  function updateDraft(channelName: string, path: string[], value: unknown) {
    setDraftMap((current) => ({
      ...current,
      [channelName]: updateNestedValue(current[channelName] || {}, path, value),
    }))
  }

  function openChannelDrawer(channelName: string) {
    setSelectedChannel(channelName)
    setDrawerOpen(true)
  }

  // ── WeChat binding ──
  async function loadWeixinBindingStatus() {
    try {
      setWeixinBindingLoading(true)
      const result = await api.getWeixinBindingStatus()
      setWeixinBinding(result)
      // If authenticated, reload channel detail to refresh form
      if (result.authenticated && selectedChannel === 'weixin') {
        void loadChannelDetail('weixin')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 WeChat 绑定状态失败')
    } finally {
      setWeixinBindingLoading(false)
    }
  }

  async function startWeixinBinding() {
    try {
      setWeixinBindingStarting(true)
      const result = await api.startWeixinBinding({ force: true })
      setWeixinBinding(result)
      if (result.authenticated) {
        message.success('WeChat 绑定已就绪')
        // Reload channel detail to reflect new auth state
        void loadChannelDetail('weixin')
      } else {
        message.success('会话桥接已启动，请扫码')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '启动 WeChat 绑定失败')
    } finally {
      setWeixinBindingStarting(false)
    }
  }

  async function stopWeixinBinding() {
    try {
      setWeixinBindingStopping(true)
      const result = await api.stopWeixinBinding()
      setWeixinBinding(result)
      message.success('WeChat 会话桥接已停止')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '停止 WeChat 绑定失败')
    } finally {
      setWeixinBindingStopping(false)
    }
  }

  // Auto-poll weixin binding status while running & not yet authenticated
  useEffect(() => {
    if (!weixinBinding?.running || weixinBinding?.authenticated) return
    const timer = setInterval(() => {
      void loadWeixinBindingStatus()
    }, 3000)
    return () => clearInterval(timer)
  }, [weixinBinding?.running, weixinBinding?.authenticated])

  function renderField(channelName: string, field: FieldMeta): ReactNode {
    const draft = draftMap[channelName] || {}
    const value = getFieldValue(draft, field.path)
    const key = field.path.join('.')
    const isFullWidth = ['list', 'textarea', 'password'].includes(field.kind)

    const fieldNode = (() => {
      switch (field.kind) {
        case 'switch':
          return (
            <Form.Item key={key} label={field.label} valuePropName="checked" extra={field.description} style={{ marginBottom: 14 }}>
              <Switch
                checked={Boolean(value)}
                onChange={(checked) => updateDraft(channelName, field.path, checked)}
              />
            </Form.Item>
          )
        case 'select':
          return (
            <Form.Item key={key} label={field.label} extra={field.description} style={{ marginBottom: 14 }}>
              <Select
                value={typeof value === 'string' ? value : undefined}
                onChange={(val) => updateDraft(channelName, field.path, val)}
                options={field.options}
                placeholder={field.placeholder}
                allowClear
              />
            </Form.Item>
          )
        case 'number':
          return (
            <Form.Item key={key} label={field.label} extra={field.description} style={{ marginBottom: 14 }}>
              <InputNumber
                value={typeof value === 'number' ? value : null}
                onChange={(val) => updateDraft(channelName, field.path, val ?? 0)}
                min={field.min}
                max={field.max}
                step={field.step}
                style={{ width: '100%' }}
              />
            </Form.Item>
          )
        case 'list':
          return (
            <Form.Item key={key} label={field.label} extra={field.description} style={{ marginBottom: 14 }}>
              <Input.TextArea
                value={Array.isArray(value) ? value.join('\n') : ''}
                onChange={(e) => updateDraft(channelName, field.path, parseListValue(e.target.value))}
                placeholder={field.placeholder}
                autoSize={{ minRows: 3, maxRows: 6 }}
              />
            </Form.Item>
          )
        case 'textarea':
          return (
            <Form.Item key={key} label={field.label} extra={field.description} style={{ marginBottom: 14 }}>
              <Input.TextArea
                value={String(value ?? '')}
                onChange={(e) => updateDraft(channelName, field.path, e.target.value)}
                placeholder={field.placeholder}
                autoSize={{ minRows: 3, maxRows: 6 }}
              />
            </Form.Item>
          )
        case 'password':
          return (
            <Form.Item key={key} label={field.label} extra={field.description} style={{ marginBottom: 14 }}>
              <Input.Password
                value={String(value ?? '')}
                onChange={(e) => updateDraft(channelName, field.path, e.target.value)}
                placeholder={field.placeholder}
              />
            </Form.Item>
          )
        default:
          return (
            <Form.Item key={key} label={field.label} extra={field.description} style={{ marginBottom: 14 }}>
              <Input
                value={String(value ?? '')}
                onChange={(e) => updateDraft(channelName, field.path, e.target.value)}
                placeholder={field.placeholder}
              />
            </Form.Item>
          )
      }
    })()

    return (
      <div key={key} style={isFullWidth ? { gridColumn: '1 / -1' } : undefined}>
        {fieldNode}
      </div>
    )
  }

  // 投递设置下拉面板
  const deliverySettingsMenu = (
    <Card
      size="small"
      style={{ width: 280, padding: 0 }}
      styles={{ body: { padding: 'var(--nb-spacing-md)' } }}
    >
      <Flex vertical gap="var(--nb-spacing-md)">
        <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>
          消息投递设置
        </Typography.Text>
        <Flex justify="space-between" align="center">
          <Typography.Text type="secondary">执行进度</Typography.Text>
          <Switch
            size="small"
            checked={deliverySettings.sendProgress}
            onChange={(checked) => setDeliverySettings((s) => ({ ...s, sendProgress: checked }))}
          />
        </Flex>
        <Flex justify="space-between" align="center">
          <Typography.Text type="secondary">操作提示</Typography.Text>
          <Switch
            size="small"
            checked={deliverySettings.sendToolHints}
            onChange={(checked) => setDeliverySettings((s) => ({ ...s, sendToolHints: checked }))}
          />
        </Flex>
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          onClick={() => void saveDelivery()}
          loading={saving}
          block
          data-testid={testIds.channels.deliverySave}
        >
          保存设置
        </Button>
      </Flex>
    </Card>
  )

  return (
    <Flex vertical gap={18} className="page-stack">
      <PageHeader
        title="渠道接入"
        actions={
          <Space>
            <Dropdown popupRender={() => deliverySettingsMenu} trigger={['click']} placement="bottomRight">
              <Button icon={<SettingOutlined />}>
                消息投递设置
              </Button>
            </Dropdown>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void loadChannels()}
              loading={loading}
            >
              刷新
            </Button>
          </Space>
        }
      />

      {/* 统计卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: designTokens.space.md }}>
        <MetricCard
          label="已接入"
          value={channels.filter((c) => c.configured).length}
          tone="primary"
          icon={<CheckCircleOutlined style={{ fontSize: 'var(--nb-text-lg)' }} />}
        />
        <MetricCard
          label="运行中"
          value={channels.filter((c) => c.enabled).length}
          tone="success"
          icon={<CheckCircleOutlined style={{ fontSize: 'var(--nb-text-lg)' }} />}
        />
        <MetricCard
          label="待补全"
          value={channels.filter((c) => c.missingFields.length > 0).length}
          tone="warning"
          icon={<WarningOutlined style={{ fontSize: 'var(--nb-text-lg)' }} />}
        />
      </div>

      {/* 渠道卡片网格 */}
      <SectionCard title="接入渠道">
        {channels.length === 0 ? (
          <Empty description="无匹配项" />
        ) : (
          <div className="channel-card interactive-lift-grid">
            {channels.map((channel, index) => (
              <motion.div
                key={channel.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04, duration: 0.2 }}
                onClick={() => openChannelDrawer(channel.name)}
                className={`channel-card ${selectedChannel === channel.name ? 'is-selected' : ''}`}
              >
                {/* 图标 + 状态 */}
                <Flex align="flex-start" justify="space-between">
                  <ChannelAvatar channelName={channel.name} label={channel.label} size={44} />
                  <Tag
                    bordered={false}
                    color={channel.enabled ? 'success' : channel.configured ? 'processing' : 'default'}
                    style={{ margin: 0, borderRadius: 8, fontSize: 'var(--nb-text-2xs)' }}
                  >
                    {channel.enabled ? '运行中' : channel.configured ? '已配置' : '未配置'}
                  </Tag>
                </Flex>

                {/* 渠道名 */}
                <Typography.Text strong style={{ fontSize: 'var(--nb-text-md)' }}>
                  {channel.label}
                </Typography.Text>
              </motion.div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 渠道配置 Drawer */}
      <Drawer
        title={null}
        placement="right"
        width={520}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        closeIcon={null}
        styles={{
          body: { padding: 0 },
          header: { display: 'none' },
          wrapper: { boxShadow: '-12px 0 40px rgba(0,0,0,0.12)' },
        }}
      >
        <AnimatePresence>
          {drawerOpen && activeChannel && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              {/* Drawer 头部 */}
              <div
                style={{
                  padding: '20px 24px 16px',
                  borderBottom: `1px solid var(--nb-border)`,
                  background: 'var(--nb-surface-strong)',
                }}
              >
                <Flex align="center" justify="space-between">
                  <Flex align="center" gap={12}>
                    <ChannelAvatar channelName={activeChannel.name} label={activeChannel.label} size={40} />
                    <div>
                      <Typography.Text strong style={{ fontSize: 'var(--nb-text-lg)', display: 'block' }}>
                        {activeChannel.label}
                      </Typography.Text>
                      <ChannelStatusTag status={activeChannel.status} />
                    </div>
                  </Flex>
                  <Flex align="center" gap={12}>
                    <Flex align="center" gap={6}>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>启用</Typography.Text>
                      <Switch
                        size="small"
                        checked={Boolean(activeDraft.enabled ?? activeChannel.enabled)}
                        onChange={(checked) => {
                          if (!checked && activeChannel.enabled) {
                            setConfirmDisable(activeChannel.name)
                          } else {
                            void toggleChannel(activeChannel.name, checked)
                          }
                        }}
                      />
                    </Flex>
                    <Button
                      type="text"
                      icon={<CloseOutlined />}
                      onClick={() => setDrawerOpen(false)}
                      size="small"
                    />
                  </Flex>
                </Flex>


              </div>

              {/* Drawer 内容 */}
              <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
                {/* 缺失字段提示 */}
                {activeChannel.missingFields.length > 0 && (
                  <Flex
                    align="center"
                    gap={8}
                    style={{
                      padding: '10px 14px',
                      background: `${token.colorWarning}10`,
                      borderRadius: 10,
                      marginBottom: designTokens.space.md,
                      border: `1px solid ${token.colorWarning}30`,
                    }}
                  >
                    <WarningOutlined style={{ color: token.colorWarning }} />
                    <Typography.Text style={{ fontSize: 'var(--nb-text-sm)' }}>
                      还需填写 {activeChannel.missingFields.length} 个必填项
                    </Typography.Text>
                  </Flex>
                )}

                {/* 测试结果（折叠） */}
                {activeProbe && (
                  <Collapse
                    ghost
                    defaultActiveKey={['probe']}
                    items={[{
                      key: 'probe',
                      label: (
                        <Flex align="center" gap={8}>
                          <Tag color={getProbeStatusColor(activeProbe.status)} style={{ margin: 0 }}>
                            {activeProbe.statusLabel}
                          </Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                            {activeProbe.summary}
                          </Typography.Text>
                        </Flex>
                      ),
                      children: activeProbe.checks.length > 0 ? (
                        <Flex vertical gap={designTokens.space.xs}>
                          {activeProbe.checks.map((check) => (
                            <Flex key={check.key} justify="space-between" align="center" gap={designTokens.space.xs}>
                              <Typography.Text type="secondary">{check.label}</Typography.Text>
                              <Tag color={getProbeCheckColor(check.status)}>
                                {check.status === 'pass' ? '通过' : check.status === 'warn' ? '警告' : '失败'}
                              </Tag>
                            </Flex>
                          ))}
                        </Flex>
                      ) : null,
                    }]}
                    style={{ marginBottom: designTokens.space.md }}
                  />
                )}

                {/* 配置表单 */}
                <Form form={form} layout="vertical">
                  <div
                    style={{
                      display: 'grid',
                      gap: designTokens.space.sm,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    }}
                  >
                    {activeChannel.meta.primaryFields.map((field) =>
                      renderField(activeChannel.name, field),
                    )}
                  </div>
                </Form>

                {/* WeChat 扫码绑定 */}
                {activeChannel.name === 'weixin' && (
                  <Card
                    size="small"
                    style={{
                      marginTop: designTokens.space.md,
                      borderRadius: 12,
                      border: '1px solid var(--nb-card-subtle-border)',
                    }}
                    styles={{ body: { padding: 16 } }}
                  >
                    <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
                      <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>
                        扫码绑定
                      </Typography.Text>
                      <Space size={8}>
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          loading={weixinBindingLoading}
                          onClick={() => void loadWeixinBindingStatus()}
                        >
                          刷新
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          loading={weixinBindingStarting}
                          onClick={() => void startWeixinBinding()}
                        >
                          获取二维码
                        </Button>
                        {weixinBinding?.running && (
                          <Button
                            size="small"
                            danger
                            icon={<PauseCircleOutlined />}
                            loading={weixinBindingStopping}
                            onClick={() => void stopWeixinBinding()}
                          >
                            停止
                          </Button>
                        )}
                      </Space>
                    </Flex>

                    {weixinBinding ? (
                      <Flex vertical gap={10}>
                        <Space size={8}>
                          <Tag color={weixinBinding.running ? 'processing' : 'default'}>
                            {weixinBinding.running ? '运行中' : '未运行'}
                          </Tag>
                          <Tag color={weixinBinding.authenticated ? 'success' : 'warning'}>
                            {weixinBinding.authenticated ? '已认证' : '未认证'}
                          </Tag>
                        </Space>
                        {weixinBinding.qrCode ? (
                          <Flex vertical align="center" gap={8} style={{ padding: '12px 0' }}>
                            <QRCode value={weixinBinding.qrCode} size={180} />
                            <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                              请用微信扫描上方二维码登录
                            </Typography.Text>
                          </Flex>
                        ) : (
                          <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>
                            {weixinBinding.authenticated ? '已成功登录' : '点击“获取二维码”启动绑定流程'}
                          </Typography.Text>
                        )}
                        {weixinBinding.lastError && (
                          <Alert type="error" message={weixinBinding.lastError} showIcon style={{ borderRadius: 8 }} />
                        )}
                      </Flex>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>
                        点击“获取二维码”启动微信扫码绑定
                      </Typography.Text>
                    )}
                  </Card>
                )}
              </div>

              {/* Drawer 底部操作栏 */}
              <div
                style={{
                  padding: '14px 24px',
                  borderTop: `1px solid var(--nb-border)`,
                  background: 'var(--nb-surface-strong)',
                }}
              >
                <Flex gap={8} justify="flex-end">
                  <Button
                    icon={<ExperimentOutlined />}
                    onClick={() => void testChannel(activeChannel.name)}
                    loading={testing}
                  >
                    测试连接
                  </Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => void saveChannel(activeChannel.name)}
                    loading={saving}
                    data-testid={testIds.channels.detailSave}
                  >
                    保存配置
                  </Button>
                </Flex>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Drawer>

      {/* 停用确认弹窗 */}
      <Modal
        open={Boolean(confirmDisable)}
        title="停用渠道"
        okText="停用"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        destroyOnHidden
        centered
        onCancel={() => setConfirmDisable(null)}
        onOk={() => {
          if (confirmDisable) {
            void toggleChannel(confirmDisable, false)
          }
          setConfirmDisable(null)
        }}
      >
        <Typography.Paragraph type="secondary">
          确定要停用「
          {channels.find((c) => c.name === confirmDisable)?.label || confirmDisable}」吗？停用后该渠道将不再接收和处理消息。
        </Typography.Paragraph>
      </Modal>
    </Flex>
  )
}
