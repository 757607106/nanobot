import type { AgentRunSummary, AgentRunTreeNode, RunArtifactDetail, RunBoundaryAudit } from '../../types'

export function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export function statusColor(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
      return 'processing'
    case 'cancel_requested':
      return 'warning'
    case 'cancelled':
      return 'default'
    default:
      return 'default'
  }
}

export function statusBadgeStatus(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
      return 'processing'
    case 'cancel_requested':
      return 'warning'
    case 'cancelled':
      return 'default'
    default:
      return 'default'
  }
}

export function statusLabel(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return '成功'
    case 'failed':
      return '失败'
    case 'running':
      return '运行中'
    case 'queued':
      return '排队中'
    case 'cancel_requested':
      return '取消中'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

export function isActiveStatus(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

export function isCancelable(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running'
}

export function eventLabel(eventType: string, devMode = false) {
  switch (eventType) {
    case 'queued':
      return '已排队'
    case 'started':
      return '开始执行'
    case 'completed':
      return '执行完成'
    case 'failed':
      return '执行失败'
    case 'cancel_requested':
      return '已请求取消'
    case 'cancelled':
      return '已取消'
    case 'bindings_resolved':
      return devMode ? '能力已加载' : '准备就绪'
    case 'knowledge_retrieved':
      return devMode ? '已检索知识' : '准备就绪'
    case 'retry_requested':
      return '已发起重跑'
    case 'memory_candidate_proposed':
      return '已生成记忆候选'
    case 'execution_context_materialized':
      return devMode ? '执行上下文已就绪' : '执行边界已确认'
    case 'channel_dispatch_resolved':
      return devMode ? '渠道路由已确认' : '渠道入口已确认'
    case 'artifact_written':
      return devMode ? '运行产物已写入' : '产物已归档'
    case 'artifact_quarantined':
      return devMode ? '运行产物已隔离' : '产物已隔离'
    case 'artifact_archived':
      return devMode ? '运行产物已归档' : '产物已归档'
    case 'artifact_restored':
      return devMode ? '运行产物已恢复' : '产物已恢复'
    case 'artifact_deleted':
      return devMode ? '运行产物已删除' : '产物已删除'
    case 'artifact_retention_policy_set':
      return devMode ? '产物保留策略已更新' : '产物保留策略已更新'
    default:
      return eventType
  }
}

export function eventPayloadSummary(eventType: string, payload?: Record<string, unknown>, devMode = false) {
  if (!payload) {
    return null
  }
  switch (eventType) {
    case 'progress':
      return String(payload.content || '')
    case 'bindings_resolved': {
      if (!devMode) {
        const total =
          (Array.isArray(payload.toolAllowlist) ? payload.toolAllowlist.length : 0) +
          (Array.isArray(payload.mcpServerIds) ? payload.mcpServerIds.length : 0) +
          (Array.isArray(payload.skillIds) ? payload.skillIds.length : 0) +
          (Array.isArray(payload.knowledgeBindingIds) ? payload.knowledgeBindingIds.length : 0)
        return `已加载 ${total} 项能力`
      }
      return [
        `工具 ${Array.isArray(payload.toolAllowlist) ? payload.toolAllowlist.length : 0}`,
        `MCP ${Array.isArray(payload.mcpServerIds) ? payload.mcpServerIds.length : 0}`,
        `技能 ${Array.isArray(payload.skillIds) ? payload.skillIds.length : 0}`,
        `知识库 ${Array.isArray(payload.knowledgeBindingIds) ? payload.knowledgeBindingIds.length : 0}`,
      ].join(' · ')
    }
    case 'knowledge_retrieved':
      return `模式：${payload.effectiveMode || payload.requestedMode || 'keyword'} · 命中：${payload.hitCount || 0}`
    case 'retry_requested':
      return [
        `来源：${payload.sourceRunId || '—'}`,
        payload.appendContextProvided ? '追加上下文' : '直接重试',
      ].join(' · ')
    case 'memory_candidate_proposed':
      return [payload.candidateId, payload.agentId, payload.runId].filter(Boolean).join(' · ')
    case 'execution_context_materialized':
      return [
        `主体：${payload.principalKind || payload.principal_kind || 'agent'}`,
        `空间：${payload.workspaceScope || 'shared'}`,
        `沙箱：${payload.sandboxKind || 'local'}`,
      ].join(' · ')
    case 'channel_dispatch_resolved':
      return [
        `渠道：${payload.channelName || '—'}`,
        `会话：${payload.chatId || '—'}`,
        `目标：${payload.targetId || '—'}`,
        `租户：${payload.tenantId || 'default'}`,
      ].join(' · ')
    case 'artifact_written':
      return [
        `范围：${payload.storageScope || 'scoped'}`,
        `文件：${String(payload.fileName || payload.artifactPath || '')}`,
      ].filter(Boolean).join(' · ')
    case 'artifact_quarantined':
    case 'artifact_archived':
    case 'artifact_restored':
    case 'artifact_deleted':
      return [
        String(payload.lifecycleStatus || ''),
        String(payload.currentStorageScope || ''),
        String(payload.reason || ''),
      ].filter(Boolean).join(' · ')
    case 'artifact_retention_policy_set':
      return [
        payload.archiveAfterDays != null ? `归档：${payload.archiveAfterDays} 天` : '归档：关闭',
        payload.deleteAfterDays != null ? `清理：${payload.deleteAfterDays} 天` : '清理：关闭',
        String(payload.reason || ''),
      ].filter(Boolean).join(' · ')
    default:
      return JSON.stringify(payload, null, 2)
  }
}

export function artifactLifecycleColor(status: string | undefined) {
  switch (status) {
    case 'active':
      return 'green'
    case 'archived':
      return 'blue'
    case 'quarantined':
      return 'orange'
    case 'deleted':
      return 'red'
    case 'missing':
      return 'default'
    default:
      return 'default'
  }
}

export function artifactLifecycleLabel(status: string | undefined) {
  switch (status) {
    case 'active':
      return '可用'
    case 'archived':
      return '已归档'
    case 'quarantined':
      return '已隔离'
    case 'deleted':
      return '已删除'
    case 'missing':
      return '缺失'
    default:
      return status || '未知'
  }
}

export function artifactRetentionSummary(audit: RunBoundaryAudit['artifact'] | RunArtifactDetail['audit'] | null | undefined) {
  const policy = audit?.retentionPolicy || null
  if (!policy?.enabled) {
    return '未设置'
  }
  return [
    policy.archiveAfterDays != null ? `${policy.archiveAfterDays} 天后归档` : null,
    policy.deleteAfterDays != null ? `${policy.deleteAfterDays} 天后删除` : null,
  ].filter(Boolean).join(' · ')
}

export function controlScopeTag(scope: string) {
  switch (scope) {
    case 'child':
      return '子任务'
    default:
      return null
  }
}
