export function formatDateTimeZh(value?: string | number | Date | null) {
  if (!value) {
    return '--'
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function formatRelativeTimeZh(value?: string | number | Date | null) {
  if (!value) {
    return '刚刚'
  }
  const diffMs = Date.now() - new Date(value).getTime()
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))
  if (diffMinutes < 1) {
    return '刚刚'
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`
  }
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} 小时前`
  }
  return `${Math.floor(diffHours / 24)} 天前`
}

export function formatUptimeZh(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return '--'
  }
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remain = total % 60
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分 ${remain} 秒`
  }
  if (minutes > 0) {
    return `${minutes} 分 ${remain} 秒`
  }
  return `${remain} 秒`
}
