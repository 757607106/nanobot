import type {
  ChatMessage,
  ChatResponse,
  ConfigMeta,
  ConfigData,
  CronJob,
  CronJobInput,
  CronJobListResponse,
  CronStatus,
  InstalledSkill,
  MainAgentPrompt,
  SessionListResponse,
  SessionSummary,
  StreamEvent,
  SystemStatus,
} from './types'

const API_BASE = '/api/v1'

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
    ...fetchOptions,
  })

  const payload = (await response.json()) as ApiEnvelope<T>
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message || '请求失败')
  }
  return payload.data
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  getSessions: (page = 1, pageSize = 20) =>
    request<SessionListResponse>(`/chat/sessions?page=${page}&pageSize=${pageSize}`),
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
      body: JSON.stringify({ content }),
    })

    if (!response.ok || !response.body) {
      throw new Error('流式请求失败')
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
  updateConfig: (config: ConfigData) =>
    request<ConfigData>('/config', {
      method: 'PUT',
      body: JSON.stringify(config),
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
  getMainAgentPrompt: () => request<MainAgentPrompt>('/main-agent-prompt'),
  updateMainAgentPrompt: (identityContent: string) =>
    request<MainAgentPrompt>('/main-agent-prompt', {
      method: 'PUT',
      body: JSON.stringify({ identity_content: identityContent }),
    }),
  resetMainAgentPrompt: () =>
    request<{ success: boolean }>('/main-agent-prompt/reset', {
      method: 'POST',
    }),
}
