import type { ReactNode } from 'react'
import { Flex, theme, Typography } from 'antd'
import type { ItemCardProps } from './types'

export default function ItemCard({
  title,
  tags,
  description,
  footer,
  onClick,
  selected = false,
}: ItemCardProps) {
  const { token } = theme.useToken()

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      } : undefined}
      style={{
        border: `1px solid ${selected ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        background: selected ? token.colorPrimaryBg : token.colorBgContainer,
        borderRadius: token.borderRadiusLG,
        padding: 16,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
      }}
    >
      <Flex vertical gap={12}>
        <div>
          <Typography.Text strong style={{ display: 'block' }}>
            {title}
          </Typography.Text>
          {tags ? <div style={{ marginTop: 10 }}>{tags}</div> : null}
        </div>

        {description ? (
          <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {description}
          </Typography.Paragraph>
        ) : null}

        {footer ? <div>{footer}</div> : null}
      </Flex>
    </div>
  )
}
