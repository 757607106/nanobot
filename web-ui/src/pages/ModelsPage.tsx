import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ApiOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import { api, ApiError } from '../api'
import PageHero from '../components/PageHero'
import {
  buildModelBinding,
  createBindingId,
  getAllModelBindings,
  getPreferredBinding,
  getProviderMeta,
  normalizeModelConfig,
  updateBindingValue,
} from '../modelConfig'
import type { ConfigData, ConfigMeta, ModelBinding, ModelBindingTestResult, ProviderMeta } from '../types'

const { Text } = Typography

type ProviderIconAsset = {
  src?: string
  fallback: string
}

const providerIcons: Record<string, ProviderIconAsset> = {
  anthropic: { src: '/provider-logos/Anthropic.png', fallback: '🟠' },
  openai: { src: '/provider-logos/openai.png', fallback: '🟢' },
  openrouter: { fallback: '🔵' },
  deepseek: { src: '/provider-logos/DeepSeek.png', fallback: '🐋' },
  volcengine: { src: '/provider-logos/volcengine-color.png', fallback: '🌋' },
  volcengine_coding_plan: { src: '/provider-logos/volcengine-color.png', fallback: '🌋' },
  groq: { fallback: '⚡' },
  zhipu: { src: '/provider-logos/qingyan-color.png', fallback: '🧠' },
  dashscope: { src: encodeURI('/provider-logos/百炼.png'), fallback: '☁️' },
  vllm: { fallback: '🖥️' },
  ollama: { src: '/provider-logos/ollama.png', fallback: '🦙' },
  gemini: { src: '/provider-logos/Gemini.png', fallback: '💎' },
  moonshot: { fallback: '🌙' },
  minimax: { fallback: '🔮' },
  aihubmix: { fallback: '🎛️' },
  azure_openai: { src: '/provider-logos/openai.png', fallback: '🪟' },
  siliconflow: { src: '/provider-logos/stability-color.png', fallback: '🫧' },
  openai_codex: { src: '/provider-logos/codex-color.png', fallback: '⌘' },
  custom: { fallback: '⚙️' },
}

function renderProviderIcon(providerName: string, className?: string) {
  const icon = providerIcons[providerName] ?? { fallback: '🤖' }
  const nextClassName = ['models-provider-emoji', className, icon.src ? 'has-image' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <span className={nextClassName} aria-hidden="true" style={{ fontSize: '1.2em', marginRight: '8px' }}>
      {icon.src ? <img className="models-provider-icon-image" src={icon.src} alt="" style={{ height: '1.2em', verticalAlign: 'middle' }} /> : icon.fallback}
    </span>
  )
}

function getBindingRouteErrorMessage(error: unknown, action: '检测连接' | '获取模型列表') {
  if (error instanceof ApiError && error.statusCode === 404) {
    return `当前 Web 后端还没加载“${action}”接口，通常是 dev 模式下后端没有重启。请重启 nanobot Web 服务后再试。`
  }
  return error instanceof Error ? error.message : `${action}失败`
}

