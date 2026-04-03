import { useMemo } from 'react'
import { Alert, Button, Descriptions, Flex, Input, Select, Space, Switch, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import SectionCard from '../../components/console/SectionCard'
import DevOnly from '../../components/DevOnly'
import { useDevMode } from '../../devMode'
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
  const navigate = useNavigate()
  const { devMode } = useDevMode()

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
      <SectionCard title="运行画像">
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 4 }}
          items={[
            { key: 'binding', label: '模型绑定', children: form.binding || '跟随默认绑定' },
            { key: 'provider', label: '供应商', children: selectedBindingProviderLabel || form.provider || '自动推断' },
            { key: 'memory', label: '记忆范围', children: memoryScopeLabel(form.memoryScope) },
            { key: 'knowledge', label: '知识库', children: `${form.knowledgeBindingIds.length} 个已绑定` },
          ]}
        />
      </SectionCard>

      <SectionCard title="身份与职责">
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Typography.Text type="secondary">名称</Typography.Text>
            <Input
              value={form.name}
              onChange={(event) => onUpdateForm('name', event.target.value)}
              placeholder="员工名称"
              aria-label="名称"
              style={{ marginTop: 8 }}
            />
          </div>

          <div style={{ minWidth: 0 }}>
            <Typography.Text type="secondary">标签</Typography.Text>
            <Input
              value={form.tags.join(', ')}
              onChange={(event) => onUpdateForm('tags', parseTags(event.target.value))}
              placeholder="tag1, tag2"
              aria-label="标签"
              style={{ marginTop: 8 }}
            />
          </div>

          <div style={{ minWidth: 0 }}>
            <Typography.Text type="secondary">模型绑定</Typography.Text>
            <Select
              value={form.binding}
              onChange={updateBinding}
              options={[{ value: '', label: '跟随默认绑定' }, ...agentBindingOptions]}
              aria-label="模型绑定"
              style={{ marginTop: 8, width: '100%' }}
            />
          </div>

          <div style={{ minWidth: 0 }}>
            <Typography.Text type="secondary">启用状态</Typography.Text>
            <div style={{ marginTop: 12 }}>
              <Switch
                checked={form.enabled}
                onChange={(checked) => onUpdateForm('enabled', checked)}
                checkedChildren="启用"
                unCheckedChildren="停用"
              />
            </div>
          </div>

          <div style={{ minWidth: 0, gridColumn: '1 / -1' }}>
            <Typography.Text type="secondary">职责说明</Typography.Text>
            <Input.TextArea
              value={form.description}
              onChange={(event) => onUpdateForm('description', event.target.value)}
              rows={4}
              aria-label="职责说明"
              style={{ marginTop: 8 }}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="角色说明与规则">
        <Flex vertical gap={6}>
          <div>
            <Typography.Text type="secondary">角色说明</Typography.Text>
            <Input.TextArea
              value={form.systemPrompt}
              onChange={(event) => onUpdateForm('systemPrompt', event.target.value)}
              rows={12}
              aria-label="角色说明"
              style={{ marginTop: 8 }}
            />
          </div>

          <div>
            <Typography.Text type="secondary">工作规则</Typography.Text>
            <Input.TextArea
              value={form.rulesText}
              onChange={(event) => onUpdateForm('rulesText', event.target.value)}
              rows={6}
              aria-label="工作规则"
              style={{ marginTop: 8 }}
            />
          </div>
        </Flex>
      </SectionCard>

      <SectionCard title="运行策略">
        <Flex vertical gap={6}>
          <Alert
            type="info"
            showIcon
            message="选中模型绑定后，下方供应商与模型只作为补充信息保留，不再作为主配置入口。"
          />

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary">备用供应商</Typography.Text>
              <Select
                value={form.provider}
                onChange={updateProvider}
                options={[{ value: '', label: '自动推断' }, ...agentProviderOptions]}
                disabled={Boolean(form.binding)}
                aria-label="备用供应商"
                style={{ marginTop: 8, width: '100%' }}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary">备用模型</Typography.Text>
              <Input
                value={form.model}
                onChange={(event) => onUpdateForm('model', event.target.value)}
                disabled={Boolean(form.binding)}
                aria-label="备用模型"
                style={{ marginTop: 8 }}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary">记忆范围</Typography.Text>
              <Select
                value={form.memoryScope}
                onChange={(value) => onUpdateForm('memoryScope', value)}
                options={memoryScopeOptions}
                aria-label="记忆范围"
                style={{ marginTop: 8, width: '100%' }}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary">产物归档天数</Typography.Text>
              <Input
                value={form.artifactArchiveAfterDays}
                onChange={(event) => onUpdateForm('artifactArchiveAfterDays', event.target.value)}
                placeholder="归档天数"
                aria-label="产物归档天数"
                style={{ marginTop: 8 }}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary">产物删除天数</Typography.Text>
              <Input
                value={form.artifactDeleteAfterDays}
                onChange={(event) => onUpdateForm('artifactDeleteAfterDays', event.target.value)}
                placeholder="删除天数"
                aria-label="产物删除天数"
                style={{ marginTop: 8 }}
              />
            </div>

            <DevOnly>
              <div style={{ minWidth: 0 }}>
                <Typography.Text type="secondary">运行后端</Typography.Text>
                <Input
                  value={form.backend}
                  onChange={(event) => onUpdateForm('backend', event.target.value)}
                  placeholder="运行后端"
                  aria-label="运行后端"
                  style={{ marginTop: 8 }}
                />
              </div>
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
