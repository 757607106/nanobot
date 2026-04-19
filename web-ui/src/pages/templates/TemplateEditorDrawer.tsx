import { useEffect, useState } from 'react'
import {
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Switch,
  Row,
  Col,
  Flex,
  Spin
} from 'antd'
import SectionCard from '../../components/console/SectionCard'
import DevOnly from '../../components/DevOnly'
import { SaveOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { AgentTemplate } from '../../types'
import { useToast } from '../../toast'

interface Props {
  open: boolean
  onClose: () => void
  templateName: string | null
  onSaved: () => void
}

export default function TemplateEditorDrawer({ open, onClose, templateName, onSaved }: Props) {
  const message = useToast()
  const [form] = Form.useForm()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  const [template, setTemplate] = useState<AgentTemplate | null>(null)

  useEffect(() => {
    if (open) {
      if (templateName) {
        void loadTemplate(templateName)
      } else {
        setTemplate(null)
        form.resetFields()
        form.setFieldsValue({ enabled: true })
      }
    }
  }, [open, templateName])

  async function loadTemplate(name: string) {
    try {
      setLoading(true)
      const t = await api.getAgentTemplate(name)
      setTemplate(t)
      form.setFieldsValue({
        ...t,
        tools: t.tools || [],
        rules: t.rules || [],
        skills: t.skills || [],
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载蓝图失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      setSaving(true)
      const values = await form.validateFields()
      
      const payload = {
        ...values,
        tools: values.tools || [],
        rules: values.rules || [],
        skills: values.skills || [],
      }

      if (templateName) {
        // updating using PATCH
        await api.updateAgentTemplate(templateName, payload)
        message.success('已保存蓝图')
      } else {
        await api.createAgentTemplate(payload)
        message.success('已创建蓝图')
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

  return (
    <Drawer
      title={templateName ? `编辑蓝图 - ${templateName}` : '新建资源蓝图'}
      width={1050}
      open={open}
      onClose={onClose}
      destroyOnClose
      styles={{ body: { background: 'var(--nb-body-bg)', padding: 'var(--nb-spacing-lg)' } }}
      extra={
        <Flex gap={8}>
          <Button onClick={onClose} style={{ borderRadius: 12 }}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleSave()} loading={saving} style={{ borderRadius: 12 }}>
            {templateName ? '保存' : '创建'}
          </Button>
        </Flex>
      }
    >
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" preserve={false}>
        <Row gutter={[24, 24]} style={{ alignItems: 'stretch' }}>
          <Col xs={24} lg={10} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <SectionCard title="基础设定">
              <Form.Item name="name" label="蓝图标识（唯一）" rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="例如：sales_assistant" disabled={!!templateName} style={{ borderRadius: 12, padding: '8px 12px' }} />
              </Form.Item>
              <Form.Item name="enabled" label="启用状态" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="禁用" />
              </Form.Item>
              <Form.Item name="description" label="详细描述">
                <Input.TextArea placeholder="用一句话描述这个蓝图的用途…" rows={3} style={{ borderRadius: 12 }} />
              </Form.Item>
              <Form.Item name="model" label="偏好模型" style={{ marginBottom: 0 }}>
                <Input placeholder="默认使用系统模型；如需固定某个模型可在此填写" style={{ borderRadius: 12, padding: '8px 12px' }} />
              </Form.Item>
            </SectionCard>

            <DevOnly>
              <SectionCard title="高级能力配置">
                <Form.Item name="tools" label="工具（可选）" tooltip="输入工具名称，回车添加">
                  <Select mode="tags" placeholder="添加工具" style={{ width: '100%' }} tokenSeparators={[',', ' ']} />
                </Form.Item>
                <Form.Item name="skills" label="技能（可选）" tooltip="输入技能 ID，回车添加">
                  <Select mode="tags" placeholder="添加技能" style={{ width: '100%' }} tokenSeparators={[',', ' ']} />
                </Form.Item>
                <Form.Item name="rules" label="规则（可选）" tooltip="输入规则名，回车添加" style={{ marginBottom: 0 }}>
                  <Select mode="tags" placeholder="添加规则" style={{ width: '100%' }} tokenSeparators={[',', ' ']} />
                </Form.Item>
              </SectionCard>
            </DevOnly>
          </Col>

          <Col xs={24} lg={14} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <SectionCard title="核心指令">
              <Form.Item name="systemPrompt" style={{ marginBottom: 0 }}>
                <div style={{ padding: '2px', borderRadius: 14, background: 'var(--nb-surface)' }}>
                  <Input.TextArea 
                    placeholder="描述该员工的角色、目标、边界与沟通风格…"
                    autoSize={{ minRows: 20, maxRows: 30 }}
                    style={{
                      borderRadius: 12, border: 'none', background: 'transparent',
                      fontFamily: 'var(--nb-font-mono)',
                      lineHeight: 1.6
                    }}
                  />
                </div>
              </Form.Item>
            </SectionCard>
          </Col>
        </Row>
      </Form>
      </Spin>
    </Drawer>
  )
}
