import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Segmented,
  Space,
  Spin,
  Switch,
  Typography,
} from 'antd'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import { providerDescriptions } from '../configMeta'
import {
  ensureProviderSelection,
  getProviderMeta,
  getProviderOptions,
  normalizeModelConfig,
  updateProviderFieldValue,
} from '../modelConfig'
import { useSetup } from '../setup'
import { testIds } from '../testIds'
import type { ConfigData, ConfigMeta, SetupStatus } from '../types'

type WizardStepKey = 'provider' | 'channel' | 'agent'

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

function isStepAvailable(status: SetupStatus, key: WizardStepKey) {
  const order: WizardStepKey[] = ['provider', 'channel', 'agent']
  const stepIndex = order.indexOf(key)
  if (stepIndex <= 0) {
    return true
  }
  return order.slice(0, stepIndex).every((item) => status.steps.find((step) => step.key === item)?.complete)
}

export default function SetupPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { applyStatus, refresh, status: setupStatus } = useSetup()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeStep, setActiveStep] = useState<WizardStepKey>('provider')
  const [channelMode, setChannelMode] = useState<'skip' | 'telegram'>('skip')

  useEffect(() => {
    if (!setupStatus) {
      return
    }
    if (setupStatus.completed) {
      navigate('/chat', { replace: true })
      return
    }
    if (setupStatus.currentStep !== 'done') {
      setActiveStep(setupStatus.currentStep)
    }
  }, [navigate, setupStatus])

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      try {
        const [configResult, metaResult, setupResult] = await Promise.all([
          api.getConfig(),
          api.getConfigMeta(),
          refresh(),
        ])
        if (!active) {
          return
        }
        setConfig(normalizeModelConfig(configResult, metaResult))
        setConfigMeta(metaResult)
        if (setupResult) {
          applyStatus(setupResult)
        }
        setError(null)
      } catch (error) {
        if (!active) {
          return
        }
        setError(getErrorMessage(error, '无法加载首次配置向导'))
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
    const telegramChannel = config.channels['telegram'] as { enabled?: boolean } | undefined
    const telegramEnabled = Boolean(telegramChannel && telegramChannel.enabled)
    const channelStep = setupStatus.steps.find((item) => item.key === 'channel')
    setChannelMode(channelStep?.skipped ? 'skip' : telegramEnabled ? 'telegram' : 'skip')
  }, [config, setupStatus])

  const providerName = useMemo(() => {
    const candidate = String(config?.agents.defaults.provider || '').trim()
    if (candidate && candidate !== 'auto') {
      return candidate
    }
    return configMeta?.providers.find((item) => item.category !== 'oauth')?.name ?? configMeta?.providers[0]?.name ?? 'deepseek'
  }, [config?.agents.defaults.provider, configMeta])

  const providerMeta = getProviderMeta(configMeta, providerName)
  const providerOptions = useMemo(() => getProviderOptions(configMeta), [configMeta])

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
            ...((current.channels['telegram'] as Record<string, unknown> | undefined) ?? {}),
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
        navigate('/chat', { replace: true })
      } else if (result.setup.currentStep !== 'done') {
        setActiveStep(result.setup.currentStep)
      }
    } catch (error) {
      setError(getErrorMessage(error, '保存向导步骤失败'))
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
        apiKey: config.providers[selectedProvider]?.apiKey || '',
        apiBase: config.providers[selectedProvider]?.apiBase || null,
      }),
      '模型供应商已保存',
    )
  }

  async function saveChannelStep() {
    if (!config) {
      return
    }
    if (channelMode === 'skip') {
      await applyMutation(api.updateSetupChannel({ mode: 'skip' }), '已跳过频道配置')
      return
    }
    const telegram = ((config.channels['telegram'] as Record<string, unknown> | undefined) ?? {})
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
      'Agent 默认值已保存',
    )
  }

  if (loading || !config || !configMeta || !setupStatus) {
    return (
      <div className="setup-screen">
        <div className="setup-shell">
          <div className="page-card center-box">
            <Spin size="large" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="setup-screen">
      <div className="setup-shell">
        <PageHero
          eyebrow="FIRST-RUN SETUP"
          title="先把实例接通，再放行工作台"
          description="把供应商、可选频道和默认 Agent 参数确认下来，后续就不需要去配置页翻整份 JSON。"
          className="page-hero-compact"
          badges={setupStatus.steps.map((step) => (
            <span className="hero-badge" key={step.key}>
              {step.label} · {step.complete ? (step.skipped ? '已跳过' : '已完成') : step.optional ? '可选' : '待完成'}
            </span>
          ))}
          stats={[
            { label: '当前步骤', value: setupStatus.currentStep === 'done' ? '完成' : setupStatus.currentStep },
            {
              label: '完成进度',
              value: `${setupStatus.steps.filter((step) => step.complete).length} / ${setupStatus.steps.length}`,
            },
            { label: '实例状态', value: setupStatus.completed ? '可进入工作台' : '等待初始化' },
          ]}
        />

        <div className="page-card setup-step-card">
          <div className="setup-step-row">
            {setupStatus.steps.map((step) => (
              <Button
                key={step.key}
                type={activeStep === step.key ? 'primary' : 'default'}
                onClick={() => setActiveStep(step.key)}
                disabled={!isStepAvailable(setupStatus, step.key)}
                data-testid={
                  step.key === 'provider'
                    ? testIds.setup.stepProvider
                    : step.key === 'channel'
                      ? testIds.setup.stepChannel
                      : testIds.setup.stepAgent
                }
              >
                {step.label}
              </Button>
            ))}
          </div>

          {error ? (
            <Alert
              type="error"
              showIcon
              message={error}
              className="setup-alert"
            />
          ) : null}

          {activeStep === 'provider' ? (
            <Card className="surface-card setup-panel-card">
              <Space direction="vertical" size={18} style={{ width: '100%' }}>
                <div>
                  <Typography.Title level={4}>1. 模型供应商</Typography.Title>
                  <Typography.Paragraph>
                    选择当前实例默认使用的 provider，并补齐模型名与基础认证信息。
                  </Typography.Paragraph>
                </div>

                <label className="setup-field">
                  <span>供应商</span>
                  <Select
                    value={providerName}
                    options={providerOptions}
                    onChange={(value) => updateProvider(value)}
                    data-testid={testIds.setup.providerSelect}
                  />
                </label>

                <label className="setup-field">
                  <span>模型</span>
                  <Input
                    value={String(config.agents.defaults.model || '')}
                    placeholder="例如 deepseek/deepseek-chat"
                    onChange={(event) => updateDefaults('model', event.target.value)}
                    data-testid={testIds.setup.modelInput}
                  />
                </label>

                <div className="setup-note-block">
                  {providerMeta ? providerDescriptions[providerMeta.name] || providerMeta.label : '选择一个可用供应商。'}
                </div>

                {!providerMeta?.isOauth ? (
                  <label className="setup-field">
                    <span>API Key</span>
                    <Input.Password
                      value={config.providers[providerName]?.apiKey || ''}
                      placeholder={providerMeta?.isLocal ? '本地供应商通常可留空' : '填写访问凭证'}
                      onChange={(event) => updateProviderField('apiKey', event.target.value)}
                      data-testid={testIds.setup.apiKeyInput}
                    />
                  </label>
                ) : (
                  <div className="setup-note-block">
                    该供应商走 OAuth，不在本向导里录入 API Key。
                  </div>
                )}

                {!providerMeta?.isOauth ? (
                  <label className="setup-field">
                    <span>API Base</span>
                    <Input
                      value={String(config.providers[providerName]?.apiBase || '')}
                      placeholder={providerMeta?.defaultApiBase || '可留空使用默认地址'}
                      onChange={(event) => updateProviderField('apiBase', event.target.value)}
                      data-testid={testIds.setup.apiBaseInput}
                    />
                  </label>
                ) : null}

                <div className="setup-actions-row">
                  <Button
                    type="primary"
                    loading={saving}
                    onClick={() => void saveProviderStep()}
                    data-testid={testIds.setup.providerSubmit}
                  >
                    保存并继续
                  </Button>
                </div>
              </Space>
            </Card>
          ) : null}

          {activeStep === 'channel' ? (
            <Card className="surface-card setup-panel-card">
              <Space direction="vertical" size={18} style={{ width: '100%' }}>
                <div>
                  <Typography.Title level={4}>2. 消息频道</Typography.Title>
                  <Typography.Paragraph>
                    这是可选步骤。你可以先跳过，也可以先把 Telegram 接起来。
                  </Typography.Paragraph>
                </div>

                <Segmented
                  value={channelMode}
                  options={[
                    { label: '暂不配置', value: 'skip' },
                    { label: 'Telegram', value: 'telegram' },
                  ]}
                  onChange={(value) => setChannelMode(value as 'skip' | 'telegram')}
                  data-testid={testIds.setup.channelMode}
                />

                {channelMode === 'telegram' ? (
                  <>
                    <label className="setup-field">
                      <span>机器人 Token</span>
                      <Input.Password
                        value={String(((config.channels['telegram'] as Record<string, unknown> | undefined) ?? {}).token || '')}
                        placeholder="来自 @BotFather 的 Token"
                        onChange={(event) => updateTelegramField('token', event.target.value)}
                      />
                    </label>

                    <label className="setup-field">
                      <span>允许用户</span>
                      <Input.TextArea
                        rows={4}
                        value={toTextareaValue((((config.channels['telegram'] as Record<string, unknown> | undefined) ?? {}).allowFrom))}
                        placeholder="每行一个用户 ID 或用户名"
                        onChange={(event) => updateTelegramField('allowFrom', parseList(event.target.value))}
                      />
                    </label>

                    <label className="setup-field">
                      <span>代理地址</span>
                      <Input
                        value={String((((config.channels['telegram'] as Record<string, unknown> | undefined) ?? {}).proxy) || '')}
                        placeholder="例如 http://127.0.0.1:7890"
                        onChange={(event) => updateTelegramField('proxy', event.target.value)}
                      />
                    </label>

                    <label className="setup-field">
                      <span>群聊策略</span>
                      <Select
                        value={String((((config.channels['telegram'] as Record<string, unknown> | undefined) ?? {}).groupPolicy) || 'mention')}
                        options={[
                          { label: '仅提及时响应', value: 'mention' },
                          { label: '全部消息响应', value: 'open' },
                        ]}
                        onChange={(value) => updateTelegramField('groupPolicy', value)}
                      />
                    </label>

                    <div className="setup-switch-row">
                      <span>引用原消息回复</span>
                      <Switch
                        checked={Boolean((((config.channels['telegram'] as Record<string, unknown> | undefined) ?? {}).replyToMessage))}
                        onChange={(checked) => updateTelegramField('replyToMessage', checked)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="setup-note-block">
                    跳过后依然可以在配置页继续维护频道，向导会把这一步标记为已完成。
                  </div>
                )}

                <div className="setup-actions-row">
                  <Button loading={saving} onClick={() => setActiveStep('provider')}>
                    返回上一步
                  </Button>
                  <Button
                    type="primary"
                    loading={saving}
                    onClick={() => void saveChannelStep()}
                    data-testid={testIds.setup.channelSubmit}
                  >
                    {channelMode === 'skip' ? '跳过并继续' : '保存频道并继续'}
                  </Button>
                </div>
              </Space>
            </Card>
          ) : null}

          {activeStep === 'agent' ? (
            <Card className="surface-card setup-panel-card">
              <Space direction="vertical" size={18} style={{ width: '100%' }}>
                <div>
                  <Typography.Title level={4}>3. Agent 默认值</Typography.Title>
                  <Typography.Paragraph>
                    确认工作区、上下文窗口、温度和工具循环边界，后续所有新会话都会继承这里的默认值。
                  </Typography.Paragraph>
                </div>

                <label className="setup-field">
                  <span>工作区路径</span>
                  <Input
                    value={String(config.agents.defaults.workspace || '')}
                    onChange={(event) => updateDefaults('workspace', event.target.value)}
                    data-testid={testIds.setup.workspaceInput}
                  />
                </label>

                <div className="setup-grid-two">
                  <label className="setup-field">
                    <span>最大输出 Token</span>
                    <InputNumber
                      min={1}
                      value={Number(config.agents.defaults.maxTokens || 0)}
                      onChange={(value) => updateDefaults('maxTokens', value ?? 0)}
                    />
                  </label>

                  <label className="setup-field">
                    <span>上下文窗口 Token</span>
                    <InputNumber
                      min={1}
                      value={Number(config.agents.defaults.contextWindowTokens || 0)}
                      onChange={(value) => updateDefaults('contextWindowTokens', value ?? 0)}
                    />
                  </label>
                </div>

                <div className="setup-grid-two">
                  <label className="setup-field">
                    <span>温度</span>
                    <InputNumber
                      min={0}
                      max={2}
                      step={0.1}
                      value={Number(config.agents.defaults.temperature || 0)}
                      onChange={(value) => updateDefaults('temperature', value ?? 0)}
                    />
                  </label>

                  <label className="setup-field">
                    <span>最大工具迭代次数</span>
                    <InputNumber
                      min={1}
                      value={Number(config.agents.defaults.maxToolIterations || 0)}
                      onChange={(value) => updateDefaults('maxToolIterations', value ?? 0)}
                    />
                  </label>
                </div>

                <label className="setup-field">
                  <span>推理强度</span>
                  <Select
                    value={String(config.agents.defaults.reasoningEffort || 'medium')}
                    options={[
                      { label: '低', value: 'low' },
                      { label: '中', value: 'medium' },
                      { label: '高', value: 'high' },
                    ]}
                    onChange={(value) => updateDefaults('reasoningEffort', value)}
                  />
                </label>

                <div className="setup-actions-row">
                  <Button loading={saving} onClick={() => setActiveStep('channel')}>
                    返回上一步
                  </Button>
                  <Button
                    type="primary"
                    loading={saving}
                    onClick={() => void saveAgentStep()}
                    data-testid={testIds.setup.agentSubmit}
                  >
                    保存并进入工作台
                  </Button>
                </div>
              </Space>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
