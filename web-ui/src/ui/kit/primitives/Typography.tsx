import type { ComponentProps } from 'react'
import { Typography as AntdTypography } from 'antd'

export type TextProps = ComponentProps<typeof AntdTypography.Text>
export type TitleProps = ComponentProps<typeof AntdTypography.Title>

export const Text = AntdTypography.Text
export const Title = AntdTypography.Title
