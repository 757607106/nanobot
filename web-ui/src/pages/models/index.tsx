import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { App, Button, Empty, Flex, Space, Splitter, theme } from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import PageHeader from '../../components/console/PageHeader'
import SectionCard from '../../components/console/SectionCard'
import { api } from '../../api'
import { providerDescriptions } from '../../configMeta'
import {
  buildModelBinding,
  createBindingId,
  getAllModelBindings,
  getPreferredBinding,
  getPreferredProvider,
  getProviderMeta,
  normalizeModelConfig,
  resolveBindingCapabilityType,
  updateBindingValue,
  updateProviderFieldValue,
} from '../../modelConfig'
import type { ConfigData, ConfigMeta, ModelBinding, ModelBindingTestResult } from '../../types'
import ProviderList from './ProviderList'
import ProviderConfig from './ProviderConfig'
import ModelBindings from './ModelBindings'
import {
  AddModelDialog,
  DeleteConfirmDialog,
  RemoteModelsDialog,
  TestConnectionDialog,
} from './Dialogs'
import {
  createEmptyAddModelDraft,
  createEmptyTestDraft,
  getBindingRouteErrorMessage,
  hasCredentialMaterial,
  inferCapabilityType,
} from './utils'
import type { AddModelDraft, BindingRow, TestDraft } from './types'

