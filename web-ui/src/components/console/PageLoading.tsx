import type { ReactNode } from 'react'
import { Alert, Empty, Flex, Spin, theme } from 'antd'

interface PageLoadingProps {
  /** Show loading spinner */
  loading?: boolean
  /** Error message to display */
  error?: string | null
  /** Custom empty state message */
  emptyText?: string
  /** Whether data is available (to distinguish loading from empty) */
  hasData?: boolean
  /** Minimum height for the container */
  minHeight?: number
  /** Content to render when data is loaded successfully */
  children: ReactNode
}

/**
 * Unified page-level loading / error / empty state wrapper.
 * Replaces the repeated pattern across pages of:
 *   if (loading) return <Spin />
 *   if (error) return <Alert />
 *   if (!data) return <Empty />
 */
export default function PageLoading({
  loading,
  error,
  emptyText = '暂无数据',
  hasData = true,
  minHeight = 220,
  children,
}: PageLoadingProps) {
  const { token } = theme.useToken()

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight, padding: 32 }}>
        <Spin size="large" />
      </Flex>
    )
  }

  if (error) {
    return (
      <Alert
        type="error"
        message="加载失败"
        description={error}
        showIcon
        style={{ margin: `${token.padding}px 0` }}
      />
    )
  }

  if (!hasData) {
    return (
      <Flex justify="center" align="center" style={{ minHeight, padding: 32 }}>
        <Empty description={emptyText} />
      </Flex>
    )
  }

  return <>{children}</>
}
