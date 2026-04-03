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
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      ) : (
        <div className="resource-rail-grid">
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
                className={`resource-rail-item ${selected ? 'is-selected' : ''}`}
              >
                <Flex justify="space-between" align="flex-start" gap={8}>
                  <Flex vertical gap={6} style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <Space wrap size={[8, 8]}>
                      <Typography.Text strong className="resource-rail-item-title">{item.name}</Typography.Text>
                      {item.isOrphan ? <Tag color="warning">遗留引用</Tag> : null}
                      {selected ? <Tag color="processing">已挂载</Tag> : null}
                    </Space>
                    <Typography.Paragraph
                      type="secondary"
                      className="resource-rail-item-description"
                      ellipsis={{ rows: 2, tooltip: item.description }}
                    >
                      {item.description}
                    </Typography.Paragraph>
                  </Flex>

                  <div onClick={(event) => event.stopPropagation()}>
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
