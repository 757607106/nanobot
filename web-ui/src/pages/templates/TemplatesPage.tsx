import { useEffect, useState } from 'react'
import { Button, Card, Flex, Popconfirm, Tag, Typography } from 'antd'
import { PlusOutlined, ReloadOutlined, DeleteOutlined, ExportOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { api } from '../../api'
import PageHeader from '../../components/console/PageHeader'
import SectionCard from '../../components/console/SectionCard'
import type { AgentTemplate } from '../../types'
import { useToast } from '../../toast'
import TemplateEditorDrawer from './TemplateEditorDrawer'

export default function TemplatesPage() {
  const message = useToast()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AgentTemplate[]>([])
  
  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null)

  useEffect(() => {
    void loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const result = await api.getAgentTemplates()
      setData(result)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function deleteTemplate(name: string) {
    try {
      await api.deleteAgentTemplate(name)
      message.success('已删除模板')
      void loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function exportAll() {
    try {
      const res = await api.exportAgentTemplates()
      const blob = new Blob([res.content], { type: 'application/x-yaml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent_templates_${new Date().toISOString().slice(0, 10)}.yaml`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      message.error('导出失败')
    }
  }

  const hasChinese = (value: string) => /[\u4e00-\u9fa5]/.test(value)

  function openDrawer(name: string | null) {
    setSelectedTemplateName(name)
    setDrawerOpen(true)
  }

  return (
    <Flex vertical gap={18}>
      <PageHeader
        title="员工资源蓝图"
        actions={
          <Flex gap={8}>
            <Button icon={<ReloadOutlined />} onClick={() => void loadData()} loading={loading}>刷新</Button>
            <Button icon={<ExportOutlined />} onClick={() => void exportAll()}>导出</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer(null)}>新建蓝图</Button>
          </Flex>
        }
      />

      <SectionCard title="所有蓝图">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--nb-spacing-md)' }}>
          {data.map((tpl, i) => (
            <motion.div
              key={tpl.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card 
                hoverable 
                onClick={() => openDrawer(tpl.name)}
                style={{ height: '100%' }}
                styles={{ body: { padding: 'var(--nb-spacing-md)' } }}
              >
                <Flex vertical justify="space-between" style={{ height: '100%' }} gap={12}>
                  <div>
                    <Flex justify="space-between" align="flex-start" style={{ marginBottom: 8 }}>
                      <Typography.Text strong style={{ fontSize: 'var(--nb-text-md)' }}>{tpl.name}</Typography.Text>
                      <Tag color={tpl.enabled ? 'success' : 'default'} bordered={false} style={{ margin: 0 }}>
                        {tpl.enabled ? '已启用' : '禁用'}
                      </Tag>
                    </Flex>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0, minHeight: 44 }}>
                      {tpl.description && hasChinese(tpl.description) ? tpl.description : '可在编辑中补充说明。'}
                    </Typography.Paragraph>
                  </div>
                  
                  <Flex justify="space-between" align="center" onClick={(e) => e.stopPropagation()}>
                    <Flex gap={4}>
                      {(() => {
                        const total = (tpl.tools?.length || 0) + (tpl.skills?.length || 0)
                        return total > 0 ? <Tag bordered={false}>能力 {total}</Tag> : null
                      })()}
                    </Flex>
                    <Popconfirm title="确认删除？" onConfirm={() => void deleteTemplate(tpl.name)}>
                      <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                    </Popconfirm>
                  </Flex>
                </Flex>
              </Card>
            </motion.div>
          ))}
        </div>
      </SectionCard>

      <TemplateEditorDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        templateName={selectedTemplateName}
        onSaved={() => void loadData()}
      />
    </Flex>
  )
}
