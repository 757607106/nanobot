import type {
  AgentDefinition,
  AgentDefinitionMutationInput,
  AgentMemorySnapshot,
  AgentRunSummary,
  AgentTemplateTool,
  ConfigData,
  ConfigMeta,
  InstalledSkill,
  KnowledgeBaseDefinition,
  MemoryCandidate,
  McpServerEntry,
} from '../../types'

export interface AgentFormState {
  name: string
  description: string
  systemPrompt: string
  rulesText: string
  model: string
  binding: string
  provider: string
  backend: string
  enabled: boolean
  toolAllowlist: string[]
  mcpServerIds: string[]
  skillIds: string[]
  knowledgeBindingIds: string[]
  tags: string[]
  memoryScope: string
  artifactArchiveAfterDays: string
  artifactDeleteAfterDays: string
}

export type AgentTab = 'basic' | 'capabilities' | 'memory' | 'test'

export interface CapabilityItem {
  key: string
  name: string
  description: string
  isOrphan?: boolean
}

export interface AgentsWorkspaceState {
  agents: AgentDefinition[]
  validTools: AgentTemplateTool[]
  skills: InstalledSkill[]
  mcpServers: McpServerEntry[]
  knowledgeBases: KnowledgeBaseDefinition[]
  currentAgent: AgentDefinition | null
  agentMemory: AgentMemorySnapshot | null
  agentMemoryCandidates: MemoryCandidate[]
  recentRuns: AgentRunSummary[]
  globalConfig: ConfigData | null
  globalConfigMeta: ConfigMeta | null
  loadingWorkspace: boolean
  loadingDetail: boolean
  loadingMemory: boolean
  loadingRuns: boolean
  error: string | null
  memoryError: string | null
  runError: string | null
}

export interface AgentsWorkspaceActions {
  loadWorkspace: () => Promise<void>
  loadAgentDetail: (agentId: string) => Promise<void>
  loadAgentMemoryGovernance: (agentId: string) => Promise<void>
  loadRecentRuns: (agentId: string) => Promise<void>
  handleSave: (form: AgentFormState, currentAgent: AgentDefinition | null) => Promise<void>
  handleDelete: (currentAgent: AgentDefinition) => Promise<void>
  handleCopy: (currentAgent: AgentDefinition) => Promise<void>
  handleTestRun: (currentAgent: AgentDefinition, testPrompt: string) => Promise<void>
  handleSaveAgentMemory: (currentAgent: AgentDefinition, content: string) => Promise<void>
  handleCreateAgentMemoryCandidate: (currentAgent: AgentDefinition, content: string) => Promise<void>
  handleApplyAgentMemoryCandidate: (currentAgent: AgentDefinition, candidateId: string) => Promise<void>
  handleRejectAgentMemoryCandidate: (currentAgent: AgentDefinition, candidateId: string) => Promise<void>
}
