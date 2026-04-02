import type { ReactNode } from 'react'
import { Alert, Empty, Skeleton, Spin } from 'antd'
import { ApiError } from '../api'

/**
 * Extracts a user-friendly error message from an unknown error.
 * Unified helper used across all pages.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

interface AsyncContentProps {
  /** Whether the data is currently loading */
  loading?: boolean
  /** Error message to display (pass null/undefined for no error) */
  error?: string | null
  /** Whether the loaded data is "empty" (no items) */
  empty?: boolean
  /** Custom empty state description */
  emptyDescription?: string
  /** Custom empty state image */
  emptyImage?: ReactNode
  /** Whether to show skeleton loading (default) or spinner */
  skeleton?: boolean
  /** Number of skeleton rows when using skeleton mode */
  skeletonRows?: number
  /** Action to retry on error */
  onRetry?: () => void
  /** The content to render when data is available */
  children: ReactNode
}

/**
 * A standardized wrapper that handles async data states (loading, error, empty).
 *
 * Usage:
 * ```tsx
 * <AsyncContent loading={loading} error={error} empty={items.length === 0}>
 *   <MyDataDisplay items={items} />
 * </AsyncContent>
 * ```
 */
export default function AsyncContent({
  loading = false,
  error,
  empty = false,
  emptyDescription = '暂无数据',
  emptyImage,
  skeleton = true,
  skeletonRows = 3,
  onRetry,
  children,
}: AsyncContentProps) {
  // Error state takes priority
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message={error}
        action={onRetry ? (
          <a onClick={onRetry} style={{ whiteSpace: 'nowrap' }}>重试</a>
        ) : undefined}
        style={{ marginBottom: 16 }}
      />
    )
  }

  // Loading state
  if (loading) {
    if (skeleton) {
      return (
        <Skeleton
          active
          title={{ width: '40%' }}
          paragraph={{ rows: skeletonRows, width: Array.from({ length: skeletonRows }, (_, i) => `${100 - i * 15}%`) }}
        />
      )
    }
    return (
      <div className="center-box" style={{ padding: '48px 0' }}>
        <Spin />
      </div>
    )
  }

  // Empty state
  if (empty) {
    return (
      <Empty
        description={emptyDescription}
        image={emptyImage ?? Empty.PRESENTED_IMAGE_SIMPLE}
      />
    )
  }

  return <>{children}</>
}
