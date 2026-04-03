import { Flex, Tabs, Typography, theme } from 'antd'
import type { TabsProps } from 'antd'

export interface SectionTabItem {
  key: string
  label: string
}

interface SectionTabsProps {
  eyebrow?: string
  title?: string
  description?: string
  activeKey: string
  items: SectionTabItem[]
  onChange: (key: string) => void
}

export default function SectionTabs({
  eyebrow,
  title,
  description,
  activeKey,
  items,
  onChange,
}: SectionTabsProps) {
  const { token } = theme.useToken()
  const hasCopy = Boolean(eyebrow || title || description)

  const tabItems: TabsProps['items'] = items.map((item) => ({
    key: item.key,
    label: item.label,
    children: null,
  }))

  return (
    <Flex vertical gap={hasCopy ? 10 : 0} className="section-tabs-shell" style={{ paddingInline: 2 }}>
      {hasCopy ? (
        <div className="section-tabs-copy" style={{ minWidth: 0 }}>
          {eyebrow ? (
            <Typography.Text
              className="section-tabs-eyebrow"
              style={{
                color: token.colorPrimary,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              {eyebrow}
            </Typography.Text>
          ) : null}

          {title ? (
            <Typography.Title
              level={4}
              className="section-tabs-title"
              style={{
                margin: eyebrow ? '4px 0 0' : 0,
                fontSize: '1rem',
                lineHeight: 1.15,
              }}
            >
              {title}
            </Typography.Title>
          ) : null}

          {description ? (
            <Typography.Paragraph
              className="section-tabs-description"
              type="secondary"
              style={{
                margin: title || eyebrow ? '6px 0 0' : 0,
                maxWidth: 560,
                lineHeight: 1.5,
              }}
            >
              {description}
            </Typography.Paragraph>
          ) : null}
        </div>
      ) : null}

      <div
        className="section-tabs-bar"
        style={{
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Tabs
          className="section-tabs-control"
          activeKey={activeKey}
          onChange={onChange}
          items={tabItems}
          size="middle"
          animated={{ inkBar: true, tabPane: false }}
          tabBarGutter={18}
          style={{ marginBottom: 0 }}
          tabBarStyle={{ margin: 0 }}
        />
      </div>
    </Flex>
  )
}
