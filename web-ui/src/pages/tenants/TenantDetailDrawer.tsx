import { useEffect, useState } from 'react'
import {
  Button,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  Typography,
  theme,
} from 'antd'
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { Tenant, ArtifactRetentionPolicy, TenantApiKey } from '../../types'
import { useToast } from '../../toast'


interface Props {
  open: boolean
  onClose: () => void
  tenantId: string | null
  onSaved: () => void
}

export default function TenantDetailDrawer({ open, onClose, tenantId, onSaved }: Props) {
  const message = useToast()
  const { token } = theme.useToken()
  const [form] = Form.useForm()
  const [retentionForm] = Form.useForm()
  const [apiKeyForm] = Form.useForm()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [retentionPolicy, setRetentionPolicy] = useState<ArtifactRetentionPolicy | null>(null)
  const [apiKeys, setApiKeys] = useState<TenantApiKey[]>([])
  
  const [newApiKeyToken, setNewApiKeyToken] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setNewApiKeyToken(null)
      if (tenantId) {
        void loadTenantFull(tenantId)
      } else {
        setTenant(null)
        setRetentionPolicy(null)
        setApiKeys([])
        form.resetFields()
        form.setFieldsValue({ isActive: true })
      }
    }
  }, [open, tenantId])

  async function loadTenantFull(id: string) {
    try {
      setLoading(true)
      const t = await api.getTenant(id)
      setTenant(t)
      form.setFieldsValue(t)

      const r = await api.getTenantArtifactRetentionPolicy(id)
      setRetentionPolicy(r)
      retentionForm.setFieldsValue(r)

      const keys = await api.getTenantApiKeys(id)
      setApiKeys(keys)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载租户详情失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveBasic() {
    try {
      setSaving(true)
      const values = await form.validateFields()
      if (tenantId) {
        await api.updateTenant(tenantId, values)
        message.success('已保存配置')
      } else {
        await api.createTenant(values)
        message.success('已创建租户')
      }
      onSaved()
      onClose()
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return // Form validation error
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveRetention() {
    if (!tenantId) return
    try {
      setSaving(true)
      const values = await retentionForm.validateFields()
      await api.updateTenantArtifactRetentionPolicy(tenantId, values)
      message.success('已保存制品留存策略')
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error(error instanceof Error ? error.message : '保存策略失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateApiKey() {
    if (!tenantId) return
    try {
      setSaving(true)
      const values = await apiKeyForm.validateFields()
      const newKey = await api.createTenantApiKey(tenantId, values)
      message.success('已生成新的 API Key')
      apiKeyForm.resetFields()
      setNewApiKeyToken(newKey.token ?? null)
      // Refresh list
      const keys = await api.getTenantApiKeys(tenantId)
      setApiKeys(keys)
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error(error instanceof Error ? error.message : '生成 API Key 失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleRevokeApiKey(keyId: string) {
    try {
      await api.revokeApiKey(keyId, tenantId ?? 'default')
      message.success('API Key 已吊销')
      if (tenantId) {
        const keys = await api.getTenantApiKeys(tenantId)
        setApiKeys(keys)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '吊销失败')
    }
  }

  return (
    <Drawer
      title={tenantId ? `租户设​​置 - ${tenant?.name || tenantId}` : '新建租户'}
      width={600}
      open={open}
      onClose={onClose}
      destroyOnClose
      loading={loading}
    >
      <Tabs
        defaultActiveKey="basic"
        items={[
          {
            key: 'basic',
            label: '基础配置',
            children: (
              <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
                <Form.Item name="name" label="租户名称" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="输入租户名称" />
                </Form.Item>
                <Form.Item name="isActive" label="运行状态" valuePropName="checked">
                  <Switch checkedChildren="正常" unCheckedChildren="停用" />
                </Form.Item>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSaveBasic()} loading={saving}>
                  {tenantId ? '保存配置' : '新建'}
                </Button>
              </Form>
            ),
          },
          ...(tenantId
            ? [
                {
                  key: 'retention',
                  label: '制品留存策略',
                  children: (
                    <Form form={retentionForm} layout="vertical" style={{ marginTop: 12 }}>
                      <Typography.Paragraph type="secondary">
                        系统将定期清理或归档过期的历史运行制品数据（如沙盒产物、执行日志等）。留空表示不自动清理。
                      </Typography.Paragraph>
                      <Form.Item name="archiveAfterDays" label="归档后过期天数" tooltip="超过该天数的制品将被移至慢存储或打上归档标记">
                        <InputNumber min={1} style={{ width: 200 }} placeholder="不需要此策略则留空" />
                      </Form.Item>
                      <Form.Item name="deleteAfterDays" label="彻底删除过期天数" tooltip="超过该天数的制品将被永久删除">
                        <InputNumber min={1} style={{ width: 200 }} placeholder="不需要此策略则留空" />
                      </Form.Item>
                      <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSaveRetention()} loading={saving}>
                        保存策略
                      </Button>
                    </Form>
                  ),
                },
                {
                  key: 'apikeys',
                  label: 'API Keys',
                  children: (
                    <Flex vertical gap={24} style={{ marginTop: 12 }}>
                      {newApiKeyToken && (
                        <div style={{ padding: 12, background: token.colorSuccessBg, border: `1px solid ${token.colorSuccessBorder}`, borderRadius: 8 }}>
                          <Typography.Text strong style={{ color: token.colorSuccess }}>API Key 已成功创建</Typography.Text>
                          <Typography.Paragraph copyable style={{ margin: '8px 0 0', fontFamily: token.fontFamilyCode, wordBreak: 'break-all' }}>
                            {newApiKeyToken}
                          </Typography.Paragraph>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            请立即复制并妥善保管此密钥。关闭此窗口后将无法再次查看前文明文密钥。
                          </Typography.Text>
                        </div>
                      )}
                      
                      <Form form={apiKeyForm} layout="inline" onFinish={() => void handleCreateApiKey()}>
                        <Form.Item name="name" rules={[{ required: true, message: '请输入摘要用途' }]}>
                          <Input placeholder="新密钥用途摘要" />
                        </Form.Item>
                        <Form.Item>
                          <Button type="dashed" htmlType="submit" icon={<PlusOutlined />} loading={saving}>
                            生成新密钥
                          </Button>
                        </Form.Item>
                      </Form>

                      <Table<TenantApiKey>
                        dataSource={apiKeys}
                        rowKey="keyId"
                        pagination={false}
                        size="small"
                        columns={[
                          { title: '用途', dataIndex: 'name', key: 'name' },
                          { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (val) => new Date(val).toLocaleDateString() },
                          { title: '最后使用', dataIndex: 'lastUsedAt', key: 'lastUsedAt', render: (val) => val ? new Date(val).toLocaleDateString() : '从未使用' },
                          {
                            title: '操作',
                            key: 'action',
                            width: 80,
                            render: (_, record) => (
                              <Popconfirm title="确认吊销此密钥？" onConfirm={() => void handleRevokeApiKey(record.keyId)}>
                                <Button type="text" danger size="small">吊销</Button>
                              </Popconfirm>
                            ),
                          },
                        ]}
                      />
                    </Flex>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Drawer>
  )
}
