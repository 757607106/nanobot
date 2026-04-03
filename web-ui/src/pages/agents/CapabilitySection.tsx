import { Checkbox, Empty, Flex, Space, Tag, Typography } from 'antd'
import SectionCard from '../../components/console/SectionCard'
import type { CapabilityItem } from './types'

interface CapabilitySectionProps {
  title: string
  description?: string
  emptyText: string
  items: CapabilityItem[]
  selectedKeys: string[]
  onToggle: (key: string) => void
}

export default function CapabilitySection({
  title,
  description,
  emptyText,
  items,
  selectedKeys,
  onToggle,
}: CapabilitySectionProps) {
  return (
    <SectionCard title={title} description={description}>
      {items.length === 0 ? (
        <Empty image={false} className="minimal-empty" description={emptyText} />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16
        }}>
          {items.map((item) => {
            const selected = selectedKeys.includes(item.key)

            return (
              <div
                key={item.key}
                role="button"
                tabIndex={0}
                onClick={() => onToggle(item.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onToggle(item.key)
                  }
                }}
                style={{
                  cursor: 'pointer',
                  padding: 20,
                  borderRadius: 16,
                  border: `1px solid ${selected ? 'var(--nb-token-color-primary)' : 'var(--nb-card-border)'}`,
                  background: selected ? 'var(--nb-token-color-primary-bg)' : 'var(--nb-surface)',
                  boxShadow: selected ? 'var(--nb-shadow-soft)' : 'none',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
              >
                <Flex justify="space-between" align="flex-start" gap={12}>
                  <Flex vertical gap={6} style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <Space wrap size={[8, 8]}>
                      <Typography.Text strong style={{ fontSize: 15, color: selected ? 'var(--nb-token-color-primary-text)' : 'inherit' }}>
                        {item.name}
                      </Typography.Text>
                      {item.isOrphan ? <Tag color="warning" style={{ borderRadius: 12, border: 'none' }}>遗留引用</Tag> : null}
                    </Space>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: selected ? 0.8 : 1 }}
                      ellipsis={{ rows: 2, tooltip: item.description }}
                    >
                      {item.description}
                    </Typography.Paragraph>
                  </Flex>

                  <div onClick={(event) => event.stopPropagation()} style={{ flexShrink: 0 }}>
                    <Checkbox checked={selected} onChange={() => onToggle(item.key)} />
                  </div>
                </Flex>
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}
