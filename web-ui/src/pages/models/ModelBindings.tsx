import { Button, Empty, Flex, Space, Tag, Typography, theme } from 'antd'
import { DeleteOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import SectionCard from '../../components/console/SectionCard'
import { capabilityLabel } from './utils'
import type { BindingRow, CapabilityType } from './types'

function capabilityColor(type: CapabilityType) {
  if (type === 'embedding') return 'gold'
  if (type === 'multimodal') return 'purple'
  return 'blue'
}

interface ModelBindingsProps {
  bindings: BindingRow[]
  defaultBindingName: string | null
  onTest: (model: string) => void
  onSetDefault: (bindingName: string) => void
  onDelete: (bindingName: string) => void
  onAddModel: () => void
}

export default function ModelBindings({
  bindings,
  defaultBindingName,
  onTest,
  onSetDefault,
  onDelete,
  onAddModel,
}: ModelBindingsProps) {
  const { token } = theme.useToken()

  return (
    <SectionCard
      title="模型绑定"
      action={
        <Button type="primary" icon={<PlusOutlined />} onClick={onAddModel} style={{ borderRadius: 12 }}>
          添加模型
        </Button>
      }
    >
      {bindings.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无模型绑定" />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {bindings.map((binding, index) => {
            const isDefault = binding.bindingName === defaultBindingName

            return (
              <motion.div
                key={binding.bindingName}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '20px',
                  borderRadius: 20,
                  background: isDefault ? 'var(--nb-card-selected-bg)' : 'var(--nb-card-subtle-bg)',
                  border: isDefault ? '1px solid var(--nb-accent)' : '1px solid var(--nb-card-subtle-border)',
                  boxShadow: isDefault ? '0 8px 24px rgba(99, 102, 241, 0.06)' : 'none',
                  minHeight: 160,
                  transition: 'all 0.3s ease',
                }}
                whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.08)' }}
              >
                <Flex justify="space-between" align="flex-start" gap={12}>
                  <Flex vertical gap={6} style={{ minWidth: 0, flex: 1 }}>
                    <Typography.Text strong style={{ fontSize: 17, letterSpacing: '-0.01em' }}>
                      {binding.label || binding.bindingName}
                    </Typography.Text>
                    <Typography.Text type="secondary" ellipsis style={{ fontSize: 13, opacity: 0.8 }}>
                      ID: {binding.model || '--'}
                    </Typography.Text>
                  </Flex>
                  {isDefault && (
                    <Tag color="success" bordered={false} style={{ margin: 0, borderRadius: 8, fontSize: 11, fontWeight: 600 }}>
                      DEFAULT
                    </Tag>
                  )}
                </Flex>

                <div style={{ flex: 1, marginTop: 12 }}>
                  <Tag 
                    color={capabilityColor(binding.capabilityType as CapabilityType)} 
                    bordered={false}
                    style={{ borderRadius: 6, fontSize: 11, padding: '0 8px' }}
                  >
                    {capabilityLabel(binding.capabilityType as CapabilityType).toUpperCase()}
                  </Tag>
                </div>

                <Flex justify="space-between" align="center" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--nb-card-subtle-border)' }}>
                  <Space size={4}>
                    <Button type="text" size="small" onClick={() => onTest(binding.model || '')} style={{ opacity: 0.7 }}>
                      测试连接
                    </Button>
                  </Space>
                  
                  <Space size={8}>
                    {!isDefault && binding.capabilityType !== 'embedding' ? (
                      <Button 
                        size="small" 
                        style={{ borderRadius: 8, fontSize: 12 }} 
                        onClick={() => onSetDefault(binding.bindingName)}
                      >
                        设为默认
                      </Button>
                    ) : null}
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => onDelete(binding.bindingName)}
                      aria-label={`删除 ${binding.label || binding.bindingName}`}
                      style={{ opacity: 0.6 }}
                    />
                  </Space>
                </Flex>
              </motion.div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}
