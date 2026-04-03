import { Avatar, Tag, theme } from 'antd'
import { channelCategoryLabels } from '../../configMeta'
import type { ChannelStateItem, ChannelProbeResult } from '../../types'

export const channelIcons: Record<string, string> = {
  telegram: '/channel-logos/telegram.png',
  whatsapp: '/channel-logos/whatsapp.jpeg',
  discord: '/channel-logos/discord.jpeg',
  qq: '/channel-logos/qq.png',
  slack: '/channel-logos/slack.png',
  matrix: '/channel-logos/matrix.png',
  feishu: '/channel-logos/feishu.png',
  dingtalk: '/channel-logos/dingtalk.jpeg',
  wecom: '/channel-logos/wecom.jpeg',
  mochat: '/channel-logos/mochat.jpeg',
  email: '/channel-logos/email.jpeg',
}

export function getChannelStatusColor(status: ChannelStateItem['status']): string {
  switch (status) {
    case 'enabled':
      return 'success'
    case 'configured':
      return 'processing'
    case 'incomplete':
      return 'warning'
    case 'unconfigured':
    default:
      return 'default'
  }
}

export function getProbeStatusColor(status: ChannelProbeResult['status']): string {
  switch (status) {
    case 'passed':
      return 'success'
    case 'warning':
      return 'warning'
    case 'failed':
      return 'error'
    case 'manual':
    default:
      return 'processing'
  }
}

export function getProbeCheckColor(status: 'pass' | 'warn' | 'fail'): string {
  switch (status) {
    case 'pass':
      return 'success'
    case 'warn':
      return 'warning'
    case 'fail':
      return 'error'
  }
}

export function getAuditStatusColor(status: string): string {
  switch (status) {
    case 'dispatched':
      return 'success'
    case 'dispatch_error':
      return 'error'
    case 'no_handler':
      return 'warning'
    case 'resolved':
      return 'processing'
    case 'unmatched':
    default:
      return 'default'
  }
}

export function getAuditStatusLabel(status: string): string {
  switch (status) {
    case 'dispatched':
      return '已派发'
    case 'dispatch_error':
      return '派发失败'
    case 'no_handler':
      return '无处理器'
    case 'resolved':
      return '已命中绑定'
    case 'unmatched':
      return '未命中'
    default:
      return status
  }
}

export function ChannelAvatar({ channelName, label }: { channelName: string; label: string }) {
  const { token } = theme.useToken()
  const src = channelIcons[channelName]

  return (
    <Avatar
      src={src || undefined}
      size={36}
      shape="square"
      style={{
        background: `${token.colorPrimary}16`,
        color: token.colorPrimary,
        flexShrink: 0,
      }}
    >
      {label.slice(0, 1)}
    </Avatar>
  )
}

export function ChannelStatusTag({ status, label }: { status: ChannelStateItem['status']; label?: string }) {
  return <Tag color={getChannelStatusColor(status)}>{label || status}</Tag>
}

export function ChannelCategoryTag({ category }: { category: keyof typeof channelCategoryLabels }) {
  return <Tag>{channelCategoryLabels[category]}</Tag>
}

export function parseListValue(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getFieldValue(root: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>((cursor, segment) => {
    if (cursor && typeof cursor === 'object') {
      return (cursor as Record<string, unknown>)[segment]
    }
    return undefined
  }, root)
}

export function updateNestedValue(
  root: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const next = structuredClone(root) as Record<string, unknown>
  let cursor: Record<string, unknown> = next

  path.slice(0, -1).forEach((segment) => {
    const existing = cursor[segment]
    if (!existing || typeof existing !== 'object') {
      cursor[segment] = {}
    }
    cursor = cursor[segment] as Record<string, unknown>
  })

  cursor[path[path.length - 1]] = value
  return next
}
