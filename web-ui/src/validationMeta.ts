export const readinessSummaryMeta = {
  ready: {
    label: '已就绪',
    description: '当前关键配置已经就绪，可以把注意力放回实际工作流。',
  },
  attention: {
    label: '需关注',
    description: '当前仍有警告项，建议在扩大使用范围前先完成修复。',
  },
  blocked: {
    label: '存在阻塞',
    description: '当前至少有一项关键配置未通过，先处理阻塞项再继续使用更稳妥。',
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
