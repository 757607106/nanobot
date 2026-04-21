import type { ReactNode } from 'react'
import { Avatar, theme } from 'antd'
import { resolveToneBg, resolveToneColor, type SemanticTone } from '../../ui/kit/tone'

interface EntityAvatarProps {
  size?: number
  icon?: ReactNode
  text?: string
  tone?: SemanticTone
}

export default function EntityAvatar({ size = 44, icon, text, tone = 'primary' }: EntityAvatarProps) {
  const { token } = theme.useToken()
  const bg = resolveToneBg(token as any, tone)
  const fg = resolveToneColor(token as any, tone)
  const label = text ? text.slice(0, 1).toUpperCase() : undefined

  return (
    <Avatar
      size={size}
      shape="square"
      icon={icon}
      style={{
        backgroundColor: bg,
        color: fg,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {icon ? null : label}
    </Avatar>
  )
}

