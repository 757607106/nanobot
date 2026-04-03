import type { ReactNode } from 'react'
import type {
  AgentDefinition,
  AgentMemorySnapshot,
  AgentRunSummary,
  MemoryCandidate,
  MemorySearchHit,
  MemorySourceDetail,
} from '../../types'

export type AuditPanel = 'overview' | 'candidates' | 'search'

export interface AgentListProps {
  agents: AgentDefinition[]
  selectedAgentId: string | null
  agentSearch: string
  onAgentSearchChange: (value: string) => void
  onSelectAgent: (agentId: string) => void
}

export interface MemoryMetricsProps {
  agentCount: number
  pendingCount: number
  appliedCount: number
  recentRunsCount: number
  latestRunStatus: string | null
}

export interface CandidateListProps {
  candidates: MemoryCandidate[]
  statusFilter: string
  onStatusFilterChange: (value: string) => void
  onApplyCandidate: (candidateId: string) => void
  onRejectCandidate: (candidate: MemoryCandidate) => void
  onPreviewSource: (sourceType: string, sourceId: string) => void
}

export interface SearchPanelProps {
  query: string
  mode: string
  results: MemorySearchHit[]
  searching: boolean
  error: string | null
  currentAgent: AgentDefinition | null
  onQueryChange: (value: string) => void
  onModeChange: (value: string) => void
  onSearch: () => void
  onPreviewSource: (sourceType: string, sourceId: string) => void
}

export interface SourcePreviewProps {
  source: MemorySourceDetail | null
  fallbackContent?: string | null
  emptyText: string
}

export interface ItemCardProps {
  title: ReactNode
  tags?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  onClick?: () => void
  selected?: boolean
}

export const agentMemoryScopeLabels: Record<string, string> = {
  agent_profile: '员工自身',
  workspace_shared: '工作区共享',
}

export const candidateStatusOptions = [
  { label: '全部', value: 'all' },
  { label: '待审', value: 'proposed' },
  { label: '已应用', value: 'applied' },
  { label: '已忽略', value: 'rejected' },
]

export const memorySearchModeOptions = [
  { label: '标准', value: 'keyword' },
  { label: '平衡', value: 'hybrid' },
  { label: '深度', value: 'semantic' },
]

export function statusColor(status: string): 'default' | 'success' | 'error' | 'warning' | 'processing' {
  if (status === 'applied' || status === 'succeeded') {
    return 'success'
  }
  if (status === 'rejected' || status === 'cancelled') {
    return 'default'
  }
  if (status === 'failed' || status === 'timed_out') {
    return 'error'
  }
  if (status === 'proposed' || status === 'running' || status === 'queued') {
    return 'warning'
  }
  return 'processing'
}

export function scopeLabel(scope?: string | null): string {
  if (!scope) {
    return '未设置'
  }
  return agentMemoryScopeLabels[scope] || scope
}
