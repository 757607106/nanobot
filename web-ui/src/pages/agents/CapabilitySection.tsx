import { Checkbox, Empty, Flex, Space, Tag, Typography, theme } from 'antd'
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
  const { token } = theme.useToken()
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
                  padding: token.marginLG,
                  borderRadius: token.borderRadiusLG,
                  border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
                  background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                  boxShadow: selected ? token.boxShadowSecondary : 'none',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
              >
                <Flex justify="space-between" align="flex-start" gap={token.marginSM}>
                  <Flex vertical gap={6} style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <Space wrap size={[8, 8]}>
                      <Typography.Text strong style={{ color: selected ? token.colorPrimaryText : 'inherit' }}>
                        {item.name}
                      </Typography.Text>
                      {item.isOrphan ? <Tag color="warning" style={{ borderRadius: token.borderRadiusLG, border: 'none' }}>遗留引用</Tag> : null}
                    </Space>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: 0, fontSize: token.fontSizeSM, lineHeight: 1.5, opacity: selected ? 0.8 : 1 }}
                      ellipsis={{ rows: 2 }}
                      title={item.description}
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
