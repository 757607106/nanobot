import { Checkbox, Empty, Flex, Space, Tag, Typography, theme } from 'antd'
import SectionCard from '../../components/console/SectionCard'
import type { CapabilityItem } from './types'

interface CapabilitySectionProps {
  title: string
  description: string
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
  const { token } = theme.useToken()

  return (
    <SectionCard title={title} description={description}>
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      ) : (
        <Flex vertical gap={3}>
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
                  border: `1px solid ${selected ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                  background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                  borderRadius: token.borderRadiusLG,
                  padding: 16,
                  cursor: 'pointer',
                }}
              >
                <Flex justify="space-between" align="flex-start" gap={4}>
                  <Flex vertical gap={2} style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <Space wrap size={[8, 8]}>
                      <Typography.Text strong>{item.name}</Typography.Text>
                      {item.isOrphan ? <Tag color="warning">遗留引用</Tag> : null}
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
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
        </Flex>
      )}
    </SectionCard>
  )
}
