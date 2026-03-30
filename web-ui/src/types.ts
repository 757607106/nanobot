export interface SessionSummary {
  id: string
  sessionId: string
  title: string
  createdAt?: string
  updatedAt?: string
  messageCount: number
  fileCount?: number
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

export interface ChatRequestInput {
  sessionId: string
  agentId?: string
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

export interface ChatSessionFilesMutationResult {
  sessionFiles: ChatUploadItem[]
  uploadedFile?: ChatUploadItem
}

export interface ChatWorkspaceData {
  generatedAt: string
  runtime: {
    workspace: string
    provider: string
    resolvedProvider?: string | null
    resolvedBinding?: string | null
    model: string
    reasoningEffort?: string | null
    maxToolIterations?: number
    restrictToWorkspace?: boolean
    sendProgress?: boolean
    sendToolHints?: boolean
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

export interface ModelBinding {
  provider: string
  label?: string | null
  model?: string | null
  capabilityType?: 'text_chat' | 'embedding' | 'multimodal'
  apiKey: string
  apiBase?: string | null
  extraHeaders?: Record<string, string> | null
}

export interface ModelBindingTestResult {
  ok: boolean
  provider: string
  model: string
  bindingName: string
  label?: string | null
  latencyMs: number
  finishReason: string
  message: string
  responsePreview?: string | null
  usage?: Record<string, number>
}

export interface ModelBindingModelsResult {
  provider: string
  bindingName: string
  label?: string | null
  models: string[]
  count: number
  message: string
  source: 'remote'
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
  resolvedBinding?: string | null
}

export interface RagConfigData {
  llmBinding?: string | null
  embeddingBinding?: string | null
}

export interface ConfigData {
  agents: {
    defaults: {
      workspace: string
      model: string
      binding?: string | null
      provider: string
      maxTokens: number
      contextWindowTokens: number
      temperature: number
      maxToolIterations: number
      reasoningEffort?: string | null
    }
  }
  providers: Record<string, ProviderConfig>
  modelBindings?: Record<string, ModelBinding>
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
  rag?: RagConfigData
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

export interface ChannelAuditEntry {
  auditId: string
  tenantId: string
  instanceId: string
  channelName: string
  chatId: string
  sessionKey: string
  senderId: string
  messagePreview: string
  status: 'resolved' | 'unmatched' | 'dispatched' | 'no_handler' | 'dispatch_error'
  resolved: boolean
  resolutionKind: 'none' | 'exact' | 'wildcard' | string
  bindingId?: string | null
  targetType?: 'agent' | string | null
  targetId?: string | null
  messageId?: string | null
  dispatchRunId?: string | null
  artifactPath?: string | null
  responsePreview?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ChannelAuditListResponse {
  items: ChannelAuditEntry[]
  limit: number
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

export interface WeixinBindingStatus {
  channelName: 'weixin'
  running: boolean
  authenticated: boolean
  lastStatus?: string | null
  lastError?: string | null
  qrCode?: string | null
  qrUpdatedAt?: string | null
  startedAt?: string | null
  checkedAt: string
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

export interface MarketplaceSkill {
  id: string
  slug: string
  name: string
  description: string
  version?: string | null
  tags?: string[]
  source: string
  homepage?: string | null
  updatedAt?: number | null
  downloads?: number | null
  compatibility: 'native' | 'partial' | 'unsupported' | 'unknown'
  compatibilityLabel: string
  compatibilitySummary?: string | null
  compatibilityReasons: string[]
}

export interface MarketplaceSearchResponse {
  skills: MarketplaceSkill[]
  total: number
}

export interface AgentTemplateTool {
  name: string
  description: string
}

export interface ArtifactRetentionPolicyConfig {
  enabled?: boolean
  archiveAfterDays?: number | null
  deleteAfterDays?: number | null
  reason?: string | null
  actionBy?: string | null
  updatedAt?: string | null
}

export interface AgentDefinition {
  agentId: string
  tenantId: string
  instanceId: string
  name: string
  description: string
  systemPrompt: string
  rules: string[]
  model?: string | null
  binding?: string | null
  provider?: string | null
  backend?: string | null
  enabled: boolean
  toolAllowlist: string[]
  mcpServerIds: string[]
  skillIds: string[]
  knowledgeBindingIds: string[]
  tags: string[]
  memoryScope: string
  artifactRetentionPolicy?: ArtifactRetentionPolicyConfig | null
  sourceTemplateName?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AgentDefinitionMutationInput {
  name: string
  description?: string
  systemPrompt: string
  rules?: string[]
  model?: string | null
  binding?: string | null
  provider?: string | null
  backend?: string | null
  enabled?: boolean
  toolAllowlist?: string[]
  mcpServerIds?: string[]
  skillIds?: string[]
  knowledgeBindingIds?: string[]
  tags?: string[]
  memoryScope?: string
  artifactRetentionPolicy?: ArtifactRetentionPolicyConfig | null
  templateName?: string
}

export interface AgentMemorySnapshot {
  agentId: string
  content: string
  fileName: string
  candidateCount: number
  updatedAt?: string
}

export interface MemoryCandidate {
  candidateId: string
  tenantId: string
  instanceId: string
  scope: string
  sourceKind: string
  title: string
  content: string
  agentId?: string | null
  runId?: string | null
  status: string
  createdAt?: string
  updatedAt?: string
  appliedAt?: string | null
}

export interface MemorySearchHit {
  sourceType: string
  sourceId: string
  title: string
  content: string
  preview: string
  score: number
  metadata: Record<string, unknown>
}

export interface MemorySearchResult {
  query: string
  requestedMode: string
  effectiveMode: string
  items: MemorySearchHit[]
  total: number
}

export interface MemorySourceDetail {
  sourceType: string
  sourceId: string
  title: string
  content: string
  metadata: Record<string, unknown>
}

export interface KnowledgeQueryParams {
  mode: 'local' | 'global' | 'hybrid' | 'naive' | 'mix' | string
  topK: number
  chunkTopK: number
  responseType: string
  onlyNeedContext: boolean
  onlyNeedPrompt: boolean
  enableRerank: boolean
  rerankModel?: string | null
  options: Record<string, unknown>
}

export interface KnowledgeQueryParamOption {
  key: string
  label: string
  type: 'select' | 'number' | 'boolean'
  default?: string | number | boolean
  min?: number
  max?: number
  step?: number
  description?: string
  options?: Array<{
    value: string
    label: string
    description?: string
  }>
}

export interface KnowledgeQueryParamSchema {
  type: string
  options: KnowledgeQueryParamOption[]
}

export type KnowledgeRetrievalProfile = KnowledgeQueryParams

export interface KnowledgeDatabaseStats {
  totalCount: number
  folderCount: number
  fileCount: number
  indexedCount: number
  parsedCount: number
  errorCount: number
}

export interface KnowledgeMindmapNode {
  content: string
  children?: KnowledgeMindmapNode[]
}

export interface KnowledgeBaseDefinition {
  kbId: string
  dbId: string
  tenantId: string
  instanceId: string
  name: string
  description: string
  enabled: boolean
  kbType: 'lightrag'
  embedInfo: Record<string, unknown>
  llmInfo: Record<string, unknown>
  queryParams: KnowledgeQueryParams
  retrievalProfile: KnowledgeQueryParams
  additionalParams: Record<string, unknown>
  shareConfig: Record<string, unknown>
  mindmap?: KnowledgeMindmapNode | null
  sampleQuestions: string[]
  tags: string[]
  stats?: KnowledgeDatabaseStats
  createdAt?: string
  updatedAt?: string
}

export interface KnowledgeBaseMutationInput {
  name: string
  description?: string
  enabled?: boolean
  kbType?: 'lightrag'
  embedInfo?: Record<string, unknown>
  llmInfo?: Record<string, unknown>
  queryParams?: Partial<KnowledgeQueryParams>
  additionalParams?: Record<string, unknown>
  shareConfig?: Record<string, unknown>
  tags?: string[]
}

export interface KnowledgeFile {
  fileId: string
  docId: string
  kbId: string
  dbId: string
  tenantId: string
  instanceId: string
  parentId?: string | null
  filename: string
  title: string
  originalFilename?: string | null
  fileType: string
  path: string
  rawPath?: string | null
  filePath?: string | null
  markdownFile?: string | null
  parsedPath?: string | null
  status: string
  docStatus: string
  contentHash?: string | null
  checksum?: string | null
  fileSize: number
  chunkCount: number
  contentType?: string | null
  mimeType?: string | null
  processingParams: Record<string, unknown>
  metadata: Record<string, unknown>
  isFolder: boolean
  errorMessage?: string | null
  errorSummary?: string | null
  createdBy?: string | null
  updatedBy?: string | null
  createdAt?: string
  updatedAt?: string
}

export type KnowledgeDocument = KnowledgeFile
export type KnowledgeSource = KnowledgeFile

export interface KnowledgeFileListResponse {
  items: KnowledgeFile[]
  stats: KnowledgeDatabaseStats
}

export interface KnowledgeFileDetail {
  file: KnowledgeFile
  content: string
  chunks: KnowledgeQueryChunk[]
  chunkCount: number
}

export interface KnowledgeJob {
  jobId: string
  tenantId: string
  instanceId: string
  kbId: string
  dbId: string
  jobKind: string
  targetFileIds: string[]
  status: string
  trackId: string
  errorSummary?: string | null
  createdAt?: string
  updatedAt?: string
}

export type KnowledgeIngestJob = KnowledgeJob

export interface KnowledgeHit {
  kbId?: string
  kbName?: string
  docId?: string
  title?: string
  content: string
  preview?: string
  score: number
  metadata: Record<string, unknown>
  citation?: {
    kbId?: string
    kbName?: string
    docId?: string
    title?: string
    sourceType?: string | null
    sourceUri?: string | null
    fileName?: string | null
    mimeType?: string | null
    chunkOrdinal?: number | null
  }
}

export interface KnowledgeQueryEntity {
  entity_name?: string
  entity_type?: string
  description?: string
  source_id?: string
  file_path?: string
  [key: string]: unknown
}

export interface KnowledgeQueryRelationship {
  src_id?: string
  tgt_id?: string
  description?: string
  keywords?: string
  source_id?: string
  file_path?: string
  weight?: number
  [key: string]: unknown
}

export interface KnowledgeQueryChunk {
  chunk_id?: string
  chunkId?: string
  content?: string
  reference_id?: string
  file_id?: string
  fileId?: string
  filename?: string
  file_path?: string
  chunk_index?: number
  chunkIndex?: number
  metadata?: Record<string, unknown>
  score?: number
  similarity?: number
  rerank_score?: number
  [key: string]: unknown
}

export interface KnowledgeQueryReference {
  reference_id?: string
  file_path?: string
  [key: string]: unknown
}

export interface KnowledgeQueryResult {
  status?: string
  message?: string
  query?: string
  data?: {
    entities?: KnowledgeQueryEntity[]
    relationships?: KnowledgeQueryRelationship[]
    chunks?: KnowledgeQueryChunk[]
    references?: KnowledgeQueryReference[]
    [key: string]: unknown
  }
  metadata?: Record<string, unknown>
  queryParams?: KnowledgeQueryParams
}

export type KnowledgeRetrieveResult = KnowledgeQueryResult

export interface KnowledgeGraphNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
  title: string
}

export interface KnowledgeGraphEdge {
  id: string
  type: string
  source: string
  target: string
  properties: Record<string, unknown>
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  labels: string[]
  isTruncated?: boolean
}

export interface KnowledgeGraphStats {
  nodeCount: number
  edgeCount: number
  labels: string[]
  isTruncated: boolean
}

export interface KnowledgeBenchmarkQuestion {
  query: string
  goldAnswer?: string
  gold_answer?: string
  goldChunkIds?: string[]
  gold_chunk_ids?: string[]
}

export interface KnowledgeBenchmark {
  id: string
  benchmarkId: string
  benchmark_id: string
  dbId: string
  db_id: string
  name: string
  description: string
  questionCount: number
  question_count: number
  hasGoldChunks: boolean
  has_gold_chunks: boolean
  hasGoldAnswers: boolean
  has_gold_answers: boolean
  benchmarkFile?: string
  benchmark_file?: string
  createdBy?: string | null
  created_at?: string
  createdAt?: string
  updated_at?: string
  updatedAt?: string
}

export interface KnowledgePagination {
  currentPage?: number
  current_page?: number
  pageSize?: number
  page_size?: number
  total?: number
  totalQuestions?: number
  total_questions?: number
  totalPages?: number
  total_pages?: number
  hasNext?: boolean
  hasPrev?: boolean
}

export interface KnowledgeBenchmarkDetail extends KnowledgeBenchmark {
  questions: KnowledgeBenchmarkQuestion[]
  pagination?: KnowledgePagination
}

export interface KnowledgeEvaluationSummary {
  taskId: string
  task_id: string
  kbId?: string
  dbId?: string
  benchmarkId: string
  benchmark_id: string
  status: string
  overallScore?: number | null
  overall_score?: number | null
  totalQuestions: number
  total_questions: number
  completedQuestions: number
  completed_questions: number
  retrievalConfig?: Record<string, unknown>
  retrieval_config?: Record<string, unknown>
  modelConfig?: Record<string, unknown>
  model_config?: Record<string, unknown>
  metrics?: Record<string, number>
  errorSummary?: string | null
  error_summary?: string | null
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
  startedAt?: string
  started_at?: string
  finishedAt?: string
  finished_at?: string
}

export interface KnowledgeEvaluationDetailRow {
  rowId: string
  row_id: string
  query: string
  goldAnswer?: string
  gold_answer?: string
  goldChunkIds?: string[]
  gold_chunk_ids?: string[]
  generatedAnswer?: string
  generated_answer?: string
  retrievedChunks?: KnowledgeQueryChunk[]
  retrieved_chunks?: KnowledgeQueryChunk[]
  metrics?: Record<string, unknown>
  errorMessage?: string | null
  error_message?: string | null
}

export interface KnowledgeEvaluationResult extends KnowledgeEvaluationSummary {
  details: KnowledgeEvaluationDetailRow[]
  pagination?: KnowledgePagination
}

export interface AgentRunSummary {
  runId: string
  tenantId: string
  instanceId: string
  kind: 'agent'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled' | 'timed_out'
  label: string
  taskPreview: string
  agentId?: string | null
  threadId?: string | null
  parentRunId?: string | null
  rootRunId?: string | null
  sessionKey?: string | null
  originChannel?: string | null
  originChatId?: string | null
  controlScope: 'top_level' | 'child'
  workspacePath?: string | null
  memoryScope?: string | null
  knowledgeScope?: string | null
  createdAt?: string
  startedAt?: string | null
  finishedAt?: string | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
  resultSummary?: {
    content?: string | null
    toolsUsed?: string[]
    tools_used?: string[]
    metadata?: Record<string, unknown>
  } | null
  artifactPath?: string | null
  childrenCount?: number
  events?: Array<{
    eventId?: number | null
    runId: string
    eventType: string
    payload?: Record<string, unknown>
    createdAt?: string
  }>
  children?: AgentRunTreeNode[]
}

export interface AgentRunTreeNode extends AgentRunSummary {
  children?: AgentRunTreeNode[]
}

export interface AgentRunListResponse {
  items: AgentRunSummary[]
  total: number
}

export interface RunCancelResult extends AgentRunSummary {
  taskCancellationSent: boolean
}

export interface RunArtifactAudit {
  runId: string
  tenantId: string
  instanceId: string
  artifactPath?: string | null
  fileName?: string | null
  storageScope?: string | null
  storageKey?: string | null
  isLegacyFallback?: boolean
  exists: boolean
  lifecycleStatus?: 'active' | 'quarantined' | 'deleted' | 'missing' | string
  currentStorageScope?: string | null
  currentStorageKey?: string | null
  originalStorageScope?: string | null
  originalStorageKey?: string | null
  governanceReason?: string | null
  governanceActionBy?: string | null
  governanceUpdatedAt?: string | null
  canRestore?: boolean
  retentionPolicy?: RunArtifactRetentionPolicy | null
}

export interface RunArtifactRetentionPolicy {
  runId: string
  tenantId: string
  instanceId: string
  artifactPath?: string | null
  lifecycleStatus?: string | null
  enabled: boolean
  basisTimestamp?: string | null
  archiveAfterDays?: number | null
  deleteAfterDays?: number | null
  archiveDueAt?: string | null
  deleteDueAt?: string | null
  archiveDue: boolean
  deleteDue: boolean
  nextAction?: 'archive' | 'delete' | 'none' | string | null
  nextActionAt?: string | null
  canApplyNow: boolean
  reason?: string | null
  actionBy?: string | null
  updatedAt?: string | null
}

export interface RunArtifactRetentionApplyResult {
  runId: string
  applied: boolean
  action: 'archive' | 'delete' | 'none' | string
  artifact: RunArtifactAudit
  retentionPolicy?: RunArtifactRetentionPolicy | null
}

export interface RunArtifactRetentionSweepResult {
  tenantId: string
  instanceId: string
  evaluated: number
  applied: number
  archived: number
  deleted: number
  skipped: number
  items: RunArtifactRetentionApplyResult[]
}

export interface RunArtifactDetail {
  runId: string
  tenantId?: string
  instanceId?: string
  artifactPath: string
  fileName: string
  contentType: string
  content: string
  audit?: RunArtifactAudit | null
}

export interface RunBoundaryAudit {
  runId: string
  tenantId: string
  instanceId: string
  lineage: {
    kind: string
    status: string
    controlScope: string
    parentRunId?: string | null
    rootRunId?: string | null
    threadId?: string | null
    sessionKey?: string | null
  }
  principal: {
    principalKind?: string | null
    principalId: string
    agentId?: string | null
    label?: string | null
    role?: string | null
  }
  channel: {
    originChannel?: string | null
    originChatId?: string | null
    routing?: Record<string, unknown> | null
  }
  environment: {
    workspacePath?: string | null
    workspaceScope?: string | null
    sandboxKind?: string | null
    execWorkingDir?: string | null
    restrictToWorkspace?: boolean | null
    execTimeoutSeconds?: number | null
  }
  governance: {
    memoryScope?: string | null
    knowledgeScope?: string | null
    knowledgeBindingIds: string[]
    knowledgeNames: string[]
    toolAllowlist: string[]
    mcpServerIds: string[]
    skillIds: string[]
  }
  artifact?: RunArtifactAudit | null
  eventRefs: {
    executionContextMaterialized?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
    bindingsResolved?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
    channelDispatchResolved?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
    artifactWritten?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
    artifactQuarantined?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
    artifactArchived?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
    artifactRestored?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
    artifactDeleted?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
    artifactRetentionPolicySet?: {
      eventId?: number | null
      runId: string
      eventType: string
      payload?: Record<string, unknown>
      createdAt?: string
    } | null
  }
}

export interface AgentTestRunResult {
  run: AgentRunSummary
  session: SessionSummary
  assistantMessage: ChatMessage | null
  messages: ChatMessage[]
  pendingKnowledgeBindings: string[]
  knowledgeHits: KnowledgeHit[]
  appliedBindings: {
    toolAllowlist: string[]
    mcpServerIds: string[]
    skillIds: string[]
    knowledgeBindingIds: string[]
  }
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

// ---------------------------------------------------------------------------
// Channel Bindings
// ---------------------------------------------------------------------------

export interface ChannelBinding {
  bindingId: string
  tenantId: string
  instanceId: string
  channelName: string
  channelChatId: string
  targetType: 'agent'
  targetId: string
  priority: number
  enabled: boolean
  metadata: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface ChannelBindingMutationInput {
  channelName: string
  channelChatId?: string
  targetType: 'agent'
  targetId: string
  priority?: number
  enabled?: boolean
  metadata?: Record<string, unknown>
}
