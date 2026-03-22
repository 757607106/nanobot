import type {
  AgentDefinition,
  AgentDefinitionMutationInput,
  AgentRunListResponse,
  AgentRunSummary,
  AgentRunTreeNode,
  AgentTestRunResult,
  RunCancelResult,
  RunArtifactDetail,
  AgentTemplateTool,
  AuthStatus,
  CalendarEvent,
  CalendarEventInput,
  CalendarSettings,
  ChannelBinding,
  ChannelBindingMutationInput,
  ChannelDetailResponse,
  ChannelListResponse,
  ChannelProbeResult,
  ChatMessage,
  ChatSessionFilesMutationResult,
  ChatUploadItem,
  ChatWorkspaceData,
  ConfigMeta,
  ConfigData,
  CronJob,
  CronJobInput,
  CronJobListResponse,
  CronStatus,
  InstalledSkill,
  KnowledgeBaseDefinition,
  KnowledgeBaseMutationInput,
  KnowledgeBenchmark,
  KnowledgeBenchmarkDetail,
  KnowledgeDocument,
  KnowledgeEvaluationResult,
  KnowledgeEvaluationSummary,
  KnowledgeFileDetail,
  KnowledgeFileListResponse,
  KnowledgeGraphData,
  KnowledgeGraphStats,
  KnowledgeIngestJob,
  KnowledgeMindmapNode,
  KnowledgeQueryParams,
  KnowledgeQueryParamSchema,
  KnowledgeSource,
  KnowledgeRetrieveResult,
  MarketplaceSearchResponse,
  McpRepositoryAnalysis,
  McpRepositoryInstallResult,
  McpProbeResult,
  McpRepairPlan,
  McpTestChatData,
  MemoryCandidate,
  MemorySearchResult,
  MemorySourceDetail,
  McpServerDeleteResult,
  McpServerEntry,
  McpServerMutationResult,
  McpServerListResponse,
  ModelBindingModelsResult,
  ModelBindingTestResult,
  OpsActionResponse,
  OpsActionTriggerResult,
  OpsLogResponse,
  ProfileData,
  ProfileMutationResult,
  SessionListResponse,
  SessionSummary,
  SetupMutationResult,
  SetupStatus,
  SystemStatus,
  TeamDefinition,
  TeamDefinitionMutationInput,
  TeamMemorySnapshot,
  TeamThreadMessages,
  TeamThreadSummary,
  TeamTestRunResult,
  ValidationRunResult,
  WhatsAppBindingStatus,
} from './types'

const API_BASE = '/api/v1'
const AUTH_REQUIRED_EVENT = 'nanobot:auth-required'

interface ApiEnvelope<T> {
  success: boolean
  data: T
  error?: {
    code?: string
    message?: string
    details?: unknown
  } | null
}

interface RequestOptions extends RequestInit {
  skipJsonContentType?: boolean
}

export class ApiError extends Error {
  statusCode: number
  code?: string
  details?: unknown

