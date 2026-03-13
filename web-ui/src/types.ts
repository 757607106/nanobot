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

export interface ChatToolCall {
  id?: string
  type?: string
  name?: string
  function?: {
    name?: string
    arguments?: string
  }
}

export interface ChatAttachmentRef {
  name: string
  relativePath: string
  path?: string
  sizeBytes?: number
  uploadedAt?: string
}

export interface ChatProgressStep {
  key: string
  label: string
  kind: 'progress' | 'tool'
  createdAt?: string
}

export interface ChatMessage {
  id?: string
  sessionId?: string
  sequence?: number
  role: string
  content: string
  createdAt?: string
  toolCalls?: ChatToolCall[]
  toolCallId?: string
  name?: string
  attachments?: ChatAttachmentRef[]
  progressSteps?: ChatProgressStep[]
}

export interface ChatResponse {
  content: string
  assistantMessage: ChatMessage | null
}

export interface ChatRequestInput {
  sessionId: string
  query: string
  displayContent?: string
  attachments?: ChatAttachmentRef[]
}

export interface ChatUploadItem {
  name: string
  path: string
  relativePath: string
  sizeBytes: number
  uploadedAt?: string
}

export interface ChatWorkspaceData {
  generatedAt: string
  runtime: {
    workspace: string
    provider: string
    model: string
    status: 'ready' | 'busy'
    enabledChannels: string[]
    activeMcpCount: number
  }
  recentUploads: ChatUploadItem[]
  recentToolActivity: Array<{
    sessionId: string
    sessionTitle: string
    toolName: string
    source: string
    createdAt?: string
    mcpServerName?: string | null
    mcpServerDisplayName?: string | null
  }>
  activeMcp: Array<{
    name: string
    displayName: string
    toolCount?: number | null
    toolNames: string[]
    status: string
  }>
  quickPrompts: string[]
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

export interface ProviderMeta {
  name: string
  label: string
  category: 'direct' | 'gateway' | 'local' | 'oauth' | 'standard'
  keywords: string[]
  defaultApiBase?: string | null
  supportsPromptCaching: boolean
  isGateway: boolean
  isLocal: boolean
  isOauth: boolean
  isDirect: boolean
}

export interface ConfigMeta {
  providers: ProviderMeta[]
  resolvedProvider: string
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
  channels: {
    sendProgress: boolean
    sendToolHints: boolean
    [key: string]: unknown
  }
  gateway: {
    host: string
    port: number
    heartbeat?: {
      enabled: boolean
      intervalS: number
    }
    [key: string]: unknown
  }
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

export interface ChannelDeliverySettings {
  sendProgress: boolean
  sendToolHints: boolean
}

export interface ChannelStateItem {
  name: string
  enabled: boolean
  configured: boolean
  touched: boolean
  status: 'unconfigured' | 'configured' | 'enabled' | 'incomplete'
  statusLabel: string
  statusDetail: string
  missingRequiredFields: string[]
}

export interface ChannelListResponse {
  delivery: ChannelDeliverySettings
  items: ChannelStateItem[]
}

export interface ChannelDetailResponse {
  delivery: ChannelDeliverySettings
  channel: ChannelStateItem
  config: Record<string, unknown>
}

export interface ChannelProbeCheck {
  key: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export interface ChannelProbeResult {
  channelName: string
  status: 'passed' | 'warning' | 'failed' | 'manual'
  statusLabel: string
  summary: string
  detail?: string | null
  bindingRequired: boolean
  checkedAt: string
  checks: ChannelProbeCheck[]
}

export interface WhatsAppBindingStatus {
  channelName: 'whatsapp'
  bridgeUrl?: string | null
  bridgeInstalled: boolean
  bridgeDir: string
  running: boolean
  pid?: number | null
  authDir: string
  authPresent: boolean
  bindingRequired: boolean
  listenerConnected: boolean
  lastStatus?: string | null
  lastError?: string | null
  qrCode?: string | null
  qrUpdatedAt?: string | null
  startedAt?: string | null
  checkedAt: string
  recentLogs: string[]
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

export interface CalendarReminder {
  time: number
  channel?: string | null
  target?: string | null
}

export interface CalendarEvent {
  id: string
  title: string
  description: string
  start: string
  end: string
  isAllDay: boolean
  priority: 'high' | 'medium' | 'low'
  reminders: CalendarReminder[]
  recurrence?: Record<string, unknown> | null
  recurrenceId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface CalendarSettings {
  defaultView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'
  defaultPriority: 'high' | 'medium' | 'low'
  soundEnabled: boolean
  notificationEnabled: boolean
}

export interface CalendarEventInput {
  title: string
  description?: string
  start: string
  end: string
  isAllDay: boolean
  priority: 'high' | 'medium' | 'low'
  reminders: CalendarReminder[]
  recurrence?: Record<string, unknown> | null
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

export interface AgentTemplateTool {
  name: string
  description: string
}

export interface AgentTemplateItem {
  name: string
  description: string
  tools: string[]
  rules: string[]
  system_prompt: string
  skills: string[]
  model?: string | null
  backend?: string | null
  source: string
  is_builtin: boolean
  is_editable: boolean
  is_deletable: boolean
  enabled: boolean
  created_at?: string | null
  updated_at?: string | null
}

export interface AgentTemplateMutationInput {
  name: string
  description: string
  tools: string[]
  rules: string[]
  system_prompt: string
  skills: string[]
  model?: string | null
  backend?: string | null
  enabled: boolean
}

export interface AgentTemplateMutationResult {
  name: string
  success: boolean
}

export interface AgentTemplateImportResult {
  imported: Array<{
    name: string
    action: string
  }>
  errors: string[]
}

export interface AgentTemplateExportResult {
  content: string
}

export interface WorkspaceDocumentSummary {
  id: string
  label: string
  path: string
  hasTemplate: boolean
  updatedAt?: string
}

export interface WorkspaceDocument {
  id: string
  label: string
  content: string
  updatedAt?: string
  sourcePath: string
  hasTemplate: boolean
}

export interface AuthStatus {
  initialized: boolean
  authenticated: boolean
  username?: string | null
}

export interface ProfileData {
  username: string
  displayName?: string | null
  email?: string | null
  hasAvatar: boolean
  avatarUpdatedAt?: string | null
  avatarUrl?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface ProfileMutationResult {
  profile: ProfileData
  auth: AuthStatus
}

export interface SetupStepStatus {
  key: 'provider' | 'channel' | 'agent'
  label: string
  optional: boolean
  complete: boolean
  skipped?: boolean
}

export interface SetupStatus {
  completed: boolean
  currentStep: 'provider' | 'channel' | 'agent' | 'done'
  completedAt?: string | null
  steps: SetupStepStatus[]
}

export interface SetupMutationResult {
  config: ConfigData
  setup: SetupStatus
}

export type McpServerTransport = 'stdio' | 'sse' | 'streamableHttp' | 'unknown'
export type McpServerStatus = 'ready' | 'incomplete' | 'disabled'
export type McpServerSourceKind = 'config' | 'manual' | 'repository'

export interface McpServerEntry {
  name: string
  displayName: string
  enabled: boolean
  transport: McpServerTransport
  status: McpServerStatus
  statusDetail: string
  toolCount?: number | null
  toolCountKnown: boolean
  toolTimeout: number
  command?: string | null
  args: string[]
  env?: Record<string, string>
  url?: string | null
  headers?: Record<string, string>
  envCount: number
  headerCount: number
  sourceKind: McpServerSourceKind
  sourceLabel: string
  repoUrl?: string | null
  cloneUrl?: string | null
  installDir?: string | null
  installMode?: string | null
  installSteps?: string[]
  requiredEnv?: string[]
  optionalEnv?: string[]
  toolNames?: string[]
  lastToolSyncAt?: string | null
  lastCheckedAt?: string | null
  lastProbeStatus?: string | null
  lastError?: string | null
  updatedAt?: string | null
}

export interface McpServerSummary {
  total: number
  enabled: number
  disabled: number
  ready: number
  incomplete: number
  knownToolCount: number
  verifiedServers: number
}

export interface McpServerListResponse {
  items: McpServerEntry[]
  summary: McpServerSummary
}

export interface McpRepositoryAnalysis {
  title: string
  displayName: string
  serverName: string
  repoUrl: string
  cloneUrl: string
  installSlug: string
  installMode: string
  transport: McpServerTransport
  commandPreview?: string | null
  runUrl?: string | null
  installSteps: string[]
  requiredEnv: string[]
  optionalEnv: string[]
  evidence: string[]
  missingRuntimes: string[]
  canInstall: boolean
  nextStep: string
}

export interface McpRepositoryInstallResult {
  serverName: string
  installedAt: string
  enabled: boolean
  installDir?: string | null
  analysis: McpRepositoryAnalysis
  entry: McpServerEntry | null
  config: ConfigData
}

export interface McpProbeResult {
  serverName: string
  ok: boolean
  status: 'passed' | 'failed' | 'blocked'
  statusLabel: string
  toolNames: string[]
  toolCount: number
  missingEnv: string[]
  error?: string | null
  entry: McpServerEntry | null
}

export interface McpRepairStep {
  key: string
  title: string
  description: string
  safe: boolean
}

export interface McpRepairRunState {
  configured: boolean
  running: boolean
  status: 'idle' | 'running' | 'success' | 'failed' | 'unconfigured'
  commandPreview?: string | null
  lastRequestedAt?: string | null
  lastExitCode?: number | null
  pid?: number | null
  dangerousMode: boolean
  workspace: string
}

export interface McpRepairPlan {
  generatedAt: string
  serverName: string
  status: 'ready' | 'attention' | 'blocked'
  diagnosisCode: string
  diagnosisLabel: string
  summary: string
  detail: string
  missingEnv: string[]
  steps: McpRepairStep[]
  worker: {
    configured: boolean
    commandPreview?: string | null
    dangerousAvailable: boolean
  }
  run: McpRepairRunState
  entry: McpServerEntry | null
}

export interface McpTestChatData {
  session: SessionSummary
  messages: ChatMessage[]
  toolNames: string[]
  recentToolActivity: Array<{
    sessionId: string
    sessionTitle: string
    toolName: string
    source: string
    createdAt?: string
  }>
}

export interface McpServerMutationResult {
  serverName: string
  entry: McpServerEntry | null
  config: ConfigData
  enabled?: boolean
}

export interface McpServerDeleteResult {
  deleted: boolean
  serverName: string
  checkoutRemoved: boolean
  config: ConfigData
}

export interface ValidationCheck {
  key: string
  category: 'provider' | 'runtime' | 'gateway' | 'paths' | 'mcp' | 'dangerous'
  status: 'pass' | 'warn' | 'fail'
  label: string
  summary: string
  detail: string
  href: string
  actionLabel: string
}

export interface ValidationRunResult {
  generatedAt: string
  summary: {
    status: 'ready' | 'attention' | 'blocked'
    passed: number
    warnings: number
    failures: number
  }
  checks: ValidationCheck[]
  dangerousOptions: Array<{
    key: string
    label: string
    status: 'warn'
    summary: string
    detail: string
    href: string
    actionLabel: string
  }>
}

export interface OpsLogFile {
  name: string
  path: string
  sizeBytes: number
  lineCount: number
  updatedAt?: string | null
  tail: string[]
}

export interface OpsLogResponse {
  items: OpsLogFile[]
}

export interface OpsActionItem {
  name: string
  label: string
  configured: boolean
  running: boolean
  commandPreview?: string | null
  workspace: string
  description: string
  caution: string
  lastRequestedAt?: string | null
  lastStatus: 'idle' | 'running' | 'success' | 'failed' | 'unconfigured'
  lastExitCode?: number | null
  pid?: number | null
}

export interface OpsActionResponse {
  items: OpsActionItem[]
}

export interface OpsActionTriggerResult {
  item: OpsActionItem
}
