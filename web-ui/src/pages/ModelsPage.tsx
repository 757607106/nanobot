import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { api } from '../api'
import PageHero from '../components/PageHero'
import { providerCategoryLabels, providerDescriptions } from '../configMeta'
import { getModelSuggestions } from '../modelCatalog'
import {
  buildProviderConfig,
  ensureProviderSelection,
  getProviderMeta,
  getProviderOptions,
  normalizeModelConfig,
  updateProviderFieldValue,
} from '../modelConfig'
import type { ConfigData, ConfigMeta } from '../types'

const { Text, Paragraph } = Typography

export default function ModelsPage() {
  const { message } = App.useApp()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void loadModels()
  }, [])

  const selectedProvider = config?.agents.defaults.provider ?? ''
  const selectedProviderMeta = getProviderMeta(configMeta, selectedProvider)
  const selectedProviderConfig = (selectedProvider
    ? config?.providers[selectedProvider]
    : null) ?? buildProviderConfig(selectedProviderMeta ?? undefined)
  const suggestedModels = useMemo(
    () => getModelSuggestions(selectedProvider, config?.agents.defaults.model),
    [config?.agents.defaults.model, selectedProvider],
  )

  const providerOptions = useMemo(() => getProviderOptions(configMeta), [configMeta])

  async function loadModels() {
    try {
      setLoading(true)
      const [configResult, metaResult] = await Promise.all([api.getConfig(), api.getConfigMeta()])
      setConfig(normalizeModelConfig(configResult, metaResult))
      setConfigMeta(metaResult)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载模型配置失败')
    } finally {
      setLoading(false)
    }
  }

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

  function updateSelectedProvider(providerName: string) {
    updateConfig((current) => ensureProviderSelection(current, providerName, configMeta))
  }

  function updateProviderField(field: 'apiKey' | 'apiBase', value: string) {
    if (!selectedProvider) {
      return
    }
    updateConfig((current) => updateProviderFieldValue(current, selectedProvider, selectedProviderMeta, field, value))
  }

  async function saveCurrentConfig() {
    if (!config) {
      return
    }
    try {
      setSaving(true)
      const saved = await api.updateConfig(config)
      const meta = await api.getConfigMeta()
      setConfig(normalizeModelConfig(saved, meta))
      setConfigMeta(meta)
      message.success('模型配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存模型配置失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!config || !configMeta || !selectedProviderMeta) {
    return <Empty description="当前无法读取模型配置" className="page-card" />
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="模型配置"
        title="先把默认模型接通"
        description="围绕供应商、Base URL、API Key 和模型完成默认配置。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadModels()}>
              刷新
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveCurrentConfig()}>
              保存
            </Button>
          </Space>
        )}
        stats={[
          { label: '当前供应商', value: selectedProviderMeta.label },
          { label: '当前模型', value: config.agents.defaults.model || '待选择' },
          { label: '认证方式', value: selectedProviderMeta.isOauth ? 'OAuth' : 'API Key' },
          {
            label: 'Base URL',
            value: selectedProviderConfig.apiBase || selectedProviderMeta.defaultApiBase || '供应商默认',
          },
        ]}
      />

      <div className="page-grid models-page-grid">
        <div className="page-stack">
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>1. 选择供应商</Typography.Title>
                <Text type="secondary">先选供应商，再补连接信息。</Text>
              </div>
              <Space wrap>
                <Tag>{providerCategoryLabels[selectedProviderMeta.category]}</Tag>
                {selectedProviderMeta.supportsPromptCaching ? <Tag color="cyan">支持提示词缓存</Tag> : null}
              </Space>
            </div>

            <div className="config-field-block">
              <div className="config-field-label-row">
                <Text>默认供应商</Text>
              </div>
              <Select
                value={selectedProvider}
                options={providerOptions}
                style={{ width: '100%' }}
                onChange={updateSelectedProvider}
              />
            </div>

            <Alert
              showIcon
              type={selectedProviderMeta.isLocal ? 'success' : 'info'}
              message={selectedProviderMeta.label}
              description={providerDescriptions[selectedProviderMeta.name] || '会直接映射到后端运行时。'}
            />

            <div className="config-meta-row">
              <div className="config-meta-chip">
                <span>当前解析结果</span>
                <strong>{configMeta.resolvedProvider || 'auto'}</strong>
              </div>
              <div className="config-meta-chip">
                <span>模型关键词</span>
                <strong>{selectedProviderMeta.keywords.join(', ') || '未提供'}</strong>
              </div>
            </div>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>2. 模型</Typography.Title>
                <Text type="secondary">先选常用模型，也支持直接输入。</Text>
              </div>
              <Tag>{suggestedModels.length} 个建议</Tag>
            </div>

            <div className="config-field-block">
              <div className="config-field-label-row">
                <Text>模型名称</Text>
              </div>
              <Input
                value={config.agents.defaults.model}
                placeholder={suggestedModels[0] || '例如 deepseek-chat'}
                onChange={(event) => updateDefaults('model', event.target.value)}
              />
            </div>

            <div className="models-suggestion-list">
              {suggestedModels.map((model) => (
                <Button key={model} onClick={() => updateDefaults('model', model)}>
                  {model}
                </Button>
              ))}
            </div>

            <Paragraph className="models-helper-copy">
              这些建议来自供应商注册信息和 README 示例；如果你有自定义模型名，直接输入即可。
            </Paragraph>
          </Card>
        </div>

        <div className="page-stack">
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>3. 连接信息</Typography.Title>
                <Text type="secondary">这里只保留常用连接字段。</Text>
              </div>
            </div>

            {selectedProviderMeta.isOauth ? (
              <Alert
                showIcon
                type="info"
                message="该供应商使用 OAuth"
                description="该供应商沿用 OAuth 登录流程，这里不直接录入 API Key。"
              />
            ) : (
              <>
                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>API Key</Text>
                  </div>
                  <Input.Password
                    value={selectedProviderConfig.apiKey ?? ''}
                    placeholder={selectedProviderMeta.isLocal ? '本地供应商通常可留空' : '请输入访问密钥'}
                    onChange={(event) => updateProviderField('apiKey', event.target.value)}
                  />
                </div>

                <div className="config-field-block">
                  <div className="config-field-label-row">
                    <Text>Base URL</Text>
                    {selectedProviderMeta.defaultApiBase ? <Tag>供应商默认地址</Tag> : null}
                  </div>
                  <Input
                    value={selectedProviderConfig.apiBase ?? ''}
                    placeholder={selectedProviderMeta.defaultApiBase ?? '留空时使用供应商默认行为'}
                    onChange={(event) => updateProviderField('apiBase', event.target.value)}
                  />
                  {selectedProviderMeta.defaultApiBase ? (
                    <Space wrap>
                      <Button onClick={() => updateProviderField('apiBase', selectedProviderMeta.defaultApiBase || '')}>
                        使用默认地址
                      </Button>
                      <Text type="secondary">{selectedProviderMeta.defaultApiBase}</Text>
                    </Space>
                  ) : null}
                </div>
              </>
            )}
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>4. 推理参数</Typography.Title>
                <Text type="secondary">这里只保留常用推理参数。</Text>
              </div>
            </div>

            <div className="models-settings-grid">
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
                  onChange={(value) => updateDefaults('temperature', value ?? 0)}
                />
              </div>

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
                  onChange={(value) => updateDefaults('reasoningEffort', value ?? null)}
                />
              </div>

              <div className="config-field-block">
                <div className="config-field-label-row">
                  <Text>最大 Tokens</Text>
                </div>
                <InputNumber
                  min={1}
                  value={config.agents.defaults.maxTokens}
                  style={{ width: '100%' }}
                  onChange={(value) => updateDefaults('maxTokens', value ?? 1)}
                />
              </div>

              <div className="config-field-block">
                <div className="config-field-label-row">
                  <Text>上下文窗口</Text>
                </div>
                <InputNumber
                  min={1}
                  value={config.agents.defaults.contextWindowTokens}
                  style={{ width: '100%' }}
                  onChange={(value) => updateDefaults('contextWindowTokens', value ?? 1)}
                />
              </div>

              <div className="config-field-block">
                <div className="config-field-label-row">
                  <Text>最大工具迭代数</Text>
                </div>
                <InputNumber
                  min={1}
                  value={config.agents.defaults.maxToolIterations}
                  style={{ width: '100%' }}
                  onChange={(value) => updateDefaults('maxToolIterations', value ?? 1)}
                />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
