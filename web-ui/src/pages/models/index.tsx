import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Empty, Flex, Input, Segmented, Space, Tag, Typography, Progress, theme } from 'antd'
import {
  CheckCircleOutlined,
  CloseOutlined,
  DatabaseOutlined,
  LinkOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'


import PageHeader from '../../components/console/PageHeader'
import MetricCard from '../../components/console/MetricCard'
import SectionCard from '../../components/console/SectionCard'
import { api } from '../../api'
import { providerCategoryLabels, providerDescriptions } from '../../configMeta'
import {
  buildModelBinding,
  createBindingId,
  getAllModelBindings,
  getPreferredBinding,
  getProviderMeta,
  normalizeModelConfig,
  resolveBindingCapabilityType,
  updateBindingValue,
  updateProviderFieldValue,
} from '../../modelConfig'
import type { ConfigData, ConfigMeta, ModelBindingTestResult } from '../../types'

import ProviderConfig from './ProviderConfig'
import ModelBindings from './ModelBindings'
import ModelTable from './ModelTable'
import ProviderAvatar from './ProviderAvatar'
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
import { SPACING } from '../../ui/tokens'
import { useToast } from '../../toast'

export default function ModelsPage() {
  const message = useToast()
  const { token } = theme.useToken()

  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [searchQuery, setSearchQuery] = useState('')
  const deferredQuery = useDeferredValue(searchQuery)
  const [viewMode, setViewMode] = useState<'models' | 'providers'>('models')
  const [activeProviderName, setActiveProviderName] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

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

  function openProviderDrawer(providerName: string) {
    setActiveProviderName(providerName)
    setDrawerOpen(true)
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
        categoryLabel: providerCategoryLabels[provider.category] || provider.category,
        description: providerDescriptions[provider.name] || '—',
        configured,
        defaultProvider,
        bindingsCount: providerBindingsCount,
      }
    })
  ), [bindings, config?.providers, defaultBindingName, providers])

  const configuredProviderCount = useMemo(
    () => providerCards.filter((provider) => provider.configured).length,
    [providerCards],
  )
  const totalBindingCount = useMemo(
    () => Object.keys(bindings).length,
    [bindings],
  )
  const suggestedRouteId = useMemo(
    () => addModelDraft.modelId.trim() ? createBindingId(addModelDraft.modelId.trim(), bindings) : '',
    [addModelDraft.modelId, bindings],
  )

  /** All bindings as rows with capability type resolved (for ModelTable) */
  const allBindingRows = useMemo<BindingRow[]>(() => {
    return Object.entries(bindings)
      .map(([bindingName, binding]) => ({
        bindingName,
        ...binding,
        capabilityType: resolveBindingCapabilityType(binding),
      }))
      .sort((a, b) => (a.model || a.bindingName).localeCompare(b.model || b.bindingName))
  }, [bindings])

  /** Provider name → label mapping for ModelTable */
  const providerLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    if (configMeta) {
      for (const p of configMeta.providers) {
        labels[p.name] = p.label
      }
    }
    return labels
  }, [configMeta])

  if (loading && !config) {
    return (
      <Flex vertical gap={18} className="page-stack">
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
    <Flex vertical gap={18} className="page-stack">
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: SPACING.md }}>
        <MetricCard
          label="已注册模型"
          value={totalBindingCount}
          icon={<LinkOutlined style={{ fontSize: 'var(--nb-text-lg)' }} />}
          tone="primary"
        />
        <MetricCard
          label="可用供应商"
          value={`${configuredProviderCount}/${providers.length}`}
          icon={<CheckCircleOutlined style={{ fontSize: 'var(--nb-text-lg)' }} />}
          tone="success"
        />
        <MetricCard
          label="默认模型"
          value={bindings[defaultBindingName]?.model || bindings[defaultBindingName]?.label || '未设置'}
          icon={<DatabaseOutlined style={{ fontSize: 'var(--nb-text-lg)' }} />}
          tone="neutral"
        />
      </div>

      <Flex align="center" justify="space-between" gap={12} wrap="wrap">
        <Segmented
          value={viewMode}
          onChange={(value) => setViewMode(value as 'models' | 'providers')}
          options={[
            { label: '模型总览', value: 'models' },
            { label: '供应商管理', value: 'providers' },
          ]}
          style={{ borderRadius: 10 }}
        />
        <Input
          size="large"
          placeholder={viewMode === 'models' ? '搜索模型 ID、名称或供应商' : '搜索供应商名称'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          prefix={<SearchOutlined />}
          allowClear
          style={{ borderRadius: 12, background: 'var(--nb-card-subtle-bg)', border: 'none', maxWidth: 400 }}
        />
      </Flex>

      {viewMode === 'models' ? (
        <SectionCard
          title="模型总览"
          description="所有已注册的模型，按能力类型分类。"
          action={
            totalBindingCount > 0 ? undefined : (
              <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>
                请先在供应商管理中添加模型
              </Typography.Text>
            )
          }
        >
          <ModelTable
            bindings={allBindingRows}
            defaultBindingName={defaultBindingName}
            providerLabels={providerLabels}
            searchQuery={deferredQuery}
            onTest={(_bindingName, model) => {
              const binding = bindings[_bindingName]
              if (binding?.provider) {
                setActiveProviderName(binding.provider)
              }
              openTestDialog({ model })
            }}
            onSetDefault={setAsDefaultBinding}
            onDelete={requestDeleteBinding}
            onCapabilityChange={(bindingName, capabilityType) => {
              updateConfig((current) => {
                const currentBindings = configMeta ? getAllModelBindings(current, configMeta) : {}
                const binding = currentBindings[bindingName]
                if (!binding) return current
                return updateBindingValue(
                  current,
                  bindingName,
                  getProviderMeta(configMeta, binding.provider),
                  { ...binding, capabilityType },
                )
              })
            }}
            onOpenProviderDrawer={openProviderDrawer}
          />
        </SectionCard>
      ) : (
        <SectionCard title="接入模型供应商">
          {providerCards.length === 0 ? (
            <Empty description="无匹配项" />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: SPACING.md,
              }}
            >
              {providerCards.map((provider, index) => (
                <motion.div
                  key={provider.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.2 }}
                  whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(99,102,241,0.1)' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => openProviderDrawer(provider.name)}
                  style={{
                    background: 'var(--nb-card-subtle-bg)',
                    border: `1px solid ${activeProviderName === provider.name ? token.colorPrimary : 'var(--nb-card-subtle-border)'}`,
                    borderRadius: 16,
                    padding: '20px 20px 16px',
                    cursor: 'pointer',
                    transition: 'border-color 200ms ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  {/* 头部：Logo 和状态 */}
                  <Flex align="flex-start" justify="space-between">
                    <ProviderAvatar providerName={provider.name} label={provider.label} size={44} />
                    <Space size={6} wrap align="center">
                      {provider.defaultProvider ? (
                        <Tag color="processing" bordered={false} style={{ margin: 0, borderRadius: 6, fontSize: 'var(--nb-text-2xs)' }}>
                          默认
                        </Tag>
                      ) : null}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: provider.configured ? token.colorSuccess : token.colorWarning,
                          }}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                          {provider.configured ? '已配置' : '待预置'}
                        </Typography.Text>
                      </div>
                    </Space>
                  </Flex>

                  {/* 名称和分类 */}
                  <div style={{ marginTop: 2 }}>
                    <Typography.Text strong style={{ fontSize: 'var(--nb-text-lg)', display: 'block' }}>
                      {provider.label}
                    </Typography.Text>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 'var(--nb-text-sm)', display: 'block', marginTop: 3 }}
                      ellipsis
                    >
                      {provider.categoryLabel}
                    </Typography.Text>
                  </div>

                  {/* 模型数量统计 */}
                  <Flex align="center" justify="space-between" style={{ marginTop: 'auto', paddingTop: 8 }}>
                    <Typography.Text type={provider.bindingsCount > 0 ? undefined : 'secondary'} style={{ fontSize: 'var(--nb-text-sm)' }}>
                      <span style={{ fontWeight: provider.bindingsCount > 0 ? 600 : 400 }}>{provider.bindingsCount}</span> 个模型
                    </Typography.Text>
                    <Button size="small" type={provider.configured ? 'default' : 'primary'} style={{ borderRadius: 6 }}>
                      {provider.configured ? '管理模型' : '填入凭据'}
                    </Button>
                  </Flex>
                </motion.div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      <Drawer
        title={null}
        placement="right"
        width={680}
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
          {drawerOpen && activeProviderMeta && (
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
                  flexShrink: 0,
                }}
              >
                <Flex align="center" justify="space-between">
                  <Flex align="center" gap={12}>
                    <ProviderAvatar providerName={activeProviderName!} label={activeProviderMeta.label} size={40} />
                    <div>
                      <Typography.Text strong style={{ fontSize: 'var(--nb-title-xs)', display: 'block' }}>
                        {activeProviderMeta.label}
                      </Typography.Text>
                      <Space size={6} style={{ marginTop: 2 }}>
                        <Tag bordered={false} style={{ margin: 0, borderRadius: 6 }}>
                          {providerCategoryLabels[activeProviderMeta.category] || activeProviderMeta.category}
                        </Tag>
                        {bindings[defaultBindingName]?.provider === activeProviderName! ? (
                          <Tag color="processing" bordered={false} style={{ margin: 0, borderRadius: 6 }}>
                            全局默认
                          </Tag>
                        ) : null}
                      </Space>
                    </div>
                  </Flex>
                  <Flex align="center" gap={8}>
                    <Button
                      type="text"
                      icon={<CloseOutlined />}
                      onClick={() => setDrawerOpen(false)}
                      size="middle"
                    />
                  </Flex>
                </Flex>
              </div>

              {/* Drawer 内容：滑动区域 */}
              <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
                <Flex vertical gap={28}>
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
                    onCapabilityChange={(bindingName, capabilityType) => {
                      updateConfig((current) => {
                        const currentBindings = configMeta ? getAllModelBindings(current, configMeta) : {}
                        const binding = currentBindings[bindingName]
                        if (!binding) return current
                        return updateBindingValue(
                          current,
                          bindingName,
                          getProviderMeta(configMeta, binding.provider),
                          { ...binding, capabilityType },
                        )
                      })
                    }}
                  />
                </Flex>
              </div>

              {/* 底部操作栏 */}
              <div
                style={{
                  padding: '16px 24px',
                  borderTop: `1px solid var(--nb-border)`,
                  background: 'var(--nb-surface-strong)',
                  flexShrink: 0,
                }}
              >
                <Flex justify="flex-end" gap={8}>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => void saveCurrentConfig()}
                    loading={saving}
                  >
                    保存全局配置
                  </Button>
                </Flex>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Drawer>

      <AddModelDialog
        open={addModelDialogOpen}
        draft={addModelDraft}
        providerLabel={activeProviderMeta?.label || activeProviderName || ''}
        existingBindingCount={activeProviderBindings.length}
        suggestedRouteId={suggestedRouteId}
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
        isDefault={Boolean(bindingToDelete && bindingToDelete === defaultBindingName)}
        onConfirm={confirmDeleteBinding}
        onCancel={() => setBindingToDelete(null)}
      />
    </Flex>
  )
}
