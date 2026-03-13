import type {
  AgentTemplateExportResult,
  AgentTemplateImportResult,
  AgentTemplateItem,
  AgentTemplateMutationInput,
  AgentTemplateMutationResult,
  AgentTemplateTool,
  AuthStatus,
  CalendarEvent,
  CalendarEventInput,
  CalendarSettings,
  ChannelDetailResponse,
  ChannelListResponse,
  ChannelProbeResult,
  ChatMessage,
  ChatResponse,
  ChatUploadItem,
  ChatWorkspaceData,
  ConfigMeta,
  ConfigData,
  CronJob,
  CronJobInput,
  CronJobListResponse,
  CronStatus,
  InstalledSkill,
  McpRepositoryAnalysis,
  McpRepositoryInstallResult,
  McpProbeResult,
  McpRepairPlan,
  McpTestChatData,
  McpServerDeleteResult,
  McpServerEntry,
  McpServerMutationResult,
  McpServerListResponse,
  OpsActionResponse,
  OpsActionTriggerResult,
  OpsLogResponse,
  ProfileData,
  ProfileMutationResult,
  SessionListResponse,
  SessionSummary,
  SetupMutationResult,
  SetupStatus,
  StreamEvent,
  SystemStatus,
  ValidationRunResult,
  WhatsAppBindingStatus,
  WorkspaceDocument,
  WorkspaceDocumentSummary,
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
  uploadChatFile: (formData: FormData) =>
    request<ChatUploadItem>('/chat/uploads', {
      method: 'POST',
      body: formData,
      skipJsonContentType: true,
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
  sendMessageStream: async (
    sessionId: string,
    content: string,
    onEvent: (event: StreamEvent) => void,
  ): Promise<ChatResponse> => {
    const response = await fetch(`${API_BASE}/chat/sessions/${sessionId}/messages?stream=1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ content }),
    })

    if (!response.ok) {
      let message = '流式请求失败'
      let code: string | undefined
      let details: unknown
      try {
        const payload = (await response.json()) as ApiEnvelope<never>
        message = payload.error?.message || message
        code = payload.error?.code
        details = payload.error?.details
      } catch {
        // Keep the fallback message when the response body is not JSON.
      }
      if (response.status === 401) {
        notifyAuthRequired()
      }
      throw new ApiError(message, response.status, code, details)
    }

    if (!response.body) {
      throw new ApiError('流式请求失败', response.status)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''

        for (const block of blocks) {
          const lines = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
          if (lines.length === 0) {
            continue
          }
          const event = JSON.parse(lines.join('\n')) as StreamEvent
          onEvent(event)
          if (event.type === 'done') {
            return {
              content: event.content,
              assistantMessage: event.assistantMessage,
            }
          }
          if (event.type === 'error') {
            throw new Error(event.message)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    throw new Error('流式响应意外中断')
  },
  getConfig: () => request<ConfigData>('/config'),
  getConfigMeta: () => request<ConfigMeta>('/config/meta'),
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
  getAgentTemplates: () => request<AgentTemplateItem[]>('/agent-templates'),
  getAgentTemplate: (templateName: string) =>
    request<AgentTemplateItem>(`/agent-templates/${encodeURIComponent(templateName)}`),
  getValidTemplateTools: () => request<AgentTemplateTool[]>('/agent-templates/tools/valid'),
  createAgentTemplate: (payload: AgentTemplateMutationInput) =>
    request<AgentTemplateMutationResult>('/agent-templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAgentTemplate: (templateName: string, payload: Partial<AgentTemplateMutationInput>) =>
    request<AgentTemplateMutationResult>(`/agent-templates/${encodeURIComponent(templateName)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteAgentTemplate: (templateName: string) =>
    request<AgentTemplateMutationResult>(`/agent-templates/${encodeURIComponent(templateName)}`, {
      method: 'DELETE',
    }),
  importAgentTemplates: (payload: { content: string; on_conflict: 'skip' | 'rename' | 'replace' }) =>
    request<AgentTemplateImportResult>('/agent-templates/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  exportAgentTemplates: (names?: string[]) =>
    request<AgentTemplateExportResult>('/agent-templates/export', {
      method: 'POST',
      body: JSON.stringify({ names }),
    }),
  reloadAgentTemplates: () =>
    request<{ success: boolean }>('/agent-templates/reload', {
      method: 'POST',
    }),
  getInstalledSkills: () => request<InstalledSkill[]>('/skills/installed'),
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
  getDocuments: () => request<WorkspaceDocumentSummary[]>('/documents'),
  getDocument: (documentId: string) => request<WorkspaceDocument>(`/documents/${encodeURIComponent(documentId)}`),
  updateDocument: (documentId: string, content: string) =>
    request<WorkspaceDocument>(`/documents/${encodeURIComponent(documentId)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  resetDocument: (documentId: string) =>
    request<WorkspaceDocument>(`/documents/${encodeURIComponent(documentId)}/reset`, {
      method: 'POST',
    }),
}
