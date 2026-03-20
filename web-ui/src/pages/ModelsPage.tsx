import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tabs,
  Typography,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api } from '../api'
import { MotionGroup, MotionPanel } from '../components/MotionSurface'
import PageHero from '../components/PageHero'
import type {
  ModelCapability,
  ModelDefaults,
  ModelDefaultsMutationInput,
  ModelProvider,
  ModelProviderMutationInput,
  ModelSelection,
} from '../types'

const { Text, Paragraph, Title } = Typography
const { TextArea } = Input

const CAPABILITIES: ModelCapability[] = ['chat', 'embedding', 'reranker']

const capabilityMeta: Record<ModelCapability, { label: string; description: string; color: string }> = {
  chat: { label: 'Chat', description: '对话与 Agent 运行时的主模型。', color: 'blue' },
  embedding: { label: 'Embedding', description: '知识库解析与向量召回使用。', color: 'cyan' },
  reranker: { label: 'Reranker', description: '可选的重排模型。', color: 'gold' },
}

interface ProviderFormValues {
  displayName: string
  providerType: string
  capabilities: ModelCapability[]
  baseUrl?: string
  apiKey?: string
  apiKeyEnv?: string
  extraHeadersText?: string
  modelsText?: string
  defaultModel?: string
  enabled?: boolean
}

const emptyDefaults = (): Record<ModelCapability, ModelSelection | null> => ({
  chat: null,
  embedding: null,
  reranker: null,
})

function parseJsonObject(raw: string, label: string): Record<string, string> {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {}
  }
  const payload = JSON.parse(trimmed) as Record<string, unknown>
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error(`${label} 必须是 JSON 对象`)
  }
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, String(value ?? '')]).filter(([, value]) => Boolean(value)),
  )
}

