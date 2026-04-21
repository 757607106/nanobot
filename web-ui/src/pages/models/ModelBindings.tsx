import { Button, Empty, Flex, Segmented, Space, Tag, Tooltip, Typography, theme } from 'antd'
import { DeleteOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import SectionCard from '../../components/console/SectionCard'
import { capabilityLabel } from './utils'
import type { BindingRow, CapabilityType } from './types'
import { CAPABILITY_OPTIONS, capabilityColor } from './capabilities'

interface ModelBindingsProps {
  bindings: BindingRow[]
  defaultBindingName: string | null
  onTest: (model: string) => void
  onSetDefault: (bindingName: string) => void
  onDelete: (bindingName: string) => void
  onAddModel: () => void
  onCapabilityChange?: (bindingName: string, capabilityType: CapabilityType) => void
}

export default function ModelBindings({
  bindings,
  defaultBindingName,
  onTest,
  onSetDefault,
  onDelete,
  onAddModel,
  onCapabilityChange,
}: ModelBindingsProps) {
  const { token } = theme.useToken()
  return (
    <SectionCard
      title="模型绑定"
      description=""
      action={
        <Button type="primary" icon={<PlusOutlined />} onClick={onAddModel} style={{ borderRadius: 12 }}>
          添加模型
        </Button>
      }
    >
      {bindings.length === 0 ? (
        <Empty image={false} className="minimal-empty" description="暂无模型绑定" />
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
            const hasModel = Boolean(binding.model?.trim())

            return (
              <motion.div
                key={binding.bindingName}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: `${token.paddingLG}px`,
                  borderRadius: token.borderRadiusLG,
                  background: isDefault ? token.colorPrimaryBg : token.colorBgContainer,
                  border: isDefault ? `1px solid ${token.colorPrimary}` : `1px solid ${token.colorBorderSecondary}`,
                  boxShadow: isDefault ? '0 8px 24px rgba(99, 102, 241, 0.06)' : 'none',
                  minHeight: 160,
                  transition: 'all 0.3s ease',
                }}
                whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.08)' }}
              >
                {/* 头部：模型 ID 为标题 */}
                <Flex justify="space-between" align="flex-start" gap={12}>
                  <Flex vertical gap={4} style={{ minWidth: 0, flex: 1 }}>
                    <Flex align="center" gap={6}>
                      {!hasModel && (
                        <Tooltip title="模型 ID 未配置，无法使用">
                          <WarningOutlined style={{ color: token.colorWarning, fontSize: token.fontSizeSM }} />
                        </Tooltip>
                      )}
                      <Typography.Text
                        strong
                        ellipsis={{ tooltip: binding.model || '未配置模型 ID' }}
                        style={{
                          fontSize: token.fontSizeLG,
                          letterSpacing: '-0.01em',
                          fontFamily: hasModel ? token.fontFamilyCode : undefined,
                          color: hasModel ? undefined : token.colorTextQuaternary,
                        }}
                      >
                        {binding.model || '未配置模型 ID'}
                      </Typography.Text>
                    </Flex>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, opacity: 0.8 }}>
                      {binding.label || binding.bindingName}
                    </Typography.Text>
                  </Flex>
                  {isDefault && (
                    <Tag color="success" bordered={false} style={{ margin: 0, borderRadius: token.borderRadiusSM, fontSize: token.fontSizeSM, fontWeight: token.fontWeightStrong }}>
                      DEFAULT
                    </Tag>
                  )}
                </Flex>

                {/* 能力类型：可切换 */}
                <div style={{ marginTop: 14 }}>
                  {onCapabilityChange ? (
                    <Segmented
                      size="small"
                      block
                      value={binding.capabilityType as CapabilityType}
                      onChange={(value) => onCapabilityChange(binding.bindingName, value as CapabilityType)}
                      options={CAPABILITY_OPTIONS}
                    />
                  ) : (
                    <Tag
                      color={capabilityColor(binding.capabilityType as CapabilityType)}
                      bordered={false}
                      style={{ borderRadius: token.borderRadiusSM, fontSize: token.fontSizeSM, padding: `0 ${token.paddingXS}px` }}
                    >
                      {capabilityLabel(binding.capabilityType as CapabilityType).toUpperCase()}
                    </Tag>
                  )}
                </div>

                {/* 底部操作 */}
                <Flex justify="space-between" align="center" style={{ marginTop: 'auto', paddingTop: token.padding }}>
                  <Space size={4}>
                    <Button type="text" size="small" onClick={() => onTest(binding.model || '')} style={{ opacity: 0.7 }}>
                      测试连接
                    </Button>
                  </Space>
                  
                  <Space size={8}>
                    {!isDefault && binding.capabilityType !== 'embedding' ? (
                      <Button 
                        size="small" 
                        style={{ borderRadius: token.borderRadiusLG, fontSize: token.fontSizeSM }} 
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
