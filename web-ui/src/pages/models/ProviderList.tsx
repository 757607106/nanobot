import { Empty, Flex, Input, Space, Tag, Typography, theme } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import ProviderAvatar from './ProviderAvatar'
import type { ProviderCardItem } from './types'

interface ProviderListProps {
  providers: ProviderCardItem[]
  searchQuery: string
  onSearchChange: (value: string) => void
  activeProviderName: string | null
  onSelect: (name: string) => void
}

export default function ProviderList({
  providers,
  searchQuery,
  onSearchChange,
  activeProviderName,
  onSelect,
}: ProviderListProps) {
  const { token } = theme.useToken()

  return (
    <Flex vertical gap={16}>
      <Input
        placeholder="搜索供应商或网关"
        allowClear
        prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        size="large"
        style={{ borderRadius: 12, border: 'none', background: 'var(--nb-card-subtle-bg)' }}
      />

      {providers.length === 0 ? (
        <Empty image={false} className="minimal-empty" description="无匹配项" />
      ) : (
        <div className="resource-rail-list">
          {providers.map((item) => {
            const selected = item.name === activeProviderName

            return (
              <motion.button
                layout
                whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.04)' }}
                whileTap={{ scale: 0.98 }}
                key={item.name}
                type="button"
                onClick={() => onSelect(item.name)}
                className={`resource-rail-item ${selected ? 'is-selected' : ''}`}
                style={{
                  display: 'block',
                }}
              >
                <Flex align="center" gap={16} style={{ width: '100%' }}>
                  <ProviderAvatar providerName={item.name} label={item.label} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="resource-rail-item-head">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Typography.Text strong className="resource-rail-item-title">
                          {item.label}
                        </Typography.Text>
                        <Typography.Paragraph
                          className="resource-rail-item-subtitle"
                          ellipsis={{ rows: 1 }}
                          style={{ marginBottom: 0 }}
                        >
                          {item.categoryLabel}
                        </Typography.Paragraph>
                      </div>
                      <Space size={6} wrap>
                        {item.defaultProvider ? (
                          <Tag color="processing" bordered={false} style={{ margin: 0, borderRadius: 8, fontSize: 'var(--nb-text-2xs)' }}>
                            默认
                          </Tag>
                        ) : null}
                        <Tag
                          color={item.configured ? 'success' : 'warning'}
                          bordered={false}
                          style={{ margin: 0, borderRadius: 8, fontSize: 'var(--nb-text-2xs)' }}
                        >
                          {item.configured ? '已配置' : '待补齐'}
                        </Tag>
                      </Space>
                    </div>

                    <Typography.Paragraph
                      className="resource-rail-item-description"
                      ellipsis={{ rows: 2 }}
                    >
                      {item.description}
                    </Typography.Paragraph>

                    <Flex align="center" justify="space-between" gap={8} style={{ marginTop: 12 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-sm)' }}>
                        {item.bindingsCount} 个模型
                      </Typography.Text>
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: item.configured ? 'var(--nb-success)' : 'var(--nb-text-quaternary)',
                          flexShrink: 0,
                        }}
                      />
                    </Flex>
                  </div>
                </Flex>
              </motion.button>
            )
          })}
        </div>
      )}
    </Flex>
  )
}
