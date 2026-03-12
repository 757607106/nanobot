import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { api } from '../api'
import type { ConfigData, ProviderConfig } from '../types'

const { Title, Text } = Typography

function cardTitle(label: string) {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function parseList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

export default function ConfigPage() {
  const { message } = App.useApp()
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [configDraft, setConfigDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void loadConfig()
  }, [])

  const providerEntries = useMemo(
    () => Object.entries(config?.providers ?? {}) as Array<[string, ProviderConfig]>,
    [config],
  )

  async function loadConfig() {
    try {
      setLoading(true)
      const data = await api.getConfig()
      setConfig(data)
      setConfigDraft(JSON.stringify(data, null, 2))
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to load config')
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

  async function saveCurrentConfig(target?: ConfigData) {
    const payload = target ?? config
    if (!payload) {
      return
    }
    try {
      setSaving(true)
      const saved = await api.updateConfig(payload)
      updateConfig(saved)
      message.success('Configuration saved')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  async function handleRawSave() {
    try {
      const parsed = JSON.parse(configDraft) as ConfigData
      await saveCurrentConfig(parsed)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Invalid JSON')
    }
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!config) {
    return <Empty description="Config unavailable" className="page-card" />
  }

  const channelEntries = Object.entries(config.channels).filter(
    ([key, value]) => key !== 'sendProgress' && key !== 'sendToolHints' && typeof value === 'object' && value !== null,
  ) as Array<[string, Record<string, unknown>]>

  return (
    <div className="page-card">
      <div className="page-header-block">
        <div>
          <Title level={2}>Config</Title>
          <Text type="secondary">
            Edit the current backend configuration using the active schema.
          </Text>
        </div>
        <Space>
          <Button onClick={() => void loadConfig()}>Reload</Button>
          <Button type="primary" loading={saving} onClick={() => void saveCurrentConfig()}>
            Save
          </Button>
        </Space>
      </div>

      <Tabs
        items={[
          {
            key: 'forms',
            label: 'Forms',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card title="Agent Defaults">
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <Text>Workspace</Text>
                      <Input
                        value={config.agents.defaults.workspace}
                        onChange={(event) =>
                          updateAtPath(['agents', 'defaults', 'workspace'], event.target.value)
                        }
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Text>Model</Text>
                      <Input
                        value={config.agents.defaults.model}
                        onChange={(event) =>
                          updateAtPath(['agents', 'defaults', 'model'], event.target.value)
                        }
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text>Provider</Text>
                      <Input
                        value={config.agents.defaults.provider}
                        onChange={(event) =>
                          updateAtPath(['agents', 'defaults', 'provider'], event.target.value)
                        }
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text>Max Tokens</Text>
                      <InputNumber
                        value={config.agents.defaults.maxTokens}
                        style={{ width: '100%' }}
                        onChange={(value) =>
                          updateAtPath(['agents', 'defaults', 'maxTokens'], value ?? 0)
                        }
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text>Context Window</Text>
                      <InputNumber
                        value={config.agents.defaults.contextWindowTokens}
                        style={{ width: '100%' }}
                        onChange={(value) =>
                          updateAtPath(['agents', 'defaults', 'contextWindowTokens'], value ?? 0)
                        }
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text>Temperature</Text>
                      <InputNumber
                        min={0}
                        max={2}
                        step={0.1}
                        value={config.agents.defaults.temperature}
                        style={{ width: '100%' }}
                        onChange={(value) =>
                          updateAtPath(['agents', 'defaults', 'temperature'], value ?? 0)
                        }
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text>Max Tool Iterations</Text>
                      <InputNumber
                        min={1}
                        value={config.agents.defaults.maxToolIterations}
                        style={{ width: '100%' }}
                        onChange={(value) =>
                          updateAtPath(['agents', 'defaults', 'maxToolIterations'], value ?? 1)
                        }
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text>Reasoning Effort</Text>
                      <Input
                        value={config.agents.defaults.reasoningEffort ?? ''}
                        onChange={(event) =>
                          updateAtPath(
                            ['agents', 'defaults', 'reasoningEffort'],
                            event.target.value || null,
                          )
                        }
                      />
                    </Col>
                  </Row>
                </Card>

                <Card
                  title="Providers"
                  extra={<Tag color="cyan">{providerEntries.length} configured sections</Tag>}
                >
                  <Row gutter={[16, 16]}>
                    {providerEntries.map(([name, provider]) => (
                      <Col xs={24} xl={12} key={name}>
                        <Card size="small" title={cardTitle(name)}>
                          <Space direction="vertical" style={{ width: '100%' }} size="middle">
                            <div>
                              <Text>API Key</Text>
                              <Input.Password
                                value={provider.apiKey}
                                onChange={(event) =>
                                  updateAtPath(['providers', name, 'apiKey'], event.target.value)
                                }
                              />
                            </div>
                            <div>
                              <Text>API Base</Text>
                              <Input
                                value={provider.apiBase ?? ''}
                                onChange={(event) =>
                                  updateAtPath(
                                    ['providers', name, 'apiBase'],
                                    event.target.value || null,
                                  )
                                }
                              />
                            </div>
                          </Space>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </Card>

                <Card title="Channels">
                  <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <Space>
                      <Text>Send Progress</Text>
                      <Switch
                        checked={Boolean(config.channels.sendProgress)}
                        onChange={(checked) => updateAtPath(['channels', 'sendProgress'], checked)}
                      />
                      <Text>Send Tool Hints</Text>
                      <Switch
                        checked={Boolean(config.channels.sendToolHints)}
                        onChange={(checked) => updateAtPath(['channels', 'sendToolHints'], checked)}
                      />
                    </Space>
                    <Row gutter={[16, 16]}>
                      {channelEntries.map(([name, channel]) => (
                        <Col xs={24} xl={12} key={name}>
                          <Card size="small" title={cardTitle(name)}>
                            <Space direction="vertical" style={{ width: '100%' }}>
                              <Space>
                                <Text>Enabled</Text>
                                <Switch
                                  checked={Boolean(channel.enabled)}
                                  onChange={(checked) => updateAtPath(['channels', name, 'enabled'], checked)}
                                />
                              </Space>
                              {Object.entries(channel)
                                .filter(
                                  ([field, value]) =>
                                    field !== 'enabled' &&
                                    (typeof value === 'string' ||
                                      typeof value === 'number' ||
                                      typeof value === 'boolean' ||
                                      Array.isArray(value)),
                                )
                                .map(([field, value]) => (
                                  <div key={field}>
                                    <Text>{cardTitle(field)}</Text>
                                    {typeof value === 'boolean' ? (
                                      <div>
                                        <Switch
                                          checked={value}
                                          onChange={(checked) =>
                                            updateAtPath(['channels', name, field], checked)
                                          }
                                        />
                                      </div>
                                    ) : typeof value === 'number' ? (
                                      <InputNumber
                                        value={value}
                                        style={{ width: '100%' }}
                                        onChange={(next) =>
                                          updateAtPath(['channels', name, field], next ?? 0)
                                        }
                                      />
                                    ) : Array.isArray(value) ? (
                                      <Input.TextArea
                                        rows={3}
                                        value={value.join('\n')}
                                        onChange={(event) =>
                                          updateAtPath(
                                            ['channels', name, field],
                                            parseList(event.target.value),
                                          )
                                        }
                                      />
                                    ) : (
                                      <Input
                                        value={String(value ?? '')}
                                        onChange={(event) =>
                                          updateAtPath(['channels', name, field], event.target.value)
                                        }
                                      />
                                    )}
                                  </div>
                                ))}
                            </Space>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  </Space>
                </Card>

                <Card title="Tools">
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <Text>Restrict To Workspace</Text>
                      <div>
                        <Switch
                          checked={Boolean(config.tools.restrictToWorkspace)}
                          onChange={(checked) => updateAtPath(['tools', 'restrictToWorkspace'], checked)}
                        />
                      </div>
                    </Col>
                    <Col xs={24} md={8}>
                      <Text>Web Proxy</Text>
                      <Input
                        value={config.tools.web?.proxy ?? ''}
                        onChange={(event) =>
                          updateAtPath(['tools', 'web', 'proxy'], event.target.value || null)
                        }
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <Text>Brave Search API Key</Text>
                      <Input.Password
                        value={config.tools.web?.search?.apiKey ?? ''}
                        onChange={(event) =>
                          updateAtPath(['tools', 'web', 'search', 'apiKey'], event.target.value)
                        }
                      />
                    </Col>
                  </Row>
                  <div style={{ marginTop: 16 }}>
                    <Text strong>MCP Servers</Text>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                      Edit advanced MCP configuration in the Raw JSON tab.
                    </Text>
                  </div>
                </Card>
              </Space>
            ),
          },
          {
            key: 'raw',
            label: 'Raw JSON',
            children: (
              <Card>
                <Form layout="vertical">
                  <Form.Item label="Full Configuration JSON">
                    <Input.TextArea
                      rows={28}
                      value={configDraft}
                      onChange={(event) => setConfigDraft(event.target.value)}
                      spellCheck={false}
                    />
                  </Form.Item>
                </Form>
                <Space>
                  <Button onClick={() => setConfigDraft(JSON.stringify(config, null, 2))}>
                    Reset Draft
                  </Button>
                  <Button type="primary" loading={saving} onClick={() => void handleRawSave()}>
                    Save Raw JSON
                  </Button>
                </Space>
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}
