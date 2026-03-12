export interface SessionSummary {
  id: string
  sessionId: string
  title: string
  createdAt?: string
  updatedAt?: string
  messageCount: number
}

export interface SessionListResponse {
  items: SessionSummary[]
  page: number
  pageSize: number
  total: number
}

export interface ChatMessage {
  id: string
  sessionId: string
  sequence: number
  role: string
  content: string
  createdAt?: string
  toolCalls?: unknown[]
  toolCallId?: string
  name?: string
}

export interface ChatResponse {
  content: string
  assistantMessage: ChatMessage | null
}

export type StreamEvent =
  | { type: 'start'; sessionId: string }
  | { type: 'progress'; content: string; toolHint?: boolean }
  | { type: 'done'; content: string; assistantMessage: ChatMessage | null }
  | { type: 'error'; message: string }

export interface ProviderConfig {
  apiKey: string
  apiBase?: string | null
  extraHeaders?: Record<string, string> | null
}

export interface ConfigData {
  agents: {
    defaults: {
      workspace: string
      model: string
      provider: string
      maxTokens: number
      contextWindowTokens: number
      temperature: number
      maxToolIterations: number
      reasoningEffort?: string | null
    }
  }
  providers: Record<string, ProviderConfig>
  channels: Record<string, unknown>
  gateway: Record<string, unknown>
  tools: {
    restrictToWorkspace: boolean
    web?: {
      proxy?: string | null
      search?: {
        apiKey?: string
        maxResults?: number
      }
    }
    mcpServers?: Record<string, unknown>
  }
  [key: string]: unknown
}

export interface SystemStatus {
  web: {
    version: string
    uptime: number
    workspace: string
    configPath: string
    model: string
    provider: string
  }
  stats: {
    totalSessions: number
    webSessions: number
    messages: number
    enabledChannels: string[]
    enabledChannelCount: number
    scheduledJobs: number
  }
  environment: {
    python: string
    platform: string
  }
  cron: CronStatus
}

export interface CronTrigger {
  type: 'at' | 'every' | 'cron'
  dateMs?: number | null
  intervalSeconds?: number | null
  cronExpr?: string | null
  tz?: string | null
}

export interface CronPayload {
  kind: 'agent_turn' | 'calendar_reminder' | 'system_event'
  message: string
  deliver: boolean
  channel?: string | null
  to?: string | null
}

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  source?: string | null
  trigger: CronTrigger
  payload: CronPayload
  nextRunAtMs?: number | null
  lastRunAtMs?: number | null
  lastStatus?: 'ok' | 'error' | 'skipped' | null
  lastError?: string | null
  deleteAfterRun: boolean
  createdAtMs: number
  updatedAtMs: number
}

export interface CronJobListResponse {
  jobs: CronJob[]
}

export interface CronStatus {
  enabled: boolean
  jobs: number
  nextWakeAtMs?: number | null
  deliveryMode: 'agent_only'
}

export interface CronJobInput {
  name: string
  triggerType: 'at' | 'every' | 'cron'
  triggerDateMs?: number
  triggerIntervalSeconds?: number
  triggerCronExpr?: string
  triggerTz?: string
  payloadKind?: 'agent_turn'
  payloadMessage: string
  payloadDeliver?: boolean
  payloadChannel?: string
  payloadTo?: string
  deleteAfterRun?: boolean
  enabled?: boolean
}

export interface InstalledSkill {
  id: string
  name: string
  description: string
  source: string
  path: string
  version?: string
  author?: string | null
  tags?: string[]
  enabled?: boolean
  isDeletable?: boolean
}

export interface MainAgentPrompt {
  identity_content: string
  updated_at: string
  source_path?: string
}
