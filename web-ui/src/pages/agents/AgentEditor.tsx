import { useMemo } from 'react'
import { Button, Descriptions, Flex, Input, Select, Space, Switch, Tag, Typography } from 'antd'
import SectionCard from '../../components/console/SectionCard'
import FormField from '../../components/console/FormField'
import DevOnly from '../../components/DevOnly'
import {
  getAllModelBindings,
  getPreferredProvider,
  getProviderOptions,
  inferProviderFromModel,
  modelMatchesProvider,
  resolveBindingCapabilityType,
} from '../../modelConfig'
import { getModelSuggestions } from '../../modelCatalog'
import type { AgentDefinition, ConfigData, ConfigMeta } from '../../types'
import type { AgentFormState } from './types'
import { memoryScopeLabel, memoryScopeOptions, parseTags } from './utils'

interface AgentEditorProps {
  form: AgentFormState
  currentAgent: AgentDefinition | null
  globalConfig: ConfigData | null
  globalConfigMeta: ConfigMeta | null
  onUpdateForm: <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => void
}

export default function AgentEditor({
  form,
  currentAgent,
  globalConfig,
  globalConfigMeta,
  onUpdateForm,
}: AgentEditorProps) {
  const agentProviderOptions = useMemo(
    () => getProviderOptions(globalConfigMeta),
    [globalConfigMeta],
  )

  const availableBindings = useMemo(
    () => (globalConfig ? getAllModelBindings(globalConfig, globalConfigMeta) : {}),
    [globalConfig, globalConfigMeta],
  )

  const agentBindingOptions = useMemo(
    () => Object.entries(availableBindings)
      .filter(([, binding]) => {
        const capabilityType = resolveBindingCapabilityType(binding)
        return capabilityType === 'text_chat' || capabilityType === 'multimodal'
      })
      .map(([bindingName, binding]) => ({
        value: bindingName,
        label: String(binding.label || binding.model || bindingName).trim() || bindingName,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    [availableBindings],
  )

  const selectedBindingConfig = form.binding ? availableBindings[form.binding] : null

  const selectedBindingProviderLabel = useMemo(() => {
    const providerName = selectedBindingConfig?.provider
    if (!providerName) {
      return ''
    }
    return globalConfigMeta?.providers.find((item) => item.name === providerName)?.label || providerName
  }, [globalConfigMeta, selectedBindingConfig])

  const modelSuggestions = useMemo(() => {
    if (!globalConfig || !globalConfigMeta) return []
    const provider = (form.binding ? availableBindings[form.binding]?.provider : null)
      || form.provider
      || inferProviderFromModel(globalConfigMeta, form.model || null)
      || getPreferredProvider(globalConfig, globalConfigMeta)
    return getModelSuggestions(provider, form.model || null)
  }, [availableBindings, form.binding, form.model, form.provider, globalConfig, globalConfigMeta])

  const promptLength = form.systemPrompt.trim().length
  const ruleCount = useMemo(
    () => form.rulesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .length,
    [form.rulesText],
  )

  const retentionSummary = form.artifactArchiveAfterDays.trim()
    ? `${form.artifactArchiveAfterDays.trim()} 天后归档`
    : '未设置归档'

  const routeSummary = form.binding
    ? form.binding
    : [form.provider, form.model].filter(Boolean).join(' / ') || '自动推断'

  function updateProvider(value: string) {
    const nextProvider = value
    const currentModel = form.model.trim()
    const nextModel = nextProvider && !modelMatchesProvider(globalConfigMeta, nextProvider, currentModel)
      ? getModelSuggestions(nextProvider)[0] || form.model
      : form.model

    onUpdateForm('binding', form.binding && availableBindings[form.binding]?.provider === nextProvider ? form.binding : '')
    onUpdateForm('provider', nextProvider)
    onUpdateForm('model', nextModel)
  }

  function updateBinding(value: string) {
    const nextBinding = value
    const bindingConfig = availableBindings[nextBinding]
    const nextProvider = bindingConfig?.provider || ''
    const currentModel = form.model.trim()
    let nextModel = form.model

    if (bindingConfig?.model) {
      nextModel = bindingConfig.model
    } else if (nextProvider && currentModel && !modelMatchesProvider(globalConfigMeta, nextProvider, currentModel)) {
      nextModel = getModelSuggestions(nextProvider)[0] || form.model
    }

    onUpdateForm('binding', nextBinding)
    onUpdateForm('provider', nextProvider || form.provider)
    onUpdateForm('model', nextModel)
  }

  return (
    <Flex vertical gap={6}>
      <SectionCard title="基本信息">
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <FormField label="名称">
            <Input
              value={form.name}
              onChange={(event) => onUpdateForm('name', event.target.value)}
              placeholder="员工名称"
              aria-label="名称"
            />
          </FormField>

          <FormField label="标签">
            <Input
              value={form.tags.join(', ')}
              onChange={(event) => onUpdateForm('tags', parseTags(event.target.value))}
              placeholder="tag1, tag2"
              aria-label="标签"
            />
          </FormField>

          <FormField label="模型绑定">
            <Select
              value={form.binding}
              onChange={updateBinding}
              options={[{ value: '', label: '跟随默认绑定' }, ...agentBindingOptions]}
              aria-label="模型绑定"
              style={{ width: '100%' }}
            />
          </FormField>

          <FormField label="职责说明" fullWidth>
            <Input.TextArea
              value={form.description}
              onChange={(event) => onUpdateForm('description', event.target.value)}
              rows={4}
              aria-label="职责说明"
            />
          </FormField>
        </div>
      </SectionCard>

      <SectionCard title="角色说明与规则">
        <Flex vertical gap={6}>
          <FormField label="角色说明">
            <Input.TextArea
              value={form.systemPrompt}
              onChange={(event) => onUpdateForm('systemPrompt', event.target.value)}
              rows={12}
              aria-label="角色说明"
              style={{ minHeight: 200, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
            />
          </FormField>

          <FormField label="工作规则">
            <Input.TextArea
              value={form.rulesText}
              onChange={(event) => onUpdateForm('rulesText', event.target.value)}
              rows={6}
              aria-label="工作规则"
            />
          </FormField>
        </Flex>
      </SectionCard>

      <SectionCard title="运行设置">
        <Flex vertical gap={6}>

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            {!form.binding ? (
              <>
                <FormField label="备用供应商">
                  <Select
                    value={form.provider}
                    onChange={updateProvider}
                    options={[{ value: '', label: '自动推断' }, ...agentProviderOptions]}
                    aria-label="备用供应商"
                    style={{ width: '100%' }}
                  />
                </FormField>

                <FormField label="备用模型">
                  <Input
                    value={form.model}
                    onChange={(event) => onUpdateForm('model', event.target.value)}
                    aria-label="备用模型"
                  />
                </FormField>
              </>
            ) : null}

            <FormField label="记忆范围">
              <Select
                value={form.memoryScope}
                onChange={(value) => onUpdateForm('memoryScope', value)}
                options={memoryScopeOptions}
                aria-label="记忆范围"
                style={{ width: '100%' }}
              />
            </FormField>

            <FormField label="产物归档天数">
              <Input
                value={form.artifactArchiveAfterDays}
                onChange={(event) => onUpdateForm('artifactArchiveAfterDays', event.target.value)}
                placeholder="归档天数"
                aria-label="产物归档天数"
              />
            </FormField>

            <FormField label="产物删除天数">
              <Input
                value={form.artifactDeleteAfterDays}
                onChange={(event) => onUpdateForm('artifactDeleteAfterDays', event.target.value)}
                placeholder="删除天数"
                aria-label="产物删除天数"
              />
            </FormField>

            <DevOnly>
              <FormField label="运行后端">
                <Input
                  value={form.backend}
                  onChange={(event) => onUpdateForm('backend', event.target.value)}
                  placeholder="运行后端"
                  aria-label="运行后端"
                />
              </FormField>
            </DevOnly>
          </div>

          {modelSuggestions.length > 0 && !form.binding ? (
            <Space wrap size={[8, 8]}>
              {modelSuggestions.slice(0, 6).map((modelName) => (
                <Button key={modelName} size="small" onClick={() => onUpdateForm('model', modelName)}>
                  {modelName}
                </Button>
              ))}
            </Space>
          ) : null}
        </Flex>
      </SectionCard>
    </Flex>
  )
}
