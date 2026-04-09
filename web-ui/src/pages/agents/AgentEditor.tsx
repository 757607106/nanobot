import { useMemo, useState } from 'react'
import { Button, Collapse, Descriptions, Flex, Input, Select, Space, Switch, Tag, Typography, App, Row, Col } from 'antd'
import { SettingOutlined, ExperimentOutlined } from '@ant-design/icons'
import { api } from '../../api'
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
  const { message } = App.useApp()

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
    return getModelSuggestions(provider, form.model || null)
  }, [availableBindings, form.binding, form.model, form.provider, globalConfig, globalConfigMeta])

  const promptLength = form.systemPrompt.trim().length

  const [isOptimizing, setIsOptimizing] = useState(false)

  async function handleOptimizePrompt() {
    if (!form.systemPrompt && !form.description) {
      message.warning('请先填写身份背景与职责或部分指令内容')
      return
    }
    
    setIsOptimizing(true)
    try {
      const response = await api.optimizeAgentPrompt({
        name: form.name,
        description: form.description,
        systemPrompt: form.systemPrompt,
        model: form.model,
        provider: form.provider,
      })
      if (response && response.optimized_prompt) {
        onUpdateForm('systemPrompt', response.optimized_prompt)
        message.success('指令已优化更新！')
      } else {
        message.warning('优化返回结果为空，请稍后重试。')
      }
    } catch (error) {
      console.error('Failed to optimize prompt', error)
      message.error(error instanceof Error ? error.message : '指令优化失败，请稍后重试。')
    } finally {
      setIsOptimizing(false)
    }
  }

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
    <Row gutter={[24, 24]} style={{ alignItems: 'stretch' }}>
      <Col xs={24} lg={10} xl={9} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <SectionCard title="核心设定">
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: '1fr',
            }}
          >
            <FormField label="员工名称">
              <Input
                value={form.name}
                onChange={(event) => onUpdateForm('name', event.target.value)}
                placeholder="例如：全栈工程师"
                aria-label="名称"
                style={{ borderRadius: 12, padding: '8px 12px' }}
              />
            </FormField>

            <FormField label="岗位头衔">
              <Input
                value={form.tags[0] || ''}
                onChange={(event) => {
                  const val = event.target.value.trim()
                  const rest = form.tags.slice(1)
                  onUpdateForm('tags', [val, ...rest])
                }}
                placeholder="例如：人事助理、销售精英"
                aria-label="岗位头衔"
                style={{ borderRadius: 12, padding: '8px 12px' }}
              />
            </FormField>

            <FormField label="其他能力标签">
              <Input
                value={form.tags.slice(1).join(', ')}
                onChange={(event) => {
                  const rest = parseTags(event.target.value)
                  onUpdateForm('tags', [form.tags[0] || '', ...rest])
                }}
                placeholder="Python, React, API设计 (逗号分隔)"
                aria-label="技能标签"
                style={{ borderRadius: 12, padding: '8px 12px' }}
              />
            </FormField>

            <FormField label="模型引擎">
              <Select
                value={form.binding}
                onChange={updateBinding}
                options={[{ value: '', label: '跟随系统默认引擎' }, ...agentBindingOptions]}
                aria-label="模型绑定"
                style={{ width: '100%' }}
              />
            </FormField>

            <FormField label="身份背景与职责" fullWidth>
              <Input.TextArea
                value={form.description}
                onChange={(event) => onUpdateForm('description', event.target.value)}
                rows={3}
                placeholder="用一两句话描述该员工的擅长领域"
                aria-label="职责说明"
                style={{ borderRadius: 12 }}
              />
            </FormField>
          </div>
        </SectionCard>

        {/* 高级参数折叠面板 — 非必需配置 */}
        <Collapse
          ghost
          items={[{
            key: 'advanced',
            label: (
              <Flex align="center" gap={8}>
                <SettingOutlined style={{ fontSize: 'var(--nb-text-sm)', color: 'var(--nb-muted)' }} />
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>
                  高级参数
                </Typography.Text>
              </Flex>
            ),
            children: (
              <div
                style={{
                  display: 'grid',
                  gap: 16,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  padding: '4px 0',
                }}
              >
                {!form.binding ? (
                  <>
                    <FormField label="接口 (Provider)">
                      <Select
                        value={form.provider}
                        onChange={updateProvider}
                        options={[{ value: '', label: '自动推断' }, ...agentProviderOptions]}
                        aria-label="备用供应商"
                        style={{ width: '100%' }}
                      />
                    </FormField>

                    <FormField label="模型版本 (Model)">
                      <Input
                        value={form.model}
                        onChange={(event) => onUpdateForm('model', event.target.value)}
                        aria-label="备用模型"
                        style={{ borderRadius: 12 }}
                      />
                    </FormField>
                  </>
                ) : null}

                <FormField label="自动记忆提取">
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
                    placeholder="永久保存"
                    aria-label="产物归档天数"
                    style={{ borderRadius: 12 }}
                  />
                </FormField>
                
                <DevOnly>
                  <FormField label="运行后端">
                    <Input
                      value={form.backend}
                      onChange={(event) => onUpdateForm('backend', event.target.value)}
                      placeholder="默认路由"
                      aria-label="运行后端"
                      style={{ borderRadius: 12 }}
                    />
                  </FormField>
                </DevOnly>

                {modelSuggestions.length > 0 && !form.binding ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', marginBottom: 8, display: 'block' }}>
                      快速选择模型
                    </Typography.Text>
                    <Space wrap size={[8, 8]}>
                      {modelSuggestions.slice(0, 6).map((modelName) => (
                        <Button key={modelName} size="small" onClick={() => onUpdateForm('model', modelName)} style={{ borderRadius: 12 }}>
                          {modelName}
                        </Button>
                      ))}
                    </Space>
                  </div>
                ) : null}
              </div>
            ),
          }]}
          style={{
            background: 'var(--nb-surface-strong)',
            borderRadius: 16,
            border: '1px solid var(--nb-card-border)',
          }}
        />
      </Col>

      <Col xs={24} lg={14} xl={15} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <SectionCard title="核心逻辑指令">
          <Flex vertical gap={24}>
            <FormField 
              label={
                <Flex align="center" justify="space-between" style={{ width: '100%' }}>
                  <span>System Directives (核心指令)</span>
                  <Button 
                    type="link" 
                    size="small" 
                    icon={<ExperimentOutlined />} 
                    loading={isOptimizing}
                    onClick={handleOptimizePrompt}
                    style={{ padding: 0, fontSize: 'var(--nb-text-xs)' }}
                  >
                    AI 补全与优化
                  </Button>
                </Flex>
              }
            >
              <div style={{ padding: '2px', borderRadius: 14, background: 'var(--nb-surface)' }}>
                <Input.TextArea
                  value={form.systemPrompt}
                  onChange={(event) => onUpdateForm('systemPrompt', event.target.value)}
                  autoSize={{ minRows: 16 }}
                  aria-label="角色说明"
                  style={{ 
                    borderRadius: 12, border: 'none', background: 'transparent',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    lineHeight: 1.6
                  }}
                />
              </div>
            </FormField>
          </Flex>
        </SectionCard>
      </Col>
    </Row>
  )
}