export default function ModelsPage() {
  const { message, modal } = App.useApp()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configMeta, setConfigMeta] = useState<ConfigMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredQuery = useDeferredValue(searchQuery)

  const [activeProviderName, setActiveProviderName] = useState<string | null>(null)
  const [isAddModelModalOpen, setIsAddModelModalOpen] = useState(false)
  const [addModelForm] = Form.useForm()

  const [testModalOpen, setTestModalOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testForm] = Form.useForm()
  const [testResult, setTestResult] = useState<ModelBindingTestResult | null>(null)

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
      message.error(error instanceof Error ? error.message : '加载模型配置失败')
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

  function handleAddBinding(values: { modelId: string; modelName: string; capabilityType: 'text_chat' | 'embedding' | 'multimodal' }) {
    if (!config || !activeProviderName) return
    const providerMeta = getProviderMeta(configMeta, activeProviderName)
    const bindingName = createBindingId(values.modelId, bindings)
    
    updateConfig((current) => {
      return updateBindingValue(current, bindingName, providerMeta, buildModelBinding(activeProviderName, providerMeta ?? undefined, {
        label: values.modelName,
        model: values.modelId,
        capabilityType: values.capabilityType,
      }))
    })
    setIsAddModelModalOpen(false)
    addModelForm.resetFields()
  }

  function deleteBinding(bindingName: string) {
    updateConfig((current) => {
      const nextBindings = { ...(current.modelBindings ?? {}) }
      delete nextBindings[bindingName]
      return {
        ...current,
        modelBindings: nextBindings,
      }
    })
  }

  function setAsDefaultBinding(bindingName: string) {
    updateConfig((current) => {
      const b = bindings[bindingName]
      if (!b) return current
      return {
        ...current,
        agents: {
          ...current.agents,
          defaults: {
            ...current.agents.defaults,
            binding: bindingName,
            provider: b.provider,
            model: b.model || current.agents.defaults.model,
          },
        },
      }
    })
  }

  function updateProviderCredential(providerName: string, field: 'apiKey' | 'apiBase', value: string) {
    updateConfig((current) => {
      const currentProviderConfig = current.providers[providerName] || { apiKey: '' }
      return {
        ...current,
        providers: {
          ...current.providers,
          [providerName]: {
            ...currentProviderConfig,
            [field]: value,
          },
        },
      }
    })
  }

  function openTestModal(initialData?: { apiKey?: string; apiBase?: string; model?: string }) {
    testForm.setFieldsValue({
      apiKey: initialData?.apiKey || activeProviderConfig?.apiKey || '',
      apiBase: initialData?.apiBase || activeProviderConfig?.apiBase || '',
      model: initialData?.model || '',
    })
    setTestResult(null)
    setTestModalOpen(true)
  }

  async function handleTestConnection(values: { apiKey: string; apiBase: string; model: string }) {
    if (!activeProviderName) return
    try {
      setTesting(true)
      setTestResult(null)
      const payload = {
        bindingName: 'temp-test-binding',
        provider: activeProviderName,
        model: values.model.trim(),
        apiKey: values.apiKey.trim(),
        apiBase: values.apiBase?.trim() || null,
        extraHeaders: {},
      }
      const result = await api.testModelBinding(payload)
      setTestResult(result)
      if (result.ok) {
         message.success('连接测试成功')
      } else {
         message.error('连接失败，请检查密钥及地址参数')
      }
    } catch (error) {
      setTestResult({
        ok: false,
        provider: activeProviderName,
        model: values.model,
        bindingName: 'temp-test-binding',
        label: 'Test',
        latencyMs: 0,
        finishReason: 'error',
        message: getBindingRouteErrorMessage(error, '检测连接'),
        responsePreview: null,
        usage: {},
      })
      message.error(getBindingRouteErrorMessage(error, '检测连接'))
    } finally {
      setTesting(false)
    }
  }

  const providers = useMemo(() => {
    if (!configMeta) return []
    const q = deferredQuery.toLowerCase()
    return configMeta.providers.filter(p => p.label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
  }, [configMeta, deferredQuery])

  const activeProviderMeta = activeProviderName ? getProviderMeta(configMeta, activeProviderName) : null
  const activeProviderBindings = useMemo(() => {
    return Object.entries(bindings)
      .filter(([, b]) => b.provider === activeProviderName)
      .map(([name, b]) => ({ bindingName: name, ...b }))
  }, [bindings, activeProviderName])

  const activeProviderConfig = config?.providers?.[activeProviderName || '']

  return (
    <div className="page-stack">
      <PageHero
        title="模型供应商"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadModels} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={saveCurrentConfig} loading={saving}>
              保存所有配置
            </Button>
          </Space>
        }
      />
      
      <div className="studio-container" style={{ padding: '0 24px' }}>
        <Input.Search
          placeholder="搜索供应商..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 320, marginBottom: 24 }}
        />
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {providers.map((p) => {
            const providerBindingsCount = Object.values(bindings).filter(b => b.provider === p.name).length
            const isConfigured = Boolean((config?.providers?.[p.name]?.apiKey || '').trim())
            return (
              <Card 
                key={p.name} 
                hoverable 
                onClick={() => setActiveProviderName(p.name)}
                style={{ cursor: 'pointer', borderColor: isConfigured ? '#52c41a' : undefined }}
              >
                <Card.Meta
                  title={
                    <Space>
                      {renderProviderIcon(p.name)} 
                      {p.label} 
                      {isConfigured && <Tag color="green">已验证</Tag>}
                    </Space>
                  }
                  description={<span>{providerBindingsCount} 个可用模型资源</span>}
                />
              </Card>
            )
          })}
        </div>
        {providers.length === 0 && <Empty description="没有找到供应商" />}
      </div>

      <Drawer
        title={activeProviderMeta ? <span>{renderProviderIcon(activeProviderMeta.name)} {activeProviderMeta.label} 配置</span> : ''}
        width={720}
        open={Boolean(activeProviderName)}
        onClose={() => setActiveProviderName(null)}
        extra={<Button type="primary" onClick={saveCurrentConfig} loading={saving}>保存更改</Button>}
      >
        {activeProviderMeta && (
          <div className="page-stack">
            <Card title="云端供应商全局凭据" size="small" extra={<Button icon={<ApiOutlined />} onClick={() => openTestModal()}>测试连接</Button>}>
              <div className="studio-form-grid" style={{ gridTemplateColumns: '1fr' }}>
                {!activeProviderMeta.isOauth && (
                  <div className="studio-form-field">
                    <Text type="secondary">API Key</Text>
                    <Input.Password
                      value={activeProviderConfig?.apiKey || ''}
                      onChange={(e) => updateProviderCredential(activeProviderName!, 'apiKey', e.target.value)}
                      placeholder="设置全局 API Key"
                    />
                  </div>
                )}
                {(!activeProviderMeta.isDirect || activeProviderMeta.isLocal) && (
                  <div className="studio-form-field">
                    <Text type="secondary">API Base URL</Text>
                    <Input
                      value={activeProviderConfig?.apiBase || ''}
                      onChange={(e) => updateProviderCredential(activeProviderName!, 'apiBase', e.target.value)}
                      placeholder={activeProviderMeta.defaultApiBase || "自定义接口地址"}
                    />
                  </div>
                )}
              </div>
            </Card>

            <Card 
              title="已注册模型" 
              size="small" 
              extra={<Button type="dashed" icon={<PlusOutlined />} onClick={() => setIsAddModelModalOpen(true)}>添加模型</Button>}
            >
              <Table 
                dataSource={activeProviderBindings}
                rowKey="bindingName"
                pagination={false}
                columns={[
                  { title: '模型名称', dataIndex: 'label', key: 'label' },
                  { title: '模型 ID', dataIndex: 'model', key: 'model' },
                  { 
                    title: '能力类型', 
                    dataIndex: 'capabilityType', 
                    key: 'capabilityType',
                    render: (type) => {
                      if (type === 'embedding') return <Tag color="orange">文本向量</Tag>
                      if (type === 'multimodal') return <Tag color="purple">多模态</Tag>
                      return <Tag color="blue">文本对话</Tag>
                    }
                  },
                  {
                    title: '状态',
                    key: 'status',
                    render: (_, record) => (record as any).bindingName === defaultBindingName ? <Tag color="green">默认</Tag> : null
                  },
                  {
                    title: '操作',
                    key: 'action',
                    render: (_, record) => (
                      <Space>
                        <a onClick={() => openTestModal({ model: record.model || '' })}>测试</a>
                        {(record as any).bindingName !== defaultBindingName && record.capabilityType !== 'embedding' && (
                           <a onClick={() => setAsDefaultBinding((record as any).bindingName)}>设为默认</a>
                        )}
                        <a style={{ color: '#ff4d4f' }} onClick={() => deleteBinding((record as any).bindingName)}>删除</a>
                      </Space>
                    )
                  }
                ]}
              />
            </Card>
          </div>
        )}
      </Drawer>

      <Modal
        title="添加模型资源"
        open={isAddModelModalOpen}
        onCancel={() => { setIsAddModelModalOpen(false); addModelForm.resetFields() }}
        onOk={() => addModelForm.submit()}
        okText="确认登记"
      >
        <Form form={addModelForm} onFinish={handleAddBinding} layout="vertical">
          <Form.Item name="modelId" label="模型 ID" rules={[{ required: true, message: '请求接口使用的确切 ID（如 qwen3-vl-embedding）' }]}>
            <Input placeholder="例如：gpt-4o、qwen3-vl-embedding" />
          </Form.Item>
          <Form.Item name="modelName" label="模型展示名称" rules={[{ required: true, message: '展示用名称（如 通义千问VL）' }]}>
            <Input placeholder="例如：通义千问 VL" />
          </Form.Item>
          <Form.Item name="capabilityType" label="模型能力类型" initialValue="text_chat">
            <Select options={[
              { value: 'text_chat', label: '文本对话 (Text Chat)' },
              { value: 'embedding', label: '向量嵌入 (Embedding)' },
              { value: 'multimodal', label: '多模态 (Multimodal)' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="测试模型连接"
        open={testModalOpen}
        onCancel={() => setTestModalOpen(false)}
        footer={null}
      >
        <Form form={testForm} onFinish={handleTestConnection} layout="vertical">
          <Form.Item name="model" label="测试模型 ID" rules={[{ required: true, message: '请输入模型 ID' }]}>
            <Input placeholder="例如：gpt-3.5-turbo" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password placeholder="覆盖全局 Key (可选)" />
          </Form.Item>
          <Form.Item name="apiBase" label="API Base URL">
            <Input placeholder="覆盖全局 Base URL (可选)" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={testing} block>开始测试</Button>
        </Form>

        {testResult && (
          <div style={{ marginTop: 24 }}>
            <Text type={testResult.ok ? 'success' : 'danger'} strong>
              测试{testResult.ok ? '通过' : '失败'} {testResult.model ? `(实际模型：${testResult.model})` : ''}
            </Text>
            {testResult.responsePreview && (
              <pre style={{ marginTop: 12, padding: 12, background: '#f5f5f5', borderRadius: 6, fontSize: '0.9em', overflowX: 'auto' }}>
                {testResult.responsePreview}
              </pre>
            )}
            {!testResult.ok && testResult.message && (
              <Alert type="error" message={testResult.message} style={{ marginTop: 12 }} />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
