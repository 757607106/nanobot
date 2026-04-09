import { ApiError } from '../../api'
import { artifactRetentionPolicyToForm, buildArtifactRetentionPolicyInput } from '../../artifactRetention'
import type { AgentDefinition, AgentDefinitionMutationInput } from '../../types'
import type { AgentFormState } from './types'

export function createEmptyForm(): AgentFormState {
  return {
    name: '',
    description: '',
    systemPrompt: [
      '# Agent Profile',
      '',
      '你是一个面向明确任务的数字员工。',
      '优先利用已绑定的工具、MCP 和技能完成任务。',
      '给出清晰结果，必要时说明证据和边界。',
    ].join('\n'),
    rulesText: ['先确认任务边界', '优先使用已绑定能力', '输出结论时保持结构清晰'].join('\n'),
    model: '',
    binding: '',
    provider: '',
    backend: '',
    enabled: true,
    toolAllowlist: [],
    mcpServerIds: [],
    skillIds: [],
    knowledgeBindingIds: [],
    tags: [],
    memoryScope: 'agent_profile',
    artifactArchiveAfterDays: '',
    artifactDeleteAfterDays: '',
  }
}

export function agentToForm(agent: AgentDefinition): AgentFormState {
  const artifactRetention = artifactRetentionPolicyToForm(agent.artifactRetentionPolicy)
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    rulesText: '', // Kept for type compatibility if not removed from types.ts
    model: agent.model || '',
    binding: agent.binding || '',
    provider: agent.provider || '',
    backend: agent.backend || '',
    enabled: agent.enabled,
    toolAllowlist: [...agent.toolAllowlist],
    mcpServerIds: [...agent.mcpServerIds],
    skillIds: [...agent.skillIds],
    knowledgeBindingIds: [...agent.knowledgeBindingIds],
    tags: [...agent.tags],
    memoryScope: agent.memoryScope || 'agent_profile',
    artifactArchiveAfterDays: artifactRetention.archiveAfterDays,
    artifactDeleteAfterDays: artifactRetention.deleteAfterDays,
  }
}

export function parseRules(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

export function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

export function toPayload(
  form: AgentFormState,
  availableBindings: Record<string, { provider: string; model?: string | null }>,
): AgentDefinitionMutationInput {
  const bindingConfig = form.binding ? availableBindings[form.binding] : undefined
  const binding = form.binding.trim() || null
  const provider = binding
    ? bindingConfig?.provider || null
    : form.provider.trim() || null
  const model = binding
    ? form.model.trim() || bindingConfig?.model || null
    : form.model.trim() || null

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    systemPrompt: form.systemPrompt.trim(),
    rules: [], // Deprecated in UI, merged into systemPrompt directly
    model,
    binding,
    provider,
    backend: form.backend.trim() || null,
    enabled: form.enabled,
    toolAllowlist: [...form.toolAllowlist],
    mcpServerIds: [...form.mcpServerIds],
    skillIds: [...form.skillIds],
    knowledgeBindingIds: [...form.knowledgeBindingIds],
    tags: [...form.tags],
    memoryScope: form.memoryScope,
    artifactRetentionPolicy: buildArtifactRetentionPolicyInput(
      form.artifactArchiveAfterDays,
      form.artifactDeleteAfterDays,
    ),
  }
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export function statusColor(status: 'succeeded' | 'failed' | 'running' | 'cancel_requested' | 'cancelled'): 'default' | 'processing' | 'success' | 'error' | 'warning' {
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

export const memoryScopeOptions = [
  { value: 'agent_profile', label: '仅员工自身' },
  { value: 'workspace_shared', label: '工作区共享' },
]

export function memoryScopeLabel(scope: string): string {
  return memoryScopeOptions.find((item) => item.value === scope)?.label || scope
}
