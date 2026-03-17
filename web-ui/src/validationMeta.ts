export const readinessSummaryMeta = {
  ready: {
    label: '已就绪',
    description: '关键配置已就绪。',
  },
  attention: {
    label: '需关注',
    description: '仍有提醒项，建议继续处理。',
  },
  blocked: {
    label: '存在阻塞',
    description: '存在阻塞项，先处理后再继续。',
  },
} as const

export const validationStatusMeta = {
  pass: { label: '通过', alert: 'success' as const },
  warn: { label: '提醒', alert: 'warning' as const },
  fail: { label: '阻塞', alert: 'error' as const },
} as const

export function getReadinessAlertType(status: 'ready' | 'attention' | 'blocked') {
  if (status === 'blocked') {
    return 'error' as const
  }
  if (status === 'attention') {
    return 'warning' as const
  }
  return 'success' as const
}
