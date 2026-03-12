import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { CodeOutlined, ReloadOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons'
import { api } from '../api'
import PageHero from '../components/PageHero'
import {
  channelCategoryOrder,
  channelCategoryLabels,
  channelMetas,
  providerCategoryLabels,
  providerDescriptions,
  toLabel,
  type ChannelMeta,
  type FieldMeta,
} from '../configMeta'
import type { ConfigData, ConfigMeta, ProviderConfig, ProviderMeta } from '../types'

const { Text } = Typography

type ChannelFilter = 'all' | 'enabled' | 'disabled'

function parseList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readAtPath(root: unknown, path: string[]) {
  return path.reduce<unknown>((cursor, segment) => {
    if (cursor && typeof cursor === 'object') {
      return (cursor as Record<string, unknown>)[segment]
    }
    return undefined
  }, root)
}

function isProviderConfigured(provider: ProviderConfig | undefined) {
  if (!provider) {
    return false
  }
  return Boolean(
    provider.apiKey ||
      provider.apiBase ||
      (provider.extraHeaders && Object.keys(provider.extraHeaders).length > 0),
  )
}

function providerCategoryOrder(meta: ProviderMeta) {
  const order = ['direct', 'standard', 'gateway', 'local', 'oauth']
  return order.indexOf(meta.category)
}

export default function ConfigPage() {
  const { message } = App.useApp()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [configDraft, setConfigDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('runtime')
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false)
  const [jsonEditorTitle, setJsonEditorTitle] = useState('')
  const [jsonEditorPath, setJsonEditorPath] = useState<string[] | null>(null)
  const [jsonEditorDraft, setJsonEditorDraft] = useState('')

  useEffect(() => {
    void loadConfig()
  }, [])

  const providerEntries = useMemo(() => {
    const metaByName = new Map((configMeta?.providers ?? []).map((item) => [item.name, item]))
    return Object.entries(config?.providers ?? {})
      .map(([name, provider]) => ({
        name,
        provider: provider as ProviderConfig,
        meta: metaByName.get(name),
      }))
      .sort((left, right) => {
        const leftOrder = left.meta ? providerCategoryOrder(left.meta) : 99
        const rightOrder = right.meta ? providerCategoryOrder(right.meta) : 99
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder
        }
        return (left.meta?.label ?? left.name).localeCompare(right.meta?.label ?? right.name)
      })
  }, [config?.providers, configMeta?.providers])

  const configuredProviderCount = useMemo(
    () => providerEntries.filter((item) => isProviderConfigured(item.provider)).length,
    [providerEntries],
  )

  const enabledChannelCount = useMemo(() => {
    if (!config) {
      return 0
    }
    return channelMetas.filter((meta) => {
      const channel = readAtPath(config, ['channels', meta.name])
      return Boolean(channel && typeof channel === 'object' && (channel as Record<string, unknown>).enabled)
    }).length
  }, [config])

  const filteredChannelMetas = useMemo(() => {
    if (!config) {
      return []
    }
    return channelMetas.filter((meta) => {
      const channel = readAtPath(config, ['channels', meta.name]) as Record<string, unknown> | undefined
      const enabled = Boolean(channel?.enabled)
      if (channelFilter === 'enabled' && !enabled) {
        return false
      }
      if (channelFilter === 'disabled' && enabled) {
        return false
      }
      return true
    })
  }, [channelFilter, config])

  async function loadConfig() {
    try {
      setLoading(true)
      const [data, meta] = await Promise.all([api.getConfig(), api.getConfigMeta()])
      setConfig(data)
      setConfigMeta(meta)
      setConfigDraft(JSON.stringify(data, null, 2))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  function updateConfig(next: ConfigData) {
    setConfig(next)
    setConfigDraft(JSON.stringify(next, null, 2))
  }

  function updateAtPath(path: string[], value: unknown) {
    if (!config) {
      return
    }
    const next = structuredClone(config) as Record<string, unknown>
    let cursor: Record<string, unknown> = next
    path.slice(0, -1).forEach((segment) => {
      cursor = cursor[segment] as Record<string, unknown>
    })
    cursor[path[path.length - 1]] = value
    updateConfig(next as ConfigData)
  }

  function openJsonEditor(title: string, path: string[]) {
    if (!config) {
      return
    }
    const current = readAtPath(config, path)
    setJsonEditorTitle(title)
    setJsonEditorPath(path)
    setJsonEditorDraft(JSON.stringify(current ?? {}, null, 2))
    setJsonEditorOpen(true)
  }

  function saveJsonEditor() {
    if (!jsonEditorPath) {
      return
    }
    try {
      const parsed = JSON.parse(jsonEditorDraft)
      updateAtPath(jsonEditorPath, parsed)
      setJsonEditorOpen(false)
      message.success('JSON 配置已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'JSON 格式无效')
    }
  }

  async function saveCurrentConfig(target?: ConfigData) {
    const payload = target ?? config
    if (!payload) {
      return
    }
    try {
      setSaving(true)
      const saved = await api.updateConfig(payload)
      const meta = await api.getConfigMeta()
      setConfigMeta(meta)
      updateConfig(saved)
      message.success('配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存配置失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleRawSave() {
    try {
      const parsed = JSON.parse(configDraft) as ConfigData
      await saveCurrentConfig(parsed)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'JSON 格式无效')
    }
  }

  function renderField(field: FieldMeta, basePath: string[]) {
    const value = readAtPath(config, [...basePath, ...field.path])
    const path = [...basePath, ...field.path]

    if (field.kind === 'switch') {
      return (
        <div className="config-field-block" key={path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <Switch checked={Boolean(value)} onChange={(checked) => updateAtPath(path, checked)} />
        </div>
      )
    }

    if (field.kind === 'number') {
      return (
        <div className="config-field-block" key={path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <InputNumber
            min={field.min}
            max={field.max}
            step={field.step}
            value={typeof value === 'number' ? value : undefined}
            style={{ width: '100%' }}
            onChange={(next) => updateAtPath(path, next ?? 0)}
          />
        </div>
      )
    }

    if (field.kind === 'list') {
      return (
        <div className="config-field-block" key={path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <Input.TextArea
            rows={4}
            value={Array.isArray(value) ? value.join('\n') : ''}
            placeholder={field.placeholder}
            onChange={(event) => updateAtPath(path, parseList(event.target.value))}
          />
        </div>
      )
    }

    if (field.kind === 'textarea') {
      return (
        <div className="config-field-block" key={path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <Input.TextArea
            rows={4}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            onChange={(event) => updateAtPath(path, event.target.value)}
          />
        </div>
      )
    }

    if (field.kind === 'select') {
      return (
        <div className="config-field-block" key={path.join('.')}>
          <div className="config-field-label-row">
            <Text>{field.label}</Text>
          </div>
          <Select
            value={typeof value === 'string' ? value : undefined}
            options={field.options}
            style={{ width: '100%' }}
            onChange={(next) => updateAtPath(path, next)}
          />
        </div>
      )
    }

    const sharedProps = {
      value: String(value ?? ''),
      placeholder: field.placeholder,
      onChange: (event: ChangeEvent<HTMLInputElement>) => updateAtPath(path, event.target.value),
    }

    return (
      <div className="config-field-block" key={path.join('.')}>
        <div className="config-field-label-row">
          <Text>{field.label}</Text>
        </div>
        {field.kind === 'password' ? <Input.Password {...sharedProps} /> : <Input {...sharedProps} />}
      </div>
    )
  }

  function renderProviderCard(name: string, provider: ProviderConfig, meta?: ProviderMeta) {
    const configured = isProviderConfigured(provider)
    const showApiBase =
      Boolean(provider.apiBase) ||
      meta?.isGateway ||
      meta?.isLocal ||
      meta?.isDirect ||
      name === 'azure_openai'

    return (
      <Col xs={24} xl={12} key={name}>
        <Card className={`config-panel-card ${configured ? 'is-configured' : ''}`}>
          <div className="config-card-header">
            <div>
              <Space wrap>
                <Typography.Title level={4}>{meta?.label ?? toLabel(name)}</Typography.Title>
                <Tag color={configured ? 'green' : 'default'}>
                  {configured ? '已配置' : '未配置'}
                </Tag>
                {meta ? <Tag>{providerCategoryLabels[meta.category]}</Tag> : null}
                {configMeta?.resolvedProvider === name ? <Tag color="cyan">当前运行中</Tag> : null}
              </Space>
              <Text type="secondary">
                {providerDescriptions[name] || '该供应商配置会直接映射到当前后端运行时。'}
              </Text>
            </div>
            <Button onClick={() => openJsonEditor(`${meta?.label ?? name} 请求头`, ['providers', name, 'extraHeaders'])}>
              请求头 JSON
            </Button>
          </div>

          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {meta?.isOauth ? (
              <Alert
                type="info"
                showIcon
                message="该供应商通过 OAuth 管理"
                description="认证流程不在配置页内完成，这里主要用于保持运行时模型与供应商选择一致。"
              />
            ) : (
              <Row gutter={[16, 16]}>
                <Col xs={24} md={showApiBase ? 12 : 24}>
                  <div className="config-field-block">
                    <div className="config-field-label-row">
                      <Text>API 密钥</Text>
                    </div>
                    <Input.Password
                      value={provider.apiKey ?? ''}
                      placeholder={meta?.isLocal ? '本地运行时可选' : '请输入 API 密钥'}
                      onChange={(event) => updateAtPath(['providers', name, 'apiKey'], event.target.value)}
                    />
                  </div>
                </Col>
                {showApiBase ? (
                  <Col xs={24} md={12}>
                    <div className="config-field-block">
                      <div className="config-field-label-row">
                        <Text>API Base 地址</Text>
                        {meta?.defaultApiBase ? <Tag>{meta.defaultApiBase}</Tag> : null}
                      </div>
                      <Input
                        value={provider.apiBase ?? ''}
                        placeholder={meta?.defaultApiBase ?? '可选覆盖默认地址'}
                        onChange={(event) =>
                          updateAtPath(['providers', name, 'apiBase'], event.target.value || null)
                        }
                      />
                    </div>
                  </Col>
                ) : null}
              </Row>
            )}

            <div className="config-meta-row">
              {meta?.keywords?.length ? (
                <div className="config-meta-chip">
                  <span>模型提示</span>
                  <strong>{meta.keywords.join(', ')}</strong>
                </div>
              ) : null}
              {meta?.supportsPromptCaching ? (
                <div className="config-meta-chip">
                  <span>能力</span>
                  <strong>支持提示词缓存</strong>
                </div>
              ) : null}
              {provider.extraHeaders && Object.keys(provider.extraHeaders).length > 0 ? (
                <div className="config-meta-chip">
                  <span>请求头</span>
                  <strong>{Object.keys(provider.extraHeaders).length} 项自定义</strong>
                </div>
              ) : null}
            </div>
          </Space>
        </Card>
      </Col>
    )
  }

  function renderChannelCard(meta: ChannelMeta) {
    const channel = readAtPath(config, ['channels', meta.name]) as Record<string, unknown> | undefined
    const enabled = Boolean(channel?.enabled)
    return (
      <Col xs={24} xl={12} key={meta.name}>
        <Card className={`config-panel-card ${enabled ? 'is-configured' : ''}`}>
          <div className="config-card-header">
            <div>
              <Space wrap>
                <Typography.Title level={4}>{meta.label}</Typography.Title>
                <Tag color={enabled ? 'green' : 'default'}>{enabled ? '已启用' : '已停用'}</Tag>
                <Tag>{channelCategoryLabels[meta.category]}</Tag>
              </Space>
              <Text type="secondary">{meta.description}</Text>
            </div>
            <Switch
              checked={enabled}
              onChange={(checked) => updateAtPath(['channels', meta.name, 'enabled'], checked)}
            />
          </div>

          <Row gutter={[16, 16]}>
            {meta.primaryFields.map((field) => (
              <Col xs={24} md={field.kind === 'textarea' || field.kind === 'list' ? 24 : 12} key={field.path.join('.')}>
                {renderField(field, ['channels', meta.name])}
              </Col>
            ))}
          </Row>

          <div className="config-card-footer">
            <Text type="secondary">
              如果你需要后端完整结构，可以继续通过 JSON 方式编辑更深层的频道配置。
            </Text>
            <Button onClick={() => openJsonEditor(`${meta.label} JSON`, ['channels', meta.name])}>
              高级 JSON
            </Button>
          </div>
        </Card>
      </Col>
    )
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!config) {
    return <Empty description="当前无法读取配置" className="page-card" />
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="运行时配置"
        title="配置模型供应商、频道与运行默认值"
        description="这个页面与当前后端 schema 对齐，每一块都映射真实运行能力，而不是单纯展示 JSON。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadConfig()}>
              重新加载
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveCurrentConfig()}>
              保存更改
            </Button>
          </Space>
        )}
        stats={[
          { label: '当前解析供应商', value: configMeta?.resolvedProvider ?? 'auto' },
          { label: '当前模型', value: config.agents.defaults.model },
          { label: '已配置供应商', value: configuredProviderCount },
          { label: '已启用频道', value: enabledChannelCount },
        ]}
      />

      <div className="page-card tabs-shell">
        <Tabs
          className="console-tabs"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'runtime',
              label: '运行时',
              children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Alert
                  showIcon
                  type="info"
                  message="先确认运行时默认值"
                  description="这些字段决定了保存后当前 Web 后端使用哪个工作区、模型与运行策略。"
                />
                <Card className="config-panel-card">
                  <div className="config-card-header">
                    <div>
                      <Typography.Title level={4}>Agent 默认设置</Typography.Title>
                      <Text type="secondary">当前后端进程的核心运行参数。</Text>
                    </div>
                    <Tag icon={<SettingOutlined />}>主运行时</Tag>
                  </div>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <div className="config-field-block">
                        <div className="config-field-label-row">
                          <Text>工作区</Text>
                        </div>
                        <Input
                          value={config.agents.defaults.workspace}
                          onChange={(event) => updateAtPath(['agents', 'defaults', 'workspace'], event.target.value)}
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={12}>
                      <div className="config-field-block">
                        <div className="config-field-label-row">
                          <Text>模型</Text>
                        </div>
                        <Input
                          value={config.agents.defaults.model}
                          onChange={(event) => updateAtPath(['agents', 'defaults', 'model'], event.target.value)}
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={8}>
                      <div className="config-field-block">
                        <div className="config-field-label-row">
                          <Text>强制供应商</Text>
                        </div>
                        <Select
                          value={config.agents.defaults.provider}
                          options={[
                            { label: '自动', value: 'auto' },
                            ...(configMeta?.providers ?? []).map((item) => ({
                              label: item.label,
                              value: item.name,
                            })),
                          ]}
                          style={{ width: '100%' }}
                          onChange={(value) => updateAtPath(['agents', 'defaults', 'provider'], value)}
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={8}>
                      <div className="config-field-block">
                        <div className="config-field-label-row">
                          <Text>温度</Text>
                        </div>
                        <InputNumber
                          min={0}
                          max={2}
                          step={0.1}
                          value={config.agents.defaults.temperature}
                          style={{ width: '100%' }}
                          onChange={(value) => updateAtPath(['agents', 'defaults', 'temperature'], value ?? 0)}
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={8}>
                      <div className="config-field-block">
                        <div className="config-field-label-row">
                          <Text>推理强度</Text>
                        </div>
                        <Select
                          allowClear
                          value={config.agents.defaults.reasoningEffort ?? undefined}
                          options={[
                            { label: '低', value: 'low' },
                            { label: '中', value: 'medium' },
                            { label: '高', value: 'high' },
                          ]}
                          style={{ width: '100%' }}
                          onChange={(value) => updateAtPath(['agents', 'defaults', 'reasoningEffort'], value ?? null)}
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={8}>
                      <div className="config-field-block">
                        <div className="config-field-label-row">
                          <Text>最大 Tokens</Text>
                        </div>
                        <InputNumber
                          min={1}
                          value={config.agents.defaults.maxTokens}
                          style={{ width: '100%' }}
                          onChange={(value) => updateAtPath(['agents', 'defaults', 'maxTokens'], value ?? 1)}
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={8}>
                      <div className="config-field-block">
                        <div className="config-field-label-row">
                          <Text>上下文窗口</Text>
                        </div>
                        <InputNumber
                          min={1}
                          value={config.agents.defaults.contextWindowTokens}
                          style={{ width: '100%' }}
                          onChange={(value) =>
                            updateAtPath(['agents', 'defaults', 'contextWindowTokens'], value ?? 1)
                          }
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={8}>
                      <div className="config-field-block">
                        <div className="config-field-label-row">
                          <Text>最大工具迭代数</Text>
                        </div>
                        <InputNumber
                          min={1}
                          value={config.agents.defaults.maxToolIterations}
                          style={{ width: '100%' }}
                          onChange={(value) =>
                            updateAtPath(['agents', 'defaults', 'maxToolIterations'], value ?? 1)
                          }
                        />
                      </div>
                    </Col>
                  </Row>
                </Card>
                </Space>
              ),
            },
            {
              key: 'providers',
              label: '供应商',
              children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Alert
                  showIcon
                  type="info"
                  message="供应商按运行角色分组"
                  description="托管供应商、聚合网关、本地运行时和 OAuth 接入已分开显示，与你当前后端的模型解析逻辑一致。"
                />
                {['direct', 'standard', 'gateway', 'local', 'oauth'].map((category) => {
                  const items = providerEntries.filter((item) => item.meta?.category === category)
                  if (items.length === 0) {
                    return null
                  }
                  return (
                    <div key={category} className="config-section-stack">
                      <div className="section-heading-row">
                        <div>
                          <Typography.Title level={4}>{providerCategoryLabels[category]}</Typography.Title>
                          <Text type="secondary">
                            {category === 'gateway'
                              ? '可统一路由多个模型家族的聚合网关。'
                              : category === 'local'
                                ? '通常依赖 API Base 地址的本地或自托管运行时。'
                                : category === 'oauth'
                                  ? '认证流程不依赖普通 API Key，而是走外部 OAuth。'
                                  : category === 'direct'
                                    ? '绕过通用网关逻辑的自定义直连端点。'
                                    : '通过模型命名直接匹配的官方托管供应商。'}
                          </Text>
                        </div>
                        <Tag>{items.length} 项配置</Tag>
                      </div>
                      <Row gutter={[16, 16]}>
                        {items.map((item) => renderProviderCard(item.name, item.provider, item.meta))}
                      </Row>
                    </div>
                  )
                })}
                </Space>
              ),
            },
            {
              key: 'channels',
              label: '频道',
              children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card className="config-panel-card">
                  <div className="config-card-header">
                    <div>
                      <Typography.Title level={4}>投递行为</Typography.Title>
                      <Text type="secondary">
                        控制所有已启用频道中的进度流和工具提示行为。
                      </Text>
                    </div>
                    <Segmented
                      value={channelFilter}
                      onChange={(value) => setChannelFilter(value as ChannelFilter)}
                      options={[
                        { label: '全部', value: 'all' },
                        { label: '已启用', value: 'enabled' },
                        { label: '已停用', value: 'disabled' },
                      ]}
                    />
                  </div>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <div className="channel-flag-card">
                        <div>
                          <Text strong>发送进度</Text>
                          <Text type="secondary">把 agent 的中间进度流式发送到频道。</Text>
                        </div>
                        <Switch
                          checked={Boolean(config.channels.sendProgress)}
                          onChange={(checked) => updateAtPath(['channels', 'sendProgress'], checked)}
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={12}>
                      <div className="channel-flag-card">
                        <div>
                          <Text strong>发送工具提示</Text>
                          <Text type="secondary">展示 read_file、web_search 之类的工具调用提示。</Text>
                        </div>
                        <Switch
                          checked={Boolean(config.channels.sendToolHints)}
                          onChange={(checked) => updateAtPath(['channels', 'sendToolHints'], checked)}
                        />
                      </div>
                    </Col>
                  </Row>
                </Card>

                {channelCategoryOrder.map((category) => {
                  const items = filteredChannelMetas.filter((meta) => meta.category === category)
                  if (items.length === 0) {
                    return null
                  }
                  return (
                    <div key={category} className="config-section-stack">
                      <div className="section-heading-row">
                        <div>
                          <Typography.Title level={4}>{channelCategoryLabels[category]}</Typography.Title>
                          <Text type="secondary">
                            {category === 'Social'
                              ? '面向公众消息场景的聊天平台和社交机器人接入。'
                              : category === 'Collaboration'
                                ? '适用于内部协作和运营流程的团队沟通平台。'
                                : category === 'Enterprise'
                                  ? '带有企业组织路由能力的消息平台。'
                                  : '面向邮箱收件与自动化处理的投递方式。'}
                          </Text>
                        </div>
                        <Tag>{items.length} 个接入项</Tag>
                      </div>
                      <Row gutter={[16, 16]}>
                        {items.map((meta) => renderChannelCard(meta))}
                      </Row>
                    </div>
                  )
                })}
                </Space>
              ),
            },
            {
              key: 'tools',
              label: '工具与网关',
              children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}>
                    <Card className="config-panel-card">
                      <div className="config-card-header">
                        <div>
                          <Typography.Title level={4}>工具安全</Typography.Title>
                          <Text type="secondary">限制工作区访问范围，并配置联网工具的行为。</Text>
                        </div>
                        <Tag>执行控制</Tag>
                      </div>
                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                          <div className="channel-flag-card">
                            <div>
                              <Text strong>限制在工作区内</Text>
                              <Text type="secondary">把文件与命令访问范围限制在当前工作区。</Text>
                            </div>
                            <Switch
                              checked={Boolean(config.tools.restrictToWorkspace)}
                              onChange={(checked) => updateAtPath(['tools', 'restrictToWorkspace'], checked)}
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="config-field-block">
                            <div className="config-field-label-row">
                              <Text>网页代理</Text>
                            </div>
                            <Input
                              value={config.tools.web?.proxy ?? ''}
                              placeholder="http://127.0.0.1:7890"
                              onChange={(event) => updateAtPath(['tools', 'web', 'proxy'], event.target.value || null)}
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="config-field-block">
                            <div className="config-field-label-row">
                              <Text>Brave Search API 密钥</Text>
                            </div>
                            <Input.Password
                              value={config.tools.web?.search?.apiKey ?? ''}
                              onChange={(event) =>
                                updateAtPath(['tools', 'web', 'search', 'apiKey'], event.target.value)
                              }
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="config-field-block">
                            <div className="config-field-label-row">
                              <Text>搜索最大结果数</Text>
                            </div>
                            <InputNumber
                              min={1}
                              value={config.tools.web?.search?.maxResults ?? 5}
                              style={{ width: '100%' }}
                              onChange={(value) =>
                                updateAtPath(['tools', 'web', 'search', 'maxResults'], value ?? 5)
                              }
                            />
                          </div>
                        </Col>
                      </Row>
                    </Card>
                  </Col>

                  <Col xs={24} xl={12}>
                    <Card className="config-panel-card">
                      <div className="config-card-header">
                        <div>
                          <Typography.Title level={4}>网关运行时</Typography.Title>
                          <Text type="secondary">控制长运行服务的 Host、端口和心跳行为。</Text>
                        </div>
                        <Tag>服务参数</Tag>
                      </div>
                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                          <div className="config-field-block">
                            <div className="config-field-label-row">
                              <Text>网关 Host</Text>
                            </div>
                            <Input
                              value={String(config.gateway.host ?? '')}
                              onChange={(event) => updateAtPath(['gateway', 'host'], event.target.value)}
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="config-field-block">
                            <div className="config-field-label-row">
                              <Text>网关端口</Text>
                            </div>
                            <InputNumber
                              min={1}
                              value={Number(config.gateway.port ?? 18790)}
                              style={{ width: '100%' }}
                              onChange={(value) => updateAtPath(['gateway', 'port'], value ?? 18790)}
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="channel-flag-card">
                            <div>
                              <Text strong>启用心跳</Text>
                              <Text type="secondary">按周期执行心跳检查。</Text>
                            </div>
                            <Switch
                              checked={Boolean(config.gateway.heartbeat?.enabled)}
                              onChange={(checked) => updateAtPath(['gateway', 'heartbeat', 'enabled'], checked)}
                            />
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="config-field-block">
                            <div className="config-field-label-row">
                              <Text>心跳间隔（秒）</Text>
                            </div>
                            <InputNumber
                              min={1}
                              value={Number(config.gateway.heartbeat?.intervalS ?? 1800)}
                              style={{ width: '100%' }}
                              onChange={(value) =>
                                updateAtPath(['gateway', 'heartbeat', 'intervalS'], value ?? 1800)
                              }
                            />
                          </div>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>

                <Card className="config-panel-card">
                  <div className="config-card-header">
                    <div>
                      <Typography.Title level={4}>MCP 服务</Typography.Title>
                      <Text type="secondary">
                        为了保持与后端结构一致，MCP 定义仍通过 JSON 完整编辑。
                      </Text>
                    </div>
                    <Button onClick={() => openJsonEditor('MCP 服务 JSON', ['tools', 'mcpServers'])}>
                      编辑 MCP JSON
                    </Button>
                  </div>
                  <div className="mono-block mono-block-large">
                    {JSON.stringify(config.tools.mcpServers ?? {}, null, 2)}
                  </div>
                </Card>
                </Space>
              ),
            },
            {
              key: 'raw',
              label: '原始 JSON',
              children: (
                <Card className="config-panel-card">
                <Form layout="vertical">
                  <Form.Item label="完整后端配置">
                    <Input.TextArea
                      className="config-json-editor"
                      value={configDraft}
                      spellCheck={false}
                      onChange={(event) => setConfigDraft(event.target.value)}
                      style={{
                        height: 'clamp(360px, 58vh, 780px)',
                        resize: 'none',
                        fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
                      }}
                    />
                  </Form.Item>
                </Form>
                <Space wrap>
                  <Button icon={<CodeOutlined />} onClick={() => setConfigDraft(JSON.stringify(config, null, 2))}>
                    重置草稿
                  </Button>
                  <Button type="primary" loading={saving} onClick={() => void handleRawSave()}>
                    保存原始 JSON
                  </Button>
                </Space>
                </Card>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={jsonEditorOpen}
        title={jsonEditorTitle}
        onCancel={() => setJsonEditorOpen(false)}
        onOk={saveJsonEditor}
        okText="应用 JSON"
        width={760}
      >
        <Input.TextArea
          className="config-json-editor"
          value={jsonEditorDraft}
          spellCheck={false}
          onChange={(event) => setJsonEditorDraft(event.target.value)}
          style={{
            height: 'clamp(320px, 54vh, 720px)',
            resize: 'none',
            fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
          }}
        />
      </Modal>
    </div>
  )
}
