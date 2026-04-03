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
        placeholder="搜索供应商"
        allowClear
        prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        size="large"
        style={{ borderRadius: 12, border: 'none', background: 'var(--nb-card-subtle-bg)' }}
      />

      {providers.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的供应商" />
      ) : (
        <Flex vertical gap={10}>
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
                className="flex w-full text-left"
                style={{
                  padding: '16px',
                  border: `1px solid ${selected ? 'var(--nb-accent)' : 'transparent'}`,
                  borderRadius: 16,
                  background: selected ? 'var(--nb-card-selected-bg)' : 'var(--nb-card-subtle-bg)',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: selected ? '0 4px 12px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                <Flex align="center" gap={16} style={{ width: '100%' }}>
                  <ProviderAvatar providerName={item.name} label={item.label} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Flex justify="space-between" align="center" gap={8}>
                      <Typography.Text strong style={{ fontSize: 16 }}>{item.label}</Typography.Text>
                      {item.defaultProvider && (
                        <Tag color="processing" bordered={false} style={{ margin: 0, borderRadius: 8, fontSize: 11 }}>
                          DEFAULT
                        </Tag>
                      )}
                    </Flex>
                    <Flex align="center" gap={8} style={{ marginTop: 4 }}>
                      {item.configured ? (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--nb-success)' }} />
                      ) : (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--nb-text-quaternary)' }} />
                      )}
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        {item.bindingsCount} 个模型配置
                      </Typography.Text>
                    </Flex>
                  </div>
                </Flex>
              </motion.button>
            )
          })}
        </Flex>
      )}
    </Flex>
  )
}