function parseList(raw: string | undefined): string[] {
  return (raw || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatSelection(selection: ModelSelection | null | undefined) {
  if (!selection) {
    return '未配置'
  }
  return `${selection.providerId}/${selection.modelName}`
}

function defaultSelection(provider: ModelProvider, capability: ModelCapability): ModelSelection {
  return {
    providerId: provider.providerId,
    modelName: provider.defaultModel || provider.models[0] || '',
    capability,
    providerName: provider.providerType,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl ?? null,
    apiKeyEnv: provider.apiKeyEnv ?? null,
    qualifiedModelName: provider.defaultModel || provider.models[0] || '',
  }
}

function buildFormValues(provider?: ModelProvider | null): ProviderFormValues {
  return {
    displayName: provider?.displayName || '',
    providerType: provider?.providerType || '',
    capabilities: provider?.capabilities?.length ? provider.capabilities : ['chat'],
    baseUrl: provider?.baseUrl || '',
    apiKey: provider?.apiKey || '',
    apiKeyEnv: provider?.apiKeyEnv || '',
    extraHeadersText: JSON.stringify(provider?.extraHeaders || {}, null, 2),
    modelsText: (provider?.models || []).join('\n'),
    defaultModel: provider?.defaultModel || '',
    enabled: provider?.enabled ?? true,
  }
}

export default function ModelsPage() {
  const { message, modal } = App.useApp()
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [defaults, setDefaults] = useState<ModelDefaults | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ModelProvider | null>(null)
  const [providerDrawerOpen, setProviderDrawerOpen] = useState(false)
  const [providerSaving, setProviderSaving] = useState(false)
  const [providerTestingId, setProviderTestingId] = useState<string | null>(null)
  const [modelDefaultsDraft, setModelDefaultsDraft] = useState<Record<ModelCapability, ModelSelection | null>>(emptyDefaults())
  const [providerCatalogQuery, setProviderCatalogQuery] = useState('')
  const [providerCatalogFilter, setProviderCatalogFilter] = useState<'all' | 'enabled' | 'disabled' | 'failed' | 'untested'>('all')
  const [providerForm] = Form.useForm<ProviderFormValues>()

  useEffect(() => {
    void loadResources()
  }, [])

  useEffect(() => {
    if (!defaults) {
      setModelDefaultsDraft(emptyDefaults())
      return
    }
    setModelDefaultsDraft({
      chat: defaults.defaultChat ?? null,
      embedding: defaults.defaultEmbedding ?? null,
      reranker: defaults.defaultReranker ?? null,
    })
  }, [defaults])

  const providersByCapability = useMemo(
    () =>
      CAPABILITIES.reduce(
        (acc, capability) => {
          acc[capability] = providers.filter((provider) => provider.enabled && provider.capabilities.includes(capability))
          return acc
        },
        {} as Record<ModelCapability, ModelProvider[]>,
      ),
    [providers],
  )

  const stats = useMemo(
    () => ({
      total: providers.length,
      enabled: providers.filter((item) => item.enabled).length,
      passed: providers.filter((item) => item.lastTestStatus === 'passed').length,
      chat: providersByCapability.chat.length,
      embedding: providersByCapability.embedding.length,
      reranker: providersByCapability.reranker.length,
    }),
    [providers, providersByCapability],
  )
  const missingDefaultCapabilities = useMemo(
    () => CAPABILITIES.filter((capability) => !modelDefaultsDraft[capability]),
    [modelDefaultsDraft],
  )
  const failedProviders = useMemo(
    () => providers.filter((item) => item.lastTestStatus === 'failed'),
    [providers],
  )
  const untestedProviders = useMemo(
    () => providers.filter((item) => !item.lastTestStatus),
    [providers],
  )
  const filteredProviderCatalog = useMemo(() => {
    const query = providerCatalogQuery.trim().toLowerCase()
    return providers.filter((provider) => {
      const matchesQuery =
        !query
        || provider.displayName.toLowerCase().includes(query)
        || provider.providerType.toLowerCase().includes(query)
        || provider.models.some((model) => model.toLowerCase().includes(query))
      const matchesFilter =
        providerCatalogFilter === 'all'
        || (providerCatalogFilter === 'enabled' && provider.enabled)
        || (providerCatalogFilter === 'disabled' && !provider.enabled)
        || (providerCatalogFilter === 'failed' && provider.lastTestStatus === 'failed')
        || (providerCatalogFilter === 'untested' && !provider.lastTestStatus)
      return matchesQuery && matchesFilter
    })
  }, [providerCatalogFilter, providerCatalogQuery, providers])

  async function loadResources() {
    try {
      setLoading(true)
      const [providerList, defaultConfig] = await Promise.all([api.getModelProviders(), api.getModelDefaults()])
      setProviders(providerList)
      setDefaults(defaultConfig)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载模型资源失败')
    } finally {
      setLoading(false)
    }
  }

  function openCreateProvider() {
    setEditingProvider(null)
    providerForm.resetFields()
    providerForm.setFieldsValue(buildFormValues())
    setProviderDrawerOpen(true)
  }

  function openEditProvider(provider: ModelProvider) {
    setEditingProvider(provider)
    providerForm.resetFields()
    providerForm.setFieldsValue(buildFormValues(provider))
    setProviderDrawerOpen(true)
  }

  function closeProviderDrawer() {
    setProviderDrawerOpen(false)
    setEditingProvider(null)
    providerForm.resetFields()
  }

  async function handleProviderSubmit() {
    try {
      const values = await providerForm.validateFields()
      const payload: ModelProviderMutationInput = {
        displayName: values.displayName.trim(),
        providerType: values.providerType.trim(),
        capabilities: values.capabilities?.length ? values.capabilities : ['chat'],
        baseUrl: values.baseUrl?.trim() || null,
        apiKey: values.apiKey?.trim() || null,
        apiKeyEnv: values.apiKeyEnv?.trim() || null,
        extraHeaders: parseJsonObject(values.extraHeadersText || '{}', '额外请求头'),
        models: parseList(values.modelsText),
        defaultModel: values.defaultModel?.trim() || null,
        enabled: values.enabled ?? true,
      }

      setProviderSaving(true)
      if (editingProvider) {
        await api.updateModelProvider(editingProvider.providerId, payload)
        message.success('模型 provider 已更新')
      } else {
        await api.createModelProvider(payload)
        message.success('模型 provider 已创建')
      }
      closeProviderDrawer()
      await loadResources()
    } catch (error) {
      if (error instanceof SyntaxError) {
        message.error('额外请求头必须是合法 JSON')
        return
      }
      if (typeof error === 'object' && error && 'errorFields' in error) {
        return
      }
      if (error instanceof Error && error.message) {
        message.error(error.message)
      }
    } finally {
      setProviderSaving(false)
    }
  }

  async function handleDeleteProvider(provider: ModelProvider) {
    modal.confirm({
      title: `删除 ${provider.displayName}`,
      content: '删除后，引用该 provider 的默认配置会被自动清空。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.deleteModelProvider(provider.providerId)
        message.success('模型 provider 已删除')
        await loadResources()
      },
    })
  }

  async function handleTestProvider(provider: ModelProvider) {
    try {
      setProviderTestingId(provider.providerId)
      const result = await api.testModelProvider(provider.providerId)
      await loadResources()
      if (result.ok) {
        message.success(`${provider.displayName} 测试通过`)
      } else {
        message.error(result.error || `${provider.displayName} 测试失败`)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试模型 provider 失败')
    } finally {
      setProviderTestingId(null)
    }
  }

  function updateDefaultSelection(capability: ModelCapability, providerId?: string) {
    const provider = providers.find((item) => item.providerId === providerId)
    setModelDefaultsDraft((current) => ({
      ...current,
      [capability]: provider ? defaultSelection(provider, capability) : null,
    }))
  }

  function updateDefaultModel(capability: ModelCapability, modelName: string) {
    setModelDefaultsDraft((current) => {
      const existing = current[capability]
      if (!existing) {
        return current
      }
      return {
        ...current,
        [capability]: {
          ...existing,
          modelName,
          qualifiedModelName: modelName,
        },
      }
    })
  }

  async function handleSaveDefaults() {
    try {
      for (const capability of CAPABILITIES) {
        const selection = modelDefaultsDraft[capability]
        if (selection && !selection.modelName.trim()) {
          message.error(`${capabilityMeta[capability].label} 默认模型名不能为空`)
          return
        }
      }
      setSavingDefaults(true)
      const payload: ModelDefaultsMutationInput = {
        defaultChat: modelDefaultsDraft.chat,
        defaultEmbedding: modelDefaultsDraft.embedding,
        defaultReranker: modelDefaultsDraft.reranker,
      }
      const next = await api.updateModelDefaults(payload)
      setDefaults(next)
      message.success('默认模型设置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存默认模型失败')
    } finally {
      setSavingDefaults(false)
    }
  }

  function renderProviderCard(provider: ModelProvider, capability?: ModelCapability) {
    const activeDefaultCapabilities = CAPABILITIES.filter((item) => modelDefaultsDraft[item]?.providerId === provider.providerId)
    const isCurrentDefault = capability ? modelDefaultsDraft[capability]?.providerId === provider.providerId : false
    return (
      <article className="mcp-item-card" key={provider.providerId}>
        <div className="mcp-item-header">
          <div className="page-section-title">
            <Title level={4}>{provider.displayName}</Title>
            <Text type="secondary">
              {provider.providerType}
              {provider.baseUrl ? ` · ${provider.baseUrl}` : ''}
            </Text>
          </div>
          <div className="tag-cloud">
            {provider.capabilities.map((capability) => (
              <Tag key={capability} color={capabilityMeta[capability].color}>
                {capabilityMeta[capability].label}
              </Tag>
            ))}
            {activeDefaultCapabilities.map((item) => (
              <Tag key={`default-${item}`} color="geekblue">
                默认 {capabilityMeta[item].label}
              </Tag>
            ))}
            <Tag color={provider.enabled ? 'success' : 'default'}>{provider.enabled ? '启用' : '停用'}</Tag>
          </div>
        </div>

        <div className="page-meta-grid mcp-meta-grid">
          <div className="page-meta-card">
            <span>模型数</span>
            <strong>{provider.models.length}</strong>
          </div>
          <div className="page-meta-card">
            <span>默认模型</span>
            <strong>{provider.defaultModel || '未设置'}</strong>
          </div>
          <div className="page-meta-card">
            <span>最近测试</span>
            <strong>{provider.lastTestStatus || '未测试'}</strong>
          </div>
          <div className="page-meta-card">
            <span>API Key Env</span>
            <strong>{provider.apiKeyEnv || '--'}</strong>
          </div>
        </div>

        {provider.lastError ? (
          <Alert
            className="mcp-entry-alert"
            type="warning"
            message="最近一次测试失败"
            description={provider.lastError}
          />
        ) : null}

        <div className="mcp-hero-actions">
          {capability ? (
            <Button
              type={isCurrentDefault ? 'default' : 'primary'}
              disabled={isCurrentDefault}
              onClick={() => updateDefaultSelection(capability, provider.providerId)}
            >
              {isCurrentDefault ? '当前默认' : `设为 ${capabilityMeta[capability].label} 默认`}
            </Button>
          ) : null}
          <Button icon={<ThunderboltOutlined />} loading={providerTestingId === provider.providerId} onClick={() => void handleTestProvider(provider)}>
            测试
          </Button>
          <Button icon={<EditOutlined />} onClick={() => openEditProvider(provider)}>
            编辑
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={() => void handleDeleteProvider(provider)}>
            删除
          </Button>
        </div>
      </article>
    )
  }

  function renderProviderGrid(providerList: ModelProvider[], emptyText: string, capability?: ModelCapability) {
    if (providerList.length === 0) {
      return (
        <Empty
          className="empty-block"
          description={emptyText}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProvider}>
            新建 Provider
          </Button>
        </Empty>
      )
    }
    return <div className="mcp-card-grid">{providerList.map((provider) => renderProviderCard(provider, capability))}</div>
  }

  function renderSelectionCard(capability: ModelCapability) {
    const selected = modelDefaultsDraft[capability]
    const eligibleProviders = providersByCapability[capability]
    const currentProvider = selected ? providers.find((item) => item.providerId === selected.providerId) : null
    const modelSuggestions = currentProvider?.models || []

    return (
      <Card key={capability} className="config-panel-card model-selection-card">
        <div className="config-card-header">
          <div className="page-section-title">
            <Title level={4}>{capabilityMeta[capability].label}</Title>
            <Text type="secondary">{capabilityMeta[capability].description}</Text>
          </div>
          <Tag color={capabilityMeta[capability].color}>{eligibleProviders.length} 个可选 provider</Tag>
        </div>

        <div className="config-field-block">
          <div className="config-field-label-row">
            <Text>Provider</Text>
            <Button size="small" type="text" onClick={() => updateDefaultSelection(capability, undefined)}>
              清空
            </Button>
          </div>
          <Select
            value={selected?.providerId}
            placeholder="选择 provider"
            options={eligibleProviders.map((provider) => ({
              label: `${provider.displayName} · ${provider.providerType}`,
              value: provider.providerId,
            }))}
            allowClear
            onChange={(value) => updateDefaultSelection(capability, value)}
          />
        </div>

        <div className="config-field-block">
          <div className="config-field-label-row">
            <Text>模型名</Text>
          </div>
          <Input
            value={selected?.modelName || ''}
            placeholder={currentProvider?.defaultModel || currentProvider?.models[0] || '输入模型名'}
            disabled={!selected?.providerId}
            onChange={(event) => updateDefaultModel(capability, event.target.value)}
          />
        </div>

        <div className="models-suggestion-list">
          {!selected?.providerId ? (
            <Text type="secondary">请先选择 provider，再指定默认模型名。</Text>
          ) : modelSuggestions.length > 0 ? (
            modelSuggestions.map((model) => (
              <Button key={model} size="small" onClick={() => updateDefaultModel(capability, model)}>
                {model}
              </Button>
            ))
          ) : (
            <Text type="secondary">该 provider 没有预置模型，可直接手动输入。</Text>
          )}
        </div>

        <Paragraph className="models-helper-copy">
          当前默认值：{formatSelection(selected)}
        </Paragraph>
      </Card>
    )
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="模型资源中心"
        title="模型工作台"
        description="把 chat、embedding、reranker 的 provider 统一收束到资源中心，Agent 和知识库只做引用。"
        badges={[
          <Tag key="scope">资源中心</Tag>,
          <Tag key="chat" color="blue">Chat {stats.chat}</Tag>,
          <Tag key="embedding" color="cyan">Embedding {stats.embedding}</Tag>,
        ]}
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadResources()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProvider}>
              新建 Provider
            </Button>
            <Button icon={<SaveOutlined />} loading={savingDefaults} onClick={() => void handleSaveDefaults()}>
              保存默认值
            </Button>
          </Space>
        )}
        stats={[
          { label: 'Provider 总数', value: stats.total },
          { label: '已启用', value: stats.enabled },
          { label: '测试通过', value: stats.passed },
          { label: 'Chat 默认', value: formatSelection(modelDefaultsDraft.chat) },
          { label: 'Embedding 默认', value: formatSelection(modelDefaultsDraft.embedding) },
        ]}
      />

      <Alert
        className="mcp-inline-alert"
        type="info"
        showIcon
        message="默认值会直接影响 Agent 运行时和知识库召回。"
        description="先配置 provider，再设置 chat / embedding / reranker 默认项，后续 Agent 和 KB 只引用资源选择。"
      />

      <div className="page-grid models-page-grid">
        <MotionGroup className="page-stack">
          <MotionPanel hover={false}>
            <Card className="config-panel-card">
              <div className="config-card-header">
                <div className="page-section-title">
                  <Title level={4}>能力工作台</Title>
                  <Text type="secondary">按 chat、embedding、reranker 三条能力泳道维护默认值与资源。</Text>
                </div>
                <Tag>资源中心</Tag>
              </div>

              <Tabs
                className="console-tabs"
                items={CAPABILITIES.map((capability) => ({
                  key: capability,
                  label: `${capabilityMeta[capability].label} (${providersByCapability[capability].length})`,
                  children: (
                    <div className="page-stack">
                      {renderSelectionCard(capability)}
                      <Card
                        className="config-panel-card"
                        title={`${capabilityMeta[capability].label} Provider`}
                        extra={(
                          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProvider}>
                            新建 Provider
                          </Button>
                        )}
                      >
                        {renderProviderGrid(
                          providersByCapability[capability],
                          `还没有可用于 ${capabilityMeta[capability].label} 的 provider`,
                          capability,
                        )}
                      </Card>
                    </div>
                  ),
                }))}
              />
            </Card>
          </MotionPanel>
        </MotionGroup>

        <MotionGroup className="page-stack">
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Title level={4}>资源健康</Title>
                <Text type="secondary">先确认默认值是否齐全、最近测试是否通过，再交给 Agent 和知识库引用。</Text>
              </div>
              <Tag color={failedProviders.length > 0 || missingDefaultCapabilities.length > 0 ? 'warning' : 'success'}>
                {failedProviders.length > 0 || missingDefaultCapabilities.length > 0 ? '需关注' : '稳定'}
              </Tag>
            </div>

            <div className="page-meta-grid mcp-meta-grid" style={{ marginBottom: 16 }}>
              <div className="page-meta-card">
                <span>缺失默认值</span>
                <strong>{missingDefaultCapabilities.length}</strong>
              </div>
              <div className="page-meta-card">
                <span>测试失败</span>
                <strong>{failedProviders.length}</strong>
              </div>
              <div className="page-meta-card">
                <span>待验证</span>
                <strong>{untestedProviders.length}</strong>
              </div>
              <div className="page-meta-card">
                <span>停用资源</span>
                <strong>{stats.total - stats.enabled}</strong>
              </div>
            </div>

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {missingDefaultCapabilities.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`还有 ${missingDefaultCapabilities.length} 项默认能力未设置`}
                  description={`缺失项：${missingDefaultCapabilities.map((capability) => capabilityMeta[capability].label).join('、')}`}
                />
              ) : (
                <Alert type="success" showIcon message="chat / embedding / reranker 默认值已齐备" />
              )}

              {failedProviders.length > 0 ? (
                <Alert
                  type="error"
                  showIcon
                  message="有 Provider 最近一次测试失败"
                  description={failedProviders.slice(0, 3).map((item) => item.displayName).join('、')}
                />
              ) : (
                <Alert type="success" showIcon message="最近测试状态稳定" description="当前没有记录到测试失败的模型 Provider。" />
              )}

              {untestedProviders.length > 0 ? (
                <Alert
                  type="info"
                  showIcon
                  message="建议补一轮连通性验证"
                  description={`还有 ${untestedProviders.length} 个 Provider 尚未测试，可在目录卡片中直接触发测试。`}
                />
              ) : null}
            </Space>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Title level={4}>默认值说明</Title>
                <Text type="secondary">默认项只保存选择，不会修改历史 Agent 或知识库记录。</Text>
              </div>
              <Tag color="geekblue">资源引用</Tag>
            </div>

            <div className="page-meta-grid mcp-meta-grid">
              <div className="page-meta-card">
                <span>Chat 默认</span>
                <strong>{formatSelection(modelDefaultsDraft.chat)}</strong>
              </div>
              <div className="page-meta-card">
                <span>Embedding 默认</span>
                <strong>{formatSelection(modelDefaultsDraft.embedding)}</strong>
              </div>
              <div className="page-meta-card">
                <span>Reranker 默认</span>
                <strong>{formatSelection(modelDefaultsDraft.reranker)}</strong>
              </div>
              <div className="page-meta-card">
                <span>已启用 Provider</span>
                <strong>{stats.enabled}</strong>
              </div>
            </div>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Title level={4}>全部 Provider 目录</Title>
                <Text type="secondary">按完整资源清单查看、测试和清理所有模型入口。</Text>
              </div>
              <Tag>{filteredProviderCatalog.length}/{stats.total} 个资源</Tag>
            </div>
            <Space wrap style={{ width: '100%', marginBottom: 16 }}>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索 Provider 名称、类型或模型"
                value={providerCatalogQuery}
                onChange={(event) => setProviderCatalogQuery(event.target.value)}
                style={{ minWidth: 240, flex: '1 1 280px' }}
              />
              <Select
                value={providerCatalogFilter}
                onChange={(value) => setProviderCatalogFilter(value)}
                style={{ minWidth: 160 }}
                options={[
                  { value: 'all', label: '全部资源' },
                  { value: 'enabled', label: '仅启用' },
                  { value: 'disabled', label: '仅停用' },
                  { value: 'failed', label: '测试失败' },
                  { value: 'untested', label: '待测试' },
                ]}
              />
              <Button
                onClick={() => {
                  setProviderCatalogQuery('')
                  setProviderCatalogFilter('all')
                }}
              >
                清空筛选
              </Button>
            </Space>
            {renderProviderGrid(filteredProviderCatalog, '当前筛选条件下没有模型 provider')}
          </Card>
        </MotionGroup>
      </div>

      <Divider />

      <Drawer
        title={editingProvider ? `编辑 ${editingProvider.displayName}` : '新建 Provider'}
        open={providerDrawerOpen}
        width={720}
        onClose={closeProviderDrawer}
        destroyOnClose
        extra={(
          <Space>
            {editingProvider ? (
              <Button
                icon={<ThunderboltOutlined />}
                loading={providerTestingId === editingProvider.providerId}
                onClick={() => void handleTestProvider(editingProvider)}
              >
                立即测试
              </Button>
            ) : null}
            <Button onClick={closeProviderDrawer}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={providerSaving} onClick={() => void handleProviderSubmit()}>
              保存
            </Button>
          </Space>
        )}
      >
        <Form layout="vertical" form={providerForm} initialValues={buildFormValues()} preserve={false}>
          {editingProvider ? (
            <Alert
              style={{ marginBottom: 16 }}
              type={editingProvider.lastTestStatus === 'failed' ? 'warning' : editingProvider.lastTestStatus === 'passed' ? 'success' : 'info'}
              showIcon
              message={editingProvider.lastTestStatus ? `最近测试：${editingProvider.lastTestStatus}` : '最近测试：未执行'}
              description={editingProvider.lastError || '建议保存前先完成一次连通性测试。'}
            />
          ) : (
            <Alert
              style={{ marginBottom: 16 }}
              type="info"
              showIcon
              message="配置流程"
              description="建议按“连接信息 → 支持模型 → 默认与启用”顺序填写，保存前先做一次测试。"
            />
          )}

          <div className="page-section-title" style={{ marginBottom: 12 }}>
            <Title level={4}>连接信息</Title>
            <Text type="secondary">定义 provider 类型、接口地址和鉴权信息。</Text>
          </div>
          <Form.Item
            label="展示名称"
            name="displayName"
            rules={[{ required: true, message: '请输入展示名称' }]}
          >
            <Input placeholder="例如 DeepSeek 主模型" />
          </Form.Item>
          <Form.Item
            label="Provider 类型"
            name="providerType"
            rules={[{ required: true, message: '请输入 provider 类型' }]}
          >
            <Input placeholder="例如 deepseek / openai / custom" />
          </Form.Item>
          <Form.Item
            label="能力"
            name="capabilities"
            rules={[{ required: true, message: '至少选择一种能力' }]}
          >
            <Select
              mode="multiple"
              options={CAPABILITIES.map((capability) => ({
                label: capabilityMeta[capability].label,
                value: capability,
              }))}
            />
          </Form.Item>
          <Form.Item label="Base URL" name="baseUrl">
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey">
            <Input.Password placeholder="可留空" />
          </Form.Item>
          <Form.Item label="API Key Env" name="apiKeyEnv">
            <Input placeholder="例如 OPENAI_API_KEY" />
          </Form.Item>
          <Form.Item label="额外请求头 JSON" name="extraHeadersText">
            <TextArea rows={4} placeholder='{"X-APP-KEY":"abc"}' />
          </Form.Item>

          <Divider />

          <div className="page-section-title" style={{ marginBottom: 12 }}>
            <Title level={4}>支持模型</Title>
            <Text type="secondary">录入这个 provider 支持的模型清单，便于默认值选择和 Agent 绑定。</Text>
          </div>
          <Form.Item label="模型列表" name="modelsText">
            <TextArea rows={4} placeholder="每行一个模型名" />
          </Form.Item>

          <Divider />

          <div className="page-section-title" style={{ marginBottom: 12 }}>
            <Title level={4}>默认与启用</Title>
            <Text type="secondary">设置推荐默认模型，并决定这个 provider 是否立即参与选择。</Text>
          </div>
          <Form.Item label="默认模型" name="defaultModel">
            <Input placeholder="例如 deepseek-chat" />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
