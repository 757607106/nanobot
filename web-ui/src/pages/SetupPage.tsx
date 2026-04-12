import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  MessageOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  InputNumber,
  Layout,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Typography,
  theme,
} from 'antd'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHeader from '../components/console/PageHeader'
import SectionCard from '../components/console/SectionCard'
import {
  ensureProviderSelection,
  getAllModelBindings,
  getProviderMeta,
  getProviderOptions,
  normalizeModelConfig,
  updateProviderFieldValue,
} from '../modelConfig'
import { useSetup } from '../setup'
import { testIds } from '../testIds'
import type { ConfigData, ConfigMeta, SetupStatus } from '../types'
import { useToast } from '../toast'

type ChannelMode = 'skip' | 'telegram'

const { Content } = Layout
const { Text, Title } = Typography

function parseList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toTextareaValue(value: unknown) {
  if (!Array.isArray(value)) {
    return ''
  }
  return value.map((item) => String(item)).join('\n')
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function SectionHeader({
  icon,
  title,
  tag,
}: {
  icon: ReactNode
  title: string
  tag?: ReactNode
}) {
  const { token } = theme.useToken()

  return (
    <Flex align="center" gap={12}>
      <Flex
        align="center"
        justify="center"
        style={{
          width: 40,
          height: 40,
          borderRadius: 14,
          background: `${token.colorPrimary}12`,
          color: token.colorPrimary,
          fontSize: 'var(--nb-title-xs)',
        }}
      >
        {icon}
      </Flex>
      <Title level={4} style={{ margin: 0, flex: 1 }}>
        {title}
      </Title>
      {tag}
    </Flex>
  )
}

export default function SetupPage() {
  const navigate = useNavigate()
  const message = useToast()
  const screens = Grid.useBreakpoint()
  const { applyStatus, status: setupStatus } = useSetup()
  const { token } = theme.useToken()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [channelMode, setChannelMode] = useState<ChannelMode>('skip')

  useEffect(() => {
    if (setupStatus?.completed) {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate, setupStatus])

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      try {
        const [configResult, metaResult] = await Promise.all([api.getConfig(), api.getConfigMeta()])
        if (!active) {
          return
        }
        setConfig(normalizeModelConfig(configResult, metaResult))
        setConfigMeta(metaResult)
        setError(null)
      } catch (currentError) {
        if (!active) {
          return
        }
        setError(getErrorMessage(currentError, '无法加载初始化配置'))
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!config || !setupStatus) {
      return
    }

    const telegramChannel = config.channels.telegram as { enabled?: boolean } | undefined
    const telegramEnabled = Boolean(telegramChannel?.enabled)
    const channelStep = setupStatus.steps.find((item) => item.key === 'channel')
    setChannelMode(channelStep?.skipped ? 'skip' : telegramEnabled ? 'telegram' : 'skip')
  }, [config, setupStatus])

  const isDesktopLayout = Boolean(screens.lg)

  const providerName = useMemo(() => {
    const bindings = config && configMeta ? getAllModelBindings(config, configMeta) : {}
    const configuredBinding = String(config?.agents.defaults.binding || '').trim()
    if (configuredBinding && bindings[configuredBinding]?.provider) {
      return bindings[configuredBinding].provider
    }
    const candidate = String(config?.agents.defaults.provider || '').trim()
    if (candidate && candidate !== 'auto') {
      return candidate
    }
    return (
      configMeta?.providers.find((item) => item.category !== 'oauth')?.name
      ?? configMeta?.providers[0]?.name
      ?? 'deepseek'
    )
  }, [config, configMeta])

  const currentBindingName = useMemo(() => {
    if (!config) {
      return providerName
    }
    const bindings = getAllModelBindings(config, configMeta)
    const configuredBinding = String(config.agents.defaults.binding || '').trim()
    if (configuredBinding && bindings[configuredBinding]?.provider === providerName) {
      return configuredBinding
    }
    return Object.entries(bindings).find(([bindingName, binding]) => {
      return binding.provider === providerName && bindingName === providerName
    })?.[0]
      ?? Object.entries(bindings).find(([, binding]) => binding.provider === providerName)?.[0]
      ?? providerName
  }, [config, configMeta, providerName])

  const providerMeta = getProviderMeta(configMeta, providerName)
  const providerOptions = useMemo(() => getProviderOptions(configMeta), [configMeta])
  const currentBinding = config ? getAllModelBindings(config, configMeta)[currentBindingName] : null

  function updateConfig(mutator: (draft: ConfigData) => ConfigData) {
    setConfig((current) => (current ? mutator(current) : current))
  }

  function updateDefaults(path: keyof ConfigData['agents']['defaults'], value: unknown) {
    updateConfig((current) => ({
      ...current,
      agents: {
        ...current.agents,
        defaults: {
          ...current.agents.defaults,
          [path]: value,
        },
      },
    }))
  }

  function updateProvider(provider: string) {
    updateConfig((current) => ensureProviderSelection(current, provider, configMeta))
  }

  function updateProviderField(field: 'apiKey' | 'apiBase', value: string) {
    updateConfig((current) => updateProviderFieldValue(current, providerName, providerMeta, field, value))
  }

  function updateTelegramField(field: string, value: unknown) {
    updateConfig((current) => ({
      ...current,
      channels: {
        ...current.channels,
        telegram: {
          ...((current.channels.telegram as Record<string, unknown> | undefined) ?? {}),
          [field]: value,
        },
      },
    }))
  }

  async function applyMutation<T extends { config: ConfigData; setup: SetupStatus }>(
    promise: Promise<T>,
    successMessage: string,
  ) {
    setSaving(true)
    try {
      const result = await promise
      setConfig(configMeta ? normalizeModelConfig(result.config, configMeta) : result.config)
      applyStatus(result.setup)
      setError(null)
      message.success(successMessage)
      if (result.setup.completed) {
        navigate('/dashboard', { replace: true })
      }
    } catch (currentError) {
      setError(getErrorMessage(currentError, '保存初始化配置失败'))
    } finally {
      setSaving(false)
    }
  }

  async function saveProviderStep() {
    if (!config) {
      return
    }
    const selectedProvider = String(config.agents.defaults.provider || providerName)
    await applyMutation(
      api.updateSetupProvider({
        provider: selectedProvider,
        model: String(config.agents.defaults.model || '').trim(),
        bindingId: currentBindingName,
        bindingLabel: currentBinding?.label || null,
        apiKey: currentBinding?.apiKey || '',
        apiBase: currentBinding?.apiBase || null,
      }),
      '模型配置已保存',
    )
  }

  async function saveChannelStep() {
    if (!config) {
      return
    }

    if (channelMode === 'skip') {
      await applyMutation(api.updateSetupChannel({ mode: 'skip' }), '已跳过消息频道配置')
      return
    }

    const telegram = (config.channels.telegram as Record<string, unknown> | undefined) ?? {}
    await applyMutation(
      api.updateSetupChannel({
        mode: 'telegram',
        telegramToken: String(telegram.token || ''),
        telegramAllowFrom: parseList(toTextareaValue(telegram.allowFrom)),
        telegramProxy: String(telegram.proxy || '') || null,
        telegramReplyToMessage: Boolean(telegram.replyToMessage),
        telegramGroupPolicy: (telegram.groupPolicy as 'mention' | 'open' | undefined) || 'mention',
      }),
      '频道配置已保存',
    )
  }

  async function saveAgentStep() {
    if (!config) {
      return
    }

    await applyMutation(
      api.updateSetupAgentDefaults({
        workspace: String(config.agents.defaults.workspace || '').trim(),
        maxTokens: Number(config.agents.defaults.maxTokens || 0),
        contextWindowTokens: Number(config.agents.defaults.contextWindowTokens || 0),
        temperature: Number(config.agents.defaults.temperature || 0),
        maxToolIterations: Number(config.agents.defaults.maxToolIterations || 0),
        reasoningEffort: (config.agents.defaults.reasoningEffort as 'low' | 'medium' | 'high' | null | undefined) ?? null,
      }),
      '默认工作参数已保存',
    )
  }

  if (loading || !config || !configMeta || !setupStatus) {
    return (
      <div className="page-stack" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="系统初始化"
        subtitle="初始化配置"
      />

      <div className="page-content-wrapper" style={{ paddingInline: 'var(--nb-layout-gutter)', paddingBottom: 48 }}>
        <Flex vertical gap={24}>
          {error ? <Alert type="error" showIcon message={error} style={{ borderRadius: 16 }} /> : null}

          {/* 模型接入 */}
          <SectionCard
            title="1. 模型接入"
            description="连接至模型供应方"
            action={<Tag color="blue" bordered={false} style={{ borderRadius: 6 }}>REQUIRED</Tag>}
          >
            <div style={{ marginTop: 8 }}>
              <Form
                colon={false}
                labelAlign="left"
                layout={isDesktopLayout ? 'horizontal' : 'vertical'}
                labelCol={isDesktopLayout ? { flex: '140px' } : undefined}
                wrapperCol={isDesktopLayout ? { flex: 'minmax(0, 1fr)' } : undefined}
                size="large"
              >
                <Form.Item label="供应商">
                  <Select
                    value={providerName}
                    options={providerOptions}
                    onChange={(value) => updateProvider(value)}
                    data-testid={testIds.setup.providerSelect}
                    style={{ borderRadius: 12 }}
                  />
                </Form.Item>

                <Form.Item label="模型名称">
                  <Input
                    placeholder="例如: deepseek-chat"
                    value={String(config.agents.defaults.model || '')}
                    onChange={(event) => updateDefaults('model', event.target.value)}
                    data-testid={testIds.setup.modelInput}
                    style={{ borderRadius: 12 }}
                  />
                </Form.Item>

                {!providerMeta?.isOauth ? (
                  <Form.Item label="访问密钥">
                    <Input.Password
                      value={currentBinding?.apiKey || ''}
                      placeholder={providerMeta?.isLocal ? '无需配置' : 'API Key'}
                      onChange={(event) => updateProviderField('apiKey', event.target.value)}
                      data-testid={testIds.setup.apiKeyInput}
                      style={{ borderRadius: 12 }}
                    />
                  </Form.Item>
                ) : null}

                {!providerMeta?.isOauth ? (
                  <Form.Item label="API 端点">
                    <Input
                      value={String(currentBinding?.apiBase || '')}
                      placeholder={providerMeta?.defaultApiBase || 'https://api.example.com/v1'}
                      onChange={(event) => updateProviderField('apiBase', event.target.value)}
                      data-testid={testIds.setup.apiBaseInput}
                      style={{ borderRadius: 12 }}
                    />
                  </Form.Item>
                ) : null}

                <Flex justify="flex-end" style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    loading={saving}
                    onClick={() => void saveProviderStep()}
                    data-testid={testIds.setup.providerSubmit}
                    style={{ borderRadius: 12, height: 44, padding: '0 24px' }}
                  >
                    保存并验证
                  </Button>
                </Flex>
              </Form>
            </div>
          </SectionCard>

          <div
            style={{
              display: 'grid',
              gap: 24,
              gridTemplateColumns: screens.lg ? 'minmax(0, 1fr) 400px' : 'minmax(0, 1fr)',
            }}
          >
             {/* Agent 默认值 */}
            <SectionCard
              title="2. Agent 工作参数"
              description="配置 Agent 默认行为"
              action={<Tag color="blue" bordered={false} style={{ borderRadius: 6 }}>REQUIRED</Tag>}
            >
              <div style={{ marginTop: 8 }}>
                <Form
                  colon={false}
                  labelAlign="left"
                  layout="vertical"
                  size="large"
                >
                  <Form.Item label="工作区文件路径" tooltip="Nanobot 将在该目录下存储索引和临时数据">
                    <Input
                      value={String(config.agents.defaults.workspace || '')}
                      onChange={(event) => updateDefaults('workspace', event.target.value)}
                      data-testid={testIds.setup.workspaceInput}
                      style={{ borderRadius: 12, background: 'var(--nb-card-subtle-bg)', border: 'none' }}
                    />
                  </Form.Item>

                  <Form.Item label="高级运行参数">
                    <div
                      style={{
                        display: 'grid',
                        gap: 16,
                        gridTemplateColumns: screens.sm ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
                      }}
                    >
                       <Flex vertical gap={6}>
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>最大回复长度</Typography.Text>
                        <InputNumber
                          min={1}
                          value={Number(config.agents.defaults.maxTokens || 0)}
                          onChange={(value) => updateDefaults('maxTokens', value ?? 0)}
                          style={{ borderRadius: 10, width: '100%' }}
                        />
                      </Flex>
                      <Flex vertical gap={6}>
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>记忆上下文窗口</Typography.Text>
                        <InputNumber
                          min={1}
                          value={Number(config.agents.defaults.contextWindowTokens || 0)}
                          onChange={(value) => updateDefaults('contextWindowTokens', value ?? 0)}
                          style={{ borderRadius: 10, width: '100%' }}
                        />
                      </Flex>
                      <Flex vertical gap={6}>
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>温度 (创意性)</Typography.Text>
                        <InputNumber
                          min={0}
                          max={2}
                          step={0.1}
                          value={Number(config.agents.defaults.temperature || 0)}
                          onChange={(value) => updateDefaults('temperature', value ?? 0)}
                          style={{ borderRadius: 10, width: '100%' }}
                        />
                      </Flex>
                      <Flex vertical gap={6}>
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>推理偏好</Typography.Text>
                        <Select
                          value={String(config.agents.defaults.reasoningEffort || 'medium')}
                          options={[
                            { label: 'Low (快)', value: 'low' },
                            { label: 'Medium (均衡)', value: 'medium' },
                            { label: 'High (深)', value: 'high' },
                          ]}
                          onChange={(value) => updateDefaults('reasoningEffort', value)}
                          style={{ borderRadius: 10 }}
                        />
                      </Flex>
                    </div>
                  </Form.Item>

                  <Flex justify="flex-end" style={{ marginTop: 24 }}>
                    <Button
                      type="primary"
                      size="large"
                      loading={saving}
                      onClick={() => void saveAgentStep()}
                      data-testid={testIds.setup.agentSubmit}
                      style={{ 
                        borderRadius: 14, 
                        height: 52, 
                        padding: '0 32px',
                        background: 'var(--nb-accent)',
                        border: 'none',
                        boxShadow: '0 12px 24px -6px color-mix(in srgb, var(--nb-accent) 30%, transparent)'
                      }}
                    >
                      完成配置并进入桌面
                    </Button>
                  </Flex>
                </Form>
              </div>
            </SectionCard>

            {/* 消息频道 */}
            <SectionCard
              title="消息渠道"
              description="可选：接入通讯软件"
              action={<Tag bordered={false} style={{ borderRadius: 6 }}>OPTIONAL</Tag>}
            >
              <Flex vertical gap={16} style={{ marginTop: 8 }}>
                <Segmented
                  block
                  value={channelMode}
                  options={[
                    { label: '稍后', value: 'skip' },
                    { label: 'Telegram', value: 'telegram' },
                  ]}
                  onChange={(value) => setChannelMode(value as ChannelMode)}
                  data-testid={testIds.setup.channelMode}
                />

                {channelMode === 'telegram' ? (
                  <Form layout="vertical" size="middle">
                    <Form.Item label="Bot Token">
                      <Input.Password
                        value={String(((config.channels.telegram as Record<string, unknown> | undefined) ?? {}).token || '')}
                        placeholder="123456:ABC..."
                        onChange={(event) => updateTelegramField('token', event.target.value)}
                        style={{ borderRadius: 8 }}
                      />
                    </Form.Item>

                    <Form.Item label="许可名单">
                      <Input.TextArea
                        rows={3}
                        value={toTextareaValue(((config.channels.telegram as Record<string, unknown> | undefined) ?? {}).allowFrom)}
                        placeholder="每行一个 User ID"
                        onChange={(event) => updateTelegramField('allowFrom', parseList(event.target.value))}
                        style={{ borderRadius: 8 }}
                      />
                    </Form.Item>

                    <Form.Item label="群管理模式">
                      <Select
                        value={String(((config.channels.telegram as Record<string, unknown> | undefined) ?? {}).groupPolicy || 'mention')}
                        options={[
                          { label: '仅被提及时响应', value: 'mention' },
                          { label: '全部消息响应', value: 'open' },
                        ]}
                        onChange={(value) => updateTelegramField('groupPolicy', value)}
                        style={{ borderRadius: 8 }}
                      />
                    </Form.Item>
                  </Form>
                ) : (
                  <Empty
                    image={false}
                    description="暂不接入"
                    style={{ margin: '24px 0' }}
                  />
                )}

                <Button
                  block
                  loading={saving}
                  onClick={() => void saveChannelStep()}
                  data-testid={testIds.setup.channelSubmit}
                  style={{ borderRadius: 10 }}
                >
                  {channelMode === 'telegram' ? '保存核心频道' : '跳过此步'}
                </Button>
              </Flex>
            </SectionCard>
          </div>
        </Flex>
      </div>
    </div>
  )
}
