import type { ReactNode } from 'react'
import { Alert, Empty, Flex, Spin } from 'antd'

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
  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight, padding: 'var(--nb-spacing-2xl)' }}>
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
        style={{ margin: 'var(--nb-spacing-md) 0' }}
      />
    )
  }

  if (!hasData) {
    return (
      <Flex justify="center" align="center" style={{ minHeight, padding: 'var(--nb-spacing-2xl)' }}>
        <Empty description={emptyText} />
      </Flex>
    )
  }

  return <>{children}</>
}