  constructor(message: string, statusCode: number, code?: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

function notifyAuthRequired() {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT))
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const { skipJsonContentType, ...fetchOptions } = options ?? {}
  const headers = skipJsonContentType
    ? { ...(options?.headers ?? {}) }
    : {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      }
  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    credentials: 'include',
    ...fetchOptions,
  })

  const payload = (await response.json()) as ApiEnvelope<T>
  if (response.status === 401) {
    notifyAuthRequired()
  }
  if (!response.ok || !payload.success) {
    throw new ApiError(
      payload.error?.message || '请求失败',
      response.status,
      payload.error?.code,
      payload.error?.details,
    )
  }
  return payload.data
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  getAuthStatus: () => request<AuthStatus>('/auth/status'),
  getProfile: () => request<ProfileData>('/profile'),
  updateProfile: (payload: { username: string; displayName?: string | null; email?: string | null }) =>
    request<ProfileMutationResult>('/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  rotateProfilePassword: (payload: { currentPassword: string; newPassword: string }) =>
    request<ProfileMutationResult>('/profile/password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  uploadProfileAvatar: (formData: FormData) =>
    request<{ profile: ProfileData }>('/profile/avatar', {
      method: 'POST',
      body: formData,
      skipJsonContentType: true,
    }),
  deleteProfileAvatar: () =>
    request<{ profile: ProfileData }>('/profile/avatar', {
      method: 'DELETE',
    }),
  getMcpServers: () => request<McpServerListResponse>('/mcp/servers'),
  getMcpServer: (serverName: string) => request<McpServerEntry>(`/mcp/servers/${encodeURIComponent(serverName)}`),
  probeMcpServer: (serverName: string) =>
    request<McpProbeResult>(`/mcp/servers/${encodeURIComponent(serverName)}/probe`, {
      method: 'POST',
    }),
  getMcpRepairPlan: (serverName: string) =>
    request<McpRepairPlan>(`/mcp/servers/${encodeURIComponent(serverName)}/repair-plan`),
  runMcpRepair: (serverName: string, dangerousMode = false) =>
    request<McpRepairPlan>(`/mcp/servers/${encodeURIComponent(serverName)}/repair-run`, {
      method: 'POST',
      body: JSON.stringify({ dangerousMode }),
    }),
  getMcpTestChat: (serverName: string) =>
    request<McpTestChatData>(`/mcp/servers/${encodeURIComponent(serverName)}/test-chat`),
  sendMcpTestChatMessage: (serverName: string, content: string) =>
    request<{
      content: string
      assistantMessage: ChatMessage | null
      session: SessionSummary
      messages: ChatMessage[]
      toolNames: string[]
      recentToolActivity: McpTestChatData['recentToolActivity']
    }>(`/mcp/servers/${encodeURIComponent(serverName)}/test-chat/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  clearMcpTestChat: (serverName: string) =>
    request<{ deleted: boolean }>(`/mcp/servers/${encodeURIComponent(serverName)}/test-chat`, {
      method: 'DELETE',
    }),
  setMcpServerEnabled: (serverName: string, enabled: boolean) =>
    request<McpServerMutationResult>(`/mcp/servers/${encodeURIComponent(serverName)}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  updateMcpServer: (
    serverName: string,
    payload: {
      displayName?: string | null
      enabled: boolean
      type: 'stdio' | 'sse' | 'streamableHttp'
      command?: string | null
      args?: string[]
      env?: Record<string, string>
      url?: string | null
      headers?: Record<string, string>
      toolTimeout: number
    },
  ) =>
    request<McpServerMutationResult>(`/mcp/servers/${encodeURIComponent(serverName)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteMcpServer: (serverName: string) =>
    request<McpServerDeleteResult>(`/mcp/servers/${encodeURIComponent(serverName)}`, {
      method: 'DELETE',
    }),
  inspectMcpRepository: (source: string) =>
    request<McpRepositoryAnalysis>('/mcp/repositories/inspect', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),
  installMcpRepository: (source: string) =>
    request<McpRepositoryInstallResult>('/mcp/repositories/install', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),
  bootstrapAuth: (username: string, password: string) =>
    request<AuthStatus>('/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<AuthStatus>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<AuthStatus>('/auth/logout', {
      method: 'POST',
    }),
  getSetupStatus: () => request<SetupStatus>('/setup/status'),
  updateSetupProvider: (payload: {
    provider: string
    model: string
    bindingId?: string | null
    bindingLabel?: string | null
    apiKey?: string
    apiBase?: string | null
  }) =>
    request<SetupMutationResult>('/setup/provider', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateSetupChannel: (payload: {
    mode: 'skip' | 'telegram'
    telegramToken?: string
    telegramAllowFrom?: string[]
    telegramProxy?: string | null
    telegramReplyToMessage?: boolean
    telegramGroupPolicy?: 'mention' | 'open'
  }) =>
    request<SetupMutationResult>('/setup/channel', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateSetupAgentDefaults: (payload: {
    workspace: string
    maxTokens: number
    contextWindowTokens: number
    temperature: number
    maxToolIterations: number
    reasoningEffort?: 'low' | 'medium' | 'high' | null
  }) =>
    request<SetupMutationResult>('/setup/agent-defaults', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getSessions: (page = 1, pageSize = 20) =>
    request<SessionListResponse>(`/chat/sessions?page=${page}&pageSize=${pageSize}`),
  getChatWorkspace: () => request<ChatWorkspaceData>('/chat/workspace'),
  getSessionFiles: (sessionId: string) => request<ChatUploadItem[]>(`/chat/sessions/${sessionId}/files`),
  uploadSessionChatFile: (sessionId: string, formData: FormData) =>
    request<ChatSessionFilesMutationResult>(`/chat/sessions/${sessionId}/uploads`, {
      method: 'POST',
      body: formData,
      skipJsonContentType: true,
    }),
  importSessionFiles: (sessionId: string, attachments: ChatUploadItem[]) =>
    request<ChatSessionFilesMutationResult>(`/chat/sessions/${sessionId}/files/import`, {
      method: 'POST',
      body: JSON.stringify({ attachments }),
    }),
  createSession: (title?: string) =>
    request<SessionSummary>('/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  renameSession: (sessionId: string, title: string) =>
    request<SessionSummary>(`/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  deleteSession: (sessionId: string) =>
    request<{ deleted: boolean }>(`/chat/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  getMessages: (sessionId: string, limit = 200) =>
    request<ChatMessage[]>(`/chat/sessions/${sessionId}/messages?limit=${limit}`),
  getConfig: () => request<ConfigData>('/config'),
  getConfigMeta: () => request<ConfigMeta>('/config/meta'),
  testModelBinding: (payload: {
    bindingName?: string | null
    label?: string | null
    provider: string
    model: string
    apiKey?: string
    apiBase?: string | null
    extraHeaders?: Record<string, string> | null
  }) =>
    request<ModelBindingTestResult>('/config/model-bindings/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  fetchModelBindingModels: (payload: {
    bindingName?: string | null
    label?: string | null
    provider: string
    apiKey?: string
    apiBase?: string | null
  }) =>
    request<ModelBindingModelsResult>('/config/model-bindings/models', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getChannels: () => request<ChannelListResponse>('/channels'),
  getChannel: (channelName: string) =>
    request<ChannelDetailResponse>(`/channels/${encodeURIComponent(channelName)}`),
  testChannel: (channelName: string, payload: Record<string, unknown>) =>
    request<ChannelProbeResult>(`/channels/${encodeURIComponent(channelName)}/test`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getWhatsAppBindingStatus: () => request<WhatsAppBindingStatus>('/channels/whatsapp/bind/status'),
  startWhatsAppBinding: (payload: Record<string, unknown>) =>
    request<WhatsAppBindingStatus>('/channels/whatsapp/bind/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopWhatsAppBinding: () =>
    request<WhatsAppBindingStatus>('/channels/whatsapp/bind/stop', {
      method: 'POST',
    }),
  updateChannelDelivery: (payload: { sendProgress?: boolean; sendToolHints?: boolean }) =>
    request<ChannelListResponse>('/channels/delivery', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateChannel: (channelName: string, payload: Record<string, unknown>) =>
    request<ChannelDetailResponse>(`/channels/${encodeURIComponent(channelName)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Channel Bindings
  getChannelBindings: () => request<ChannelBinding[]>('/channel-bindings'),
  getChannelBinding: (bindingId: string) => request<ChannelBinding>(`/channel-bindings/${encodeURIComponent(bindingId)}`),
  createChannelBinding: (payload: ChannelBindingMutationInput) =>
    request<ChannelBinding>('/channel-bindings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateChannelBinding: (bindingId: string, payload: Partial<ChannelBindingMutationInput>) =>
    request<ChannelBinding>(`/channel-bindings/${encodeURIComponent(bindingId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteChannelBinding: (bindingId: string) =>
    request<{ deleted: boolean }>(`/channel-bindings/${encodeURIComponent(bindingId)}`, {
      method: 'DELETE',
    }),

  updateConfig: (config: ConfigData) =>
    request<ConfigData>('/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  runValidation: () =>
    request<ValidationRunResult>('/validation/run', {
      method: 'POST',
    }),
  getOpsLogs: (lines = 200) => request<OpsLogResponse>(`/ops/logs?lines=${lines}`),
  getOpsActions: () => request<OpsActionResponse>('/ops/actions'),
  triggerOpsAction: (actionName: string) =>
    request<OpsActionTriggerResult>(`/ops/actions/${encodeURIComponent(actionName)}`, {
      method: 'POST',
    }),
  getSystemStatus: () => request<SystemStatus>('/system/status'),
  getCronStatus: () => request<CronStatus>('/cron/status'),
  getCronJobs: (includeDisabled = false) =>
    request<CronJobListResponse>(`/cron/jobs?includeDisabled=${includeDisabled}`),
  createCronJob: (job: CronJobInput) =>
    request<CronJob>('/cron/jobs', {
      method: 'POST',
      body: JSON.stringify(job),
    }),
  updateCronJob: (jobId: string, updates: Partial<CronJobInput>) =>
    request<CronJob>(`/cron/jobs/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  deleteCronJob: (jobId: string) =>
    request<{ deleted: boolean }>(`/cron/jobs/${jobId}`, {
      method: 'DELETE',
    }),
  runCronJob: (jobId: string) =>
    request<{ ran: boolean }>(`/cron/jobs/${jobId}/run`, {
      method: 'POST',
    }),
  getCalendarEvents: (params?: { start?: string; end?: string }) => {
    const query = new URLSearchParams()
    if (params?.start) {
      query.set('start', params.start)
    }
    if (params?.end) {
      query.set('end', params.end)
    }
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request<CalendarEvent[]>(`/calendar/events${suffix}`)
  },
  createCalendarEvent: (payload: CalendarEventInput) =>
    request<CalendarEvent>('/calendar/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCalendarEvent: (eventId: string, payload: Partial<CalendarEventInput>) =>
    request<CalendarEvent>(`/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCalendarEvent: (eventId: string) =>
    request<{ deleted: boolean }>(`/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    }),
  getCalendarSettings: () => request<CalendarSettings>('/calendar/settings'),
  updateCalendarSettings: (payload: Partial<CalendarSettings>) =>
    request<CalendarSettings>('/calendar/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getCalendarJobs: () => request<CronJob[]>('/calendar/jobs'),
  getKnowledgeBases: (enabled?: boolean) => {
    const params = new URLSearchParams()
    if (typeof enabled === 'boolean') {
      params.set('enabled', String(enabled))
    }
    const search = params.toString()
    return request<KnowledgeBaseDefinition[]>(`/knowledge-bases${search ? `?${search}` : ''}`)
  },
  getAccessibleKnowledgeBases: (enabled = true) =>
    request<KnowledgeBaseDefinition[]>(`/knowledge-bases/accessible?enabled=${String(enabled)}`),
  getKnowledgeBase: (kbId: string) => request<KnowledgeBaseDefinition>(`/knowledge-bases/${encodeURIComponent(kbId)}`),
  createKnowledgeBase: (payload: KnowledgeBaseMutationInput) =>
    request<KnowledgeBaseDefinition>('/knowledge-bases', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateKnowledgeBaseDescription: (payload: {
    name: string
    currentDescription?: string
    fileList?: string[]
    kbId?: string
  }) =>
    request<{ description: string }>('/knowledge-bases/generate-description', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateKnowledgeBase: (kbId: string, payload: Partial<KnowledgeBaseMutationInput>) =>
    request<KnowledgeBaseDefinition>(`/knowledge-bases/${encodeURIComponent(kbId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteKnowledgeBase: (kbId: string) =>
    request<{ deleted: boolean }>(`/knowledge-bases/${encodeURIComponent(kbId)}`, {
      method: 'DELETE',
    }),
  getKnowledgeFiles: (kbId: string) =>
    request<KnowledgeFileListResponse>(`/knowledge-bases/${encodeURIComponent(kbId)}/files`),
  getKnowledgeFileDetail: (kbId: string, fileId: string) =>
    request<KnowledgeFileDetail>(`/knowledge-bases/${encodeURIComponent(kbId)}/files/${encodeURIComponent(fileId)}/detail`),
  getKnowledgeDocuments: async (kbId: string) => (await request<KnowledgeFileListResponse>(`/knowledge-bases/${encodeURIComponent(kbId)}/files`)).items,
  getKnowledgeSources: async (kbId: string) => (await request<KnowledgeFileListResponse>(`/knowledge-bases/${encodeURIComponent(kbId)}/files`)).items,
  createKnowledgeFolder: (kbId: string, payload: { name: string; parentId?: string | null }) =>
    request<KnowledgeDocument>(`/knowledge-bases/${encodeURIComponent(kbId)}/folders`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  moveKnowledgeFile: (
    kbId: string,
    payload: { fileId: string; targetParentId?: string | null; filename?: string | null },
  ) =>
    request<KnowledgeDocument>(`/knowledge-bases/${encodeURIComponent(kbId)}/files/move`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  downloadKnowledgeFileUrl: (kbId: string, fileId: string, variant: 'raw' | 'parsed' = 'raw') =>
    `${API_BASE}/knowledge-bases/${encodeURIComponent(kbId)}/files/${encodeURIComponent(fileId)}/download?variant=${variant}`,
  deleteKnowledgeDocument: (kbId: string, docId: string) =>
    request<{ deleted: boolean }>(`/knowledge-bases/${encodeURIComponent(kbId)}/files/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    }),
  deleteKnowledgeFiles: (kbId: string, fileIds: string[]) =>
    request<{ deletedCount: number; fileIds: string[] }>(`/knowledge-bases/${encodeURIComponent(kbId)}/files/delete`, {
      method: 'POST',
      body: JSON.stringify({ fileIds }),
    }),
  getKnowledgeJobs: (kbId: string) =>
    request<KnowledgeIngestJob[]>(`/knowledge-bases/${encodeURIComponent(kbId)}/jobs`),
  uploadKnowledgeDocuments: (kbId: string, formData: FormData) =>
    request<{ items: KnowledgeDocument[] }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/files`,
      {
        method: 'POST',
        body: formData,
        skipJsonContentType: true,
      },
    ),
  uploadKnowledgeFiles: (kbId: string, formData: FormData) =>
    request<{ items: KnowledgeDocument[] }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/files`,
      {
        method: 'POST',
        body: formData,
        skipJsonContentType: true,
      },
    ),
  addKnowledgeSource: (
    kbId: string,
    payload:
      | { sourceType: 'web_url'; url: string; title?: string; parentId?: string | null }
      | { sourceType: 'faq_table'; title?: string; parentId?: string | null; items: Array<{ question: string; answer: string }> },
  ) =>
    request<KnowledgeDocument>(`/knowledge-bases/${encodeURIComponent(kbId)}/sources`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  parseKnowledgeFiles: (kbId: string, payload: { fileIds: string[] }) =>
    request<{ job: KnowledgeIngestJob; items: KnowledgeDocument[] }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/files/parse`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  indexKnowledgeFiles: (
    kbId: string,
    payload: {
      fileIds: string[]
      params?: {
        chunkSize?: number
        chunkOverlap?: number
        chunkPresetId?: string
        qaSeparator?: string
      }
    },
  ) =>
    request<{ job: KnowledgeIngestJob; items: KnowledgeDocument[] }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/files/index`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  reindexKnowledgeBase: (kbId: string, payload?: { docIds?: string[] }) =>
    request<{ job: KnowledgeIngestJob; items: KnowledgeDocument[] }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/reindex`,
      {
        method: 'POST',
        body: JSON.stringify({ docIds: payload?.docIds ?? [] }),
      },
    ),
  getKnowledgeQueryParams: (kbId: string) =>
    request<KnowledgeQueryParams>(`/knowledge-bases/${encodeURIComponent(kbId)}/query-params`),
  getKnowledgeQueryParamSchema: (kbId: string) =>
    request<KnowledgeQueryParamSchema>(`/knowledge-bases/${encodeURIComponent(kbId)}/query-params/schema`),
  updateKnowledgeQueryParams: (kbId: string, payload: Partial<KnowledgeQueryParams>) =>
    request<KnowledgeQueryParams>(`/knowledge-bases/${encodeURIComponent(kbId)}/query-params`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  retrieveKnowledgeBase: (
    kbId: string,
    payload: Record<string, unknown> & {
      query: string
      mode?: string
      topK?: number
      chunkTopK?: number
      fileIds?: string[]
      fileName?: string
    },
  ) =>
    request<KnowledgeRetrieveResult>(`/knowledge-bases/${encodeURIComponent(kbId)}/query`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  queryKnowledgeBase: (
    kbId: string,
    payload: Record<string, unknown> & {
      query: string
      mode?: string
      topK?: number
      chunkTopK?: number
      fileIds?: string[]
      fileName?: string
    },
  ) =>
    request<KnowledgeRetrieveResult>(`/knowledge-bases/${encodeURIComponent(kbId)}/query`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getKnowledgeSampleQuestions: (kbId: string) =>
    request<{ questions: string[] }>(`/knowledge-bases/${encodeURIComponent(kbId)}/sample-questions`),
  generateKnowledgeSampleQuestions: (kbId: string, count = 10) =>
    request<{ questions: string[] }>(`/knowledge-bases/${encodeURIComponent(kbId)}/sample-questions`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),
  getKnowledgeMindmap: (kbId: string) =>
    request<{ mindmap: KnowledgeMindmapNode }>(`/knowledge-bases/${encodeURIComponent(kbId)}/mindmap`),
  generateKnowledgeMindmap: (kbId: string, payload?: { fileIds?: string[] }) =>
    request<{ mindmap: KnowledgeMindmapNode }>(`/knowledge-bases/${encodeURIComponent(kbId)}/mindmap`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  getKnowledgeGraphLabels: (kbId: string) =>
    request<{ labels: string[] }>(`/knowledge-bases/${encodeURIComponent(kbId)}/graph/labels`),
  getKnowledgeGraph: (kbId: string, payload?: { nodeLabel?: string; maxDepth?: number; maxNodes?: number }) => {
    const params = new URLSearchParams()
    if (payload?.nodeLabel) params.set('node_label', payload.nodeLabel)
    if (payload?.maxDepth) params.set('max_depth', String(payload.maxDepth))
    if (payload?.maxNodes) params.set('max_nodes', String(payload.maxNodes))
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return request<KnowledgeGraphData>(`/knowledge-bases/${encodeURIComponent(kbId)}/graph${suffix}`)
  },
  getKnowledgeGraphStats: (kbId: string) =>
    request<KnowledgeGraphStats>(`/knowledge-bases/${encodeURIComponent(kbId)}/graph/stats`),
  getKnowledgeBenchmarks: (kbId: string) =>
    request<KnowledgeBenchmark[]>(`/knowledge-bases/${encodeURIComponent(kbId)}/benchmarks`),
  getKnowledgeBenchmarkDetail: (kbId: string, benchmarkId: string, page = 1, pageSize = 10) =>
    request<KnowledgeBenchmarkDetail>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/benchmarks/${encodeURIComponent(benchmarkId)}?page=${page}&page_size=${pageSize}`,
    ),
  uploadKnowledgeBenchmark: (
    kbId: string,
    payload: {
      file: File
      name: string
      description?: string
    },
  ) => {
    const formData = new FormData()
    formData.append('file', payload.file)
    formData.append('name', payload.name)
    formData.append('description', payload.description ?? '')
    return request<KnowledgeBenchmark>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/benchmarks/upload`,
      {
        method: 'POST',
        body: formData,
        skipJsonContentType: true,
      },
    )
  },
  generateKnowledgeBenchmark: (
    kbId: string,
    payload: {
      count?: number
      name?: string
      description?: string
    },
  ) =>
    request<KnowledgeBenchmark>(`/knowledge-bases/${encodeURIComponent(kbId)}/benchmarks/generate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteKnowledgeBenchmark: (kbId: string, benchmarkId: string) =>
    request<{ deleted: boolean }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/benchmarks/${encodeURIComponent(benchmarkId)}`,
      {
        method: 'DELETE',
      },
    ),
  downloadKnowledgeBenchmarkUrl: (kbId: string, benchmarkId: string) =>
    `${API_BASE}/knowledge-bases/${encodeURIComponent(kbId)}/benchmarks/${encodeURIComponent(benchmarkId)}/download`,
  getKnowledgeEvaluationHistory: (kbId: string) =>
    request<KnowledgeEvaluationSummary[]>(`/knowledge-bases/${encodeURIComponent(kbId)}/evaluation/history`),
  runKnowledgeEvaluation: (
    kbId: string,
    payload: {
      benchmarkId: string
      modelConfig?: Record<string, unknown>
    },
  ) =>
    request<{ taskId: string; task_id: string }>(`/knowledge-bases/${encodeURIComponent(kbId)}/evaluation/run`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getKnowledgeEvaluationResult: (
    kbId: string,
    taskId: string,
    payload?: {
      page?: number
      pageSize?: number
      errorOnly?: boolean
    },
  ) => {
    const params = new URLSearchParams()
    if (payload?.page) params.set('page', String(payload.page))
    if (payload?.pageSize) params.set('page_size', String(payload.pageSize))
    if (payload?.errorOnly) params.set('error_only', 'true')
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return request<KnowledgeEvaluationResult>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/evaluation/results/${encodeURIComponent(taskId)}${suffix}`,
    )
  },
  deleteKnowledgeEvaluationResult: (kbId: string, taskId: string) =>
    request<{ deleted: boolean }>(
      `/knowledge-bases/${encodeURIComponent(kbId)}/evaluation/results/${encodeURIComponent(taskId)}`,
      {
        method: 'DELETE',
      },
    ),
  getAgents: (enabled?: boolean) => {
    const params = new URLSearchParams()
    if (typeof enabled === 'boolean') {
      params.set('enabled', String(enabled))
    }
    const search = params.toString()
    return request<AgentDefinition[]>(`/agents${search ? `?${search}` : ''}`)
  },
  getAgent: (agentId: string) => request<AgentDefinition>(`/agents/${encodeURIComponent(agentId)}`),
  createAgent: (payload: AgentDefinitionMutationInput) =>
    request<AgentDefinition>('/agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAgent: (agentId: string, payload: Partial<AgentDefinitionMutationInput>) =>
    request<AgentDefinition>(`/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteAgent: (agentId: string) =>
    request<{ deleted: boolean }>(`/agents/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
    }),
  copyAgent: (agentId: string, name?: string) =>
    request<AgentDefinition>(`/agents/${encodeURIComponent(agentId)}/copy`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    }),
  testRunAgent: (agentId: string, content: string) =>
    request<AgentTestRunResult>(`/agents/${encodeURIComponent(agentId)}/test-run`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  getTeams: (enabled?: boolean) => {
    const params = new URLSearchParams()
    if (typeof enabled === 'boolean') {
      params.set('enabled', String(enabled))
    }
    const search = params.toString()
    return request<TeamDefinition[]>(`/teams${search ? `?${search}` : ''}`)
  },
  getTeam: (teamId: string) => request<TeamDefinition>(`/teams/${encodeURIComponent(teamId)}`),
  getTeamThread: (teamId: string) =>
    request<TeamThreadSummary>(`/teams/${encodeURIComponent(teamId)}/thread`),
  getTeamThreadMessages: (teamId: string, limit = 40) => {
    const query = new URLSearchParams()
    query.set('limit', String(limit))
    return request<TeamThreadMessages>(`/teams/${encodeURIComponent(teamId)}/thread/messages?${query.toString()}`)
  },
  createTeam: (payload: TeamDefinitionMutationInput) =>
    request<TeamDefinition>('/teams', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTeam: (teamId: string, payload: Partial<TeamDefinitionMutationInput>) =>
    request<TeamDefinition>(`/teams/${encodeURIComponent(teamId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteTeam: (teamId: string) =>
    request<{ deleted: boolean }>(`/teams/${encodeURIComponent(teamId)}`, {
      method: 'DELETE',
    }),
  copyTeam: (teamId: string, name?: string) =>
    request<TeamDefinition>(`/teams/${encodeURIComponent(teamId)}/copy`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    }),
  runTeam: (teamId: string, content: string) =>
    request<TeamTestRunResult>(`/teams/${encodeURIComponent(teamId)}/runs`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  retryTeamRun: (teamId: string, runId: string, appendContext?: string) =>
    request<TeamTestRunResult>(`/teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ appendContext: appendContext ?? null }),
    }),
  getTeamMemory: (teamId: string) =>
    request<TeamMemorySnapshot>(`/teams/${encodeURIComponent(teamId)}/memory`),
  updateTeamMemory: (teamId: string, content: string) =>
    request<TeamMemorySnapshot>(`/teams/${encodeURIComponent(teamId)}/memory`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  getMemoryCandidates: (params?: {
    teamId?: string
    status?: string
    scope?: string
    limit?: number
  }) => {
    const query = new URLSearchParams()
    if (params?.teamId) {
      query.set('teamId', params.teamId)
    }
    if (params?.status) {
      query.set('status', params.status)
    }
    if (params?.scope) {
      query.set('scope', params.scope)
    }
    if (params?.limit) {
      query.set('limit', String(params.limit))
    }
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request<{ items: MemoryCandidate[]; total: number }>(`/memory-candidates${suffix}`)
  },
  applyMemoryCandidate: (candidateId: string) =>
    request<MemoryCandidate>(`/memory-candidates/${encodeURIComponent(candidateId)}/apply`, {
      method: 'POST',
    }),
  rejectMemoryCandidate: (candidateId: string) =>
    request<MemoryCandidate>(`/memory-candidates/${encodeURIComponent(candidateId)}/reject`, {
      method: 'POST',
    }),
  searchMemory: (payload: { query: string; teamId?: string; limit?: number; mode?: string }) =>
    request<MemorySearchResult>('/memory-search', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getMemorySource: (payload: { sourceType: string; sourceId: string; teamId?: string }) =>
    request<MemorySourceDetail>('/memory-get', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getRuns: (params?: {
    status?: string
    kind?: string
    agentId?: string
    teamId?: string
    sessionKey?: string
    parentRunId?: string
    rootRunId?: string
    threadId?: string
    limit?: number
  }) => {
    const query = new URLSearchParams()
    if (params?.status) {
      query.set('status', params.status)
    }
    if (params?.kind) {
      query.set('kind', params.kind)
    }
    if (params?.agentId) {
      query.set('agentId', params.agentId)
    }
    if (params?.teamId) {
      query.set('teamId', params.teamId)
    }
    if (params?.sessionKey) {
      query.set('sessionKey', params.sessionKey)
    }
    if (params?.parentRunId) {
      query.set('parentRunId', params.parentRunId)
    }
    if (params?.rootRunId) {
      query.set('rootRunId', params.rootRunId)
    }
    if (params?.threadId) {
      query.set('threadId', params.threadId)
    }
    if (params?.limit) {
      query.set('limit', String(params.limit))
    }
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request<AgentRunListResponse>(`/runs${suffix}`)
  },
  getRun: (runId: string) => request<AgentRunSummary>(`/runs/${encodeURIComponent(runId)}`),
  getRunTree: (runId: string) => request<AgentRunTreeNode>(`/runs/${encodeURIComponent(runId)}/tree`),
  getRunArtifact: (runId: string) => request<RunArtifactDetail>(`/runs/${encodeURIComponent(runId)}/artifact`),
  getRunChildren: (runId: string) =>
    request<AgentRunListResponse>(`/runs/${encodeURIComponent(runId)}/children`),
  cancelRun: (runId: string) =>
    request<RunCancelResult>(`/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    }),
  getValidTemplateTools: () => request<AgentTemplateTool[]>('/agent-templates/tools/valid'),
  getInstalledSkills: () => request<InstalledSkill[]>('/skills/installed'),
  searchMarketplaceSkills: (query = '', limit = 24, offset = 0) => {
    const params = new URLSearchParams()
    if (query.trim()) {
      params.set('q', query.trim())
    }
    params.set('limit', String(limit))
    params.set('offset', String(offset))
    const search = params.toString()
    return request<MarketplaceSearchResponse>(`/skills/marketplace${search ? `?${search}` : ''}`)
  },
  installMarketplaceSkill: (slug: string, force = false) =>
    request<InstalledSkill>('/skills/install', {
      method: 'POST',
      body: JSON.stringify({ slug, force }),
    }),
  uploadSkillZip: (formData: FormData) =>
    request<InstalledSkill>('/skills/upload-zip', {
      method: 'POST',
      body: formData,
      skipJsonContentType: true,
    }),
  uploadSkill: (formData: FormData) =>
    request<InstalledSkill>('/skills/upload', {
      method: 'POST',
      body: formData,
      skipJsonContentType: true,
    }),
  deleteSkill: (skillId: string) =>
    request<{ deleted: boolean }>(`/skills/${encodeURIComponent(skillId)}`, {
      method: 'DELETE',
    }),
}