export default function ModelsPage() {
  const { message } = App.useApp()
  const { token } = theme.useToken()

  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredQuery = useDeferredValue(searchQuery)
  const [activeProviderName, setActiveProviderName] = useState<string | null>(null)

  // Dialog states
  const [addModelDialogOpen, setAddModelDialogOpen] = useState(false)
  const [addModelDraft, setAddModelDraft] = useState<AddModelDraft>(() => createEmptyAddModelDraft())
  const [remoteModelsDialogOpen, setRemoteModelsDialogOpen] = useState(false)
  const [remoteModels, setRemoteModels] = useState<string[]>([])
  const [remoteModelsError, setRemoteModelsError] = useState<string | null>(null)
  const [loadingRemoteModels, setLoadingRemoteModels] = useState(false)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testDraft, setTestDraft] = useState<TestDraft>(() => createEmptyTestDraft())
  const [testResult, setTestResult] = useState<ModelBindingTestResult | null>(null)
  const [bindingToDelete, setBindingToDelete] = useState<string | null>(null)

  const bindings = useMemo(
    () => (config && configMeta ? getAllModelBindings(config, configMeta) : {}),
    [config, configMeta],
  )
  const defaultBindingName = config && configMeta ? getPreferredBinding(config, configMeta) : ''

  useEffect(() => {
    void loadModels()
  }, [])

  useEffect(() => {
    if (!config || !configMeta || activeProviderName) {
      return
    }
    setActiveProviderName(getPreferredProvider(config, configMeta))
  }, [activeProviderName, config, configMeta])

  async function loadModels() {
    try {
      setLoading(true)
      const [configResult, metaResult] = await Promise.all([
        api.getConfig(),
        api.getConfigMeta(),
      ])
      const normalized = normalizeModelConfig(configResult, metaResult)
      setConfig(normalized)
      setConfigMeta(metaResult)
      setActiveProviderName((current) => current || getPreferredProvider(normalized, metaResult))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  function updateConfig(mutator: (draft: ConfigData) => ConfigData) {
    setConfig((current) => (current ? mutator(current) : current))
  }

  async function saveCurrentConfig() {
    if (!config || !configMeta) return
    try {
      setSaving(true)
      const saved = await api.updateConfig(config)
      const meta = await api.getConfigMeta()
      const normalized = normalizeModelConfig(saved, meta)
      setConfig(normalized)
      setConfigMeta(meta)
      message.success('配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存配置失败')
    } finally {
      setSaving(false)
    }
  }

  function openAddModelDialog() {
    setAddModelDraft(createEmptyAddModelDraft())
    setAddModelDialogOpen(true)
  }

  function handleAddBinding() {
    if (!config || !activeProviderName) return
    if (!addModelDraft.modelId.trim()) {
      message.error('请输入模型 ID')
      return
    }
    if (!addModelDraft.modelName.trim()) {
      message.error('请输入展示名称')
      return
    }

    const providerMeta = getProviderMeta(configMeta, activeProviderName)
    const bindingName = createBindingId(addModelDraft.modelId, bindings)

    updateConfig((current) => updateBindingValue(
      current,
      bindingName,
      providerMeta,
      buildModelBinding(activeProviderName, providerMeta ?? undefined, {
        label: addModelDraft.modelName.trim(),
        model: addModelDraft.modelId.trim(),
        capabilityType: addModelDraft.capabilityType,
      }),
    ))

    setAddModelDialogOpen(false)
    setAddModelDraft(createEmptyAddModelDraft())
    message.success(`已添加 ${addModelDraft.modelName.trim()}`)
  }

  function requestDeleteBinding(bindingName: string) {
    setBindingToDelete(bindingName)
  }

  function confirmDeleteBinding() {
    if (!bindingToDelete || !config || !configMeta) {
      setBindingToDelete(null)
      return
    }

    updateConfig((current) => {
      const nextBindings = { ...(current.modelBindings ?? {}) }
      delete nextBindings[bindingToDelete]
      const fallbackBindingName = bindingToDelete === defaultBindingName
        ? Object.entries(nextBindings).find(([, binding]) => resolveBindingCapabilityType(binding) !== 'embedding')?.[0]
          ?? Object.keys(nextBindings)[0]
          ?? null
        : current.agents.defaults.binding ?? null
      const fallbackBinding = fallbackBindingName ? nextBindings[fallbackBindingName] : null
      return normalizeModelConfig({
        ...current,
        modelBindings: nextBindings,
        agents: {
          ...current.agents,
          defaults: {
            ...current.agents.defaults,
            binding: fallbackBindingName,
            provider: fallbackBinding?.provider ?? current.agents.defaults.provider,
            model: fallbackBinding?.model ?? current.agents.defaults.model,
          },
        },
      }, configMeta)
    })

    message.success('已标记删除，请保存配置')
    setBindingToDelete(null)
  }

  function setAsDefaultBinding(bindingName: string) {
    const nextBinding = bindings[bindingName]

    updateConfig((current) => {
      const currentBindings = configMeta ? getAllModelBindings(current, configMeta) : {}
      const binding = currentBindings[bindingName]
      if (!binding) return current
      return {
        ...current,
        agents: {
          ...current.agents,
          defaults: {
            ...current.agents.defaults,
            binding: bindingName,
            provider: binding.provider,
            model: binding.model || current.agents.defaults.model,
          },
        },
      }
    })
    message.success(`已将「${nextBinding?.label || bindingName}」设为默认，请保存配置`)
  }

  function updateProviderCredential(providerName: string, field: 'apiKey' | 'apiBase', value: string) {
    const providerMeta = getProviderMeta(configMeta, providerName)
    updateConfig((current) => updateProviderFieldValue(current, providerName, providerMeta, field, value))
  }

  async function loadRemoteModels() {
    if (!activeProviderName) return
    try {
      setLoadingRemoteModels(true)
      setRemoteModelsError(null)
      const activeProviderConfig = config?.providers?.[activeProviderName]
      const result = await api.fetchModelBindingModels({
        provider: activeProviderName,
        apiKey: activeProviderConfig?.apiKey || '',
        apiBase: activeProviderConfig?.apiBase || null,
      })
      setRemoteModels(result.models)
      setRemoteModelsDialogOpen(true)
      message.success(`已获取 ${result.count} 个模型`)
    } catch (error) {
      const nextError = getBindingRouteErrorMessage(error, '获取模型列表')
      setRemoteModelsError(nextError)
      message.error(nextError)
    } finally {
      setLoadingRemoteModels(false)
    }
  }

  function importRemoteModel(modelId: string) {
    if (!config || !activeProviderName) return
    const providerMeta = getProviderMeta(configMeta, activeProviderName)
    const capabilityType = inferCapabilityType(modelId)
    const bindingName = createBindingId(modelId, bindings)

    updateConfig((current) => updateBindingValue(
      current,
      bindingName,
      providerMeta,
      buildModelBinding(activeProviderName, providerMeta ?? undefined, {
        label: modelId,
        model: modelId,
        capabilityType,
      }),
    ))
    message.success(`已导入 ${modelId}`)
  }

  function openTestDialog(initialData?: { apiKey?: string; apiBase?: string; model?: string }) {
    const activeProviderConfig = config?.providers?.[activeProviderName || '']
    setTestDraft({
      apiKey: initialData?.apiKey || activeProviderConfig?.apiKey || '',
      apiBase: initialData?.apiBase || activeProviderConfig?.apiBase || '',
      model: initialData?.model || '',
    })
    setTestResult(null)
    setTestDialogOpen(true)
  }

  async function handleTestConnection() {
    if (!activeProviderName) return
    if (!testDraft.model.trim()) {
      message.error('请输入模型 ID')
      return
    }
    try {
      setTesting(true)
      setTestResult(null)
      const result = await api.testModelBinding({
        bindingName: 'temp-test-binding',
        provider: activeProviderName,
        model: testDraft.model.trim(),
        apiKey: testDraft.apiKey.trim(),
        apiBase: testDraft.apiBase.trim() || null,
        extraHeaders: {},
      })
      setTestResult(result)
      if (result.ok) {
        message.success('连接成功')
      } else {
        message.error('连接失败')
      }
    } catch (error) {
      const nextError = getBindingRouteErrorMessage(error, '检测连接')
      setTestResult({
        ok: false,
        provider: activeProviderName,
        model: testDraft.model.trim(),
        bindingName: 'temp-test-binding',
        label: 'Test',
        latencyMs: 0,
        finishReason: 'error',
        message: nextError,
        responsePreview: null,
        usage: {},
      })
      message.error(nextError)
    } finally {
      setTesting(false)
    }
  }

  const providers = useMemo(() => {
    if (!configMeta) return []
    const q = deferredQuery.trim().toLowerCase()
    return configMeta.providers.filter((provider) => {
      if (!q) return true
      const haystack = [
        provider.label,
        provider.name,
        provider.keywords.join(' '),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [configMeta, deferredQuery])

  const activeProviderMeta = activeProviderName ? getProviderMeta(configMeta, activeProviderName) : null
  const activeProviderBindings = useMemo<BindingRow[]>(() => {
    return Object.entries(bindings)
      .filter(([, binding]) => binding.provider === activeProviderName)
      .map(([bindingName, binding]) => ({
        bindingName,
        ...binding,
        capabilityType: resolveBindingCapabilityType(binding),
      }))
      .sort((left, right) => (left.label || left.bindingName).localeCompare(right.label || right.bindingName))
  }, [activeProviderName, bindings])
  const activeProviderConfig = config?.providers?.[activeProviderName || '']

  const providerCards = useMemo(() => (
    providers.map((provider) => {
      const providerBindingsCount = Object.values(bindings).filter((binding) => binding.provider === provider.name).length
      const providerConfig = config?.providers?.[provider.name]
      const configured = hasCredentialMaterial(providerConfig?.apiKey, providerConfig?.apiBase)
      const defaultProvider = bindings[defaultBindingName]?.provider === provider.name

      return {
        name: provider.name,
        label: provider.label,
        configured,
        defaultProvider,
        bindingsCount: providerBindingsCount,
      }
    })
  ), [bindings, config?.providers, defaultBindingName, providers])

  if (loading && !config) {
    return (
      <Flex vertical gap={18} className="console-page models-page">
        <PageHeader
          title="模型配置"
        />
        <SectionCard title="加载中">
          <Empty description="正在加载配置..." />
        </SectionCard>
      </Flex>
    )
  }

  return (
    <Flex vertical gap={18} className="console-page models-page">
      <PageHeader
        title="模型配置"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void loadModels()} disabled={loading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void saveCurrentConfig()}
              loading={saving}
              disabled={!config}
            >
              保存
            </Button>
          </Space>
        )}
      />

      <Splitter className="console-workspace-splitter" style={{ minHeight: 600 }}>
        <Splitter.Panel defaultSize={280} min={260} max={340}>
          <SectionCard title="供应商">
            <ProviderList
              providers={providerCards}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              activeProviderName={activeProviderName}
              onSelect={setActiveProviderName}
            />
          </SectionCard>
        </Splitter.Panel>

        <Splitter.Panel min={600}>
          {activeProviderMeta ? (
            <Flex vertical gap={12}>
              <ProviderConfig
                providerName={activeProviderName!}
                providerMeta={activeProviderMeta}
                providerConfig={activeProviderConfig}
                defaultBindingName={defaultBindingName}
                bindings={bindings}
                loadingRemoteModels={loadingRemoteModels}
                onUpdateCredential={(field, value) => updateProviderCredential(activeProviderName!, field, value)}
                onTestConnection={() => openTestDialog()}
                onFetchRemoteModels={() => void loadRemoteModels()}
              />

              <ModelBindings
                bindings={activeProviderBindings}
                defaultBindingName={defaultBindingName}
                onTest={(model) => openTestDialog({ model })}
                onSetDefault={setAsDefaultBinding}
                onDelete={requestDeleteBinding}
                onAddModel={openAddModelDialog}
              />
            </Flex>
          ) : (
            <SectionCard title="供应商配置">
              <Empty description="请从左侧选择供应商" />
            </SectionCard>
          )}
        </Splitter.Panel>
      </Splitter>

      <AddModelDialog
        open={addModelDialogOpen}
        draft={addModelDraft}
        onDraftChange={setAddModelDraft}
        onConfirm={handleAddBinding}
        onCancel={() => setAddModelDialogOpen(false)}
      />

      <RemoteModelsDialog
        open={remoteModelsDialogOpen}
        models={remoteModels}
        error={remoteModelsError}
        onClose={() => setRemoteModelsDialogOpen(false)}
        onImport={importRemoteModel}
      />

      <TestConnectionDialog
        open={testDialogOpen}
        testing={testing}
        draft={testDraft}
        result={testResult}
        onDraftChange={setTestDraft}
        onConfirm={() => void handleTestConnection()}
        onCancel={() => setTestDialogOpen(false)}
      />

      <DeleteConfirmDialog
        open={Boolean(bindingToDelete)}
        bindingName={bindingToDelete}
        bindingLabel={bindingToDelete ? bindings[bindingToDelete]?.label || null : null}
        onConfirm={confirmDeleteBinding}
        onCancel={() => setBindingToDelete(null)}
      />
    </Flex>
  )
}
