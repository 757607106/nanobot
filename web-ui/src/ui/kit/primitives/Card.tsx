import type { CardProps as AntdCardProps } from 'antd'
import { Card as AntdCard } from 'antd'

export type CardProps = AntdCardProps

export function Card(props: CardProps) {
  return <AntdCard {...props} />
}

