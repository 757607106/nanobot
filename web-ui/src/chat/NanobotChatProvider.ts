import {
  AbstractChatProvider,
  XRequest,
  type SSEOutput,
  type TransformMessage,
  type XRequestOptions,
} from '@ant-design/x-sdk'
import { ApiError } from '../api'
import type { ChatMessage, ChatRequestInput, StreamEvent } from '../types'
import {
  appendProgressStep,
  collectProgressSteps,
  dedupeAttachmentRefs,
  normalizeChatMessage,
  parseStreamEvent,
} from './chatMessageUtils'

const API_BASE = '/api/v1'

async function fetchChatStream(
  _baseURL: RequestInfo | URL,
  options: XRequestOptions<ChatRequestInput, SSEOutput, ChatMessage>,
) {
  const requestParams = options.params ?? {}
  const sessionId = String(requestParams.sessionId || '').trim()
  const query = String(requestParams.query || '').trim()

  if (!sessionId) {
    throw new Error('sessionId is required')
  }

  if (!query) {
    throw new Error('query is required')
  }

  const response = await fetch(`${API_BASE}/chat/sessions/${encodeURIComponent(sessionId)}/messages?stream=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    credentials: 'include',
    signal: options.signal,
    body: JSON.stringify({ content: query }),
  })

  if (!response.ok) {
    let message = '流式请求失败'
    let code: string | undefined
    let details: unknown

    try {
      const payload = (await response.json()) as {
        error?: {
          message?: string
          code?: string
          details?: unknown
        } | null
      }
      message = payload.error?.message || message
      code = payload.error?.code
      details = payload.error?.details
    } catch {
      // Ignore JSON parsing failures and keep the fallback message.
    }

    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nanobot:auth-required'))
    }

    throw new ApiError(message, response.status, code, details)
  }

  if (!response.body) {
    throw new ApiError('流式请求失败', response.status)
  }

  return response
}

function getStreamEvents(info: TransformMessage<ChatMessage, SSEOutput>) {
  const events: StreamEvent[] = []
  const currentEvent = parseStreamEvent(info.chunk)
  if (currentEvent) {
    events.push(currentEvent)
  }
  for (const item of info.chunks) {
    const event = parseStreamEvent(item)
    if (event) {
      events.push(event)
    }
  }
  return events
}

export class NanobotChatProvider extends AbstractChatProvider<ChatMessage, ChatRequestInput, SSEOutput> {
  constructor() {
    super({
      request: XRequest(`${API_BASE}/chat/sessions/stream`, {
        manual: true,
        fetch: fetchChatStream,
      }),
    })
  }

  transformParams(
    requestParams: Partial<ChatRequestInput>,
    options: XRequestOptions<ChatRequestInput, SSEOutput, ChatMessage>,
  ) {
    const sessionId = String(requestParams.sessionId || '').trim()
    const query = String(requestParams.query || '').trim()

    if (!sessionId) {
      throw new Error('sessionId is required')
    }

    if (!query) {
      throw new Error('query is required')
    }

    return {
      ...(options?.params || {}),
      ...requestParams,
      sessionId,
      query,
      displayContent: String(requestParams.displayContent || query).trim(),
      attachments: dedupeAttachmentRefs(requestParams.attachments || []),
    }
  }

  transformLocalMessage(requestParams: Partial<ChatRequestInput>) {
    return normalizeChatMessage({
      role: 'user',
      content: String(requestParams.displayContent || requestParams.query || ''),
      createdAt: new Date().toISOString(),
      sessionId: requestParams.sessionId,
      attachments: dedupeAttachmentRefs(requestParams.attachments || []),
    })
  }

  transformMessage(info: TransformMessage<ChatMessage, SSEOutput>) {
    const events = getStreamEvents(info)
    const doneEvent = [...events].reverse().find((event) => event.type === 'done')

    if (doneEvent?.assistantMessage) {
      return normalizeChatMessage({
        ...doneEvent.assistantMessage,
        progressSteps: collectProgressSteps(events, info.originMessage),
      })
    }

    const progressEvents = events.filter((event) => event.type === 'progress')
    if (progressEvents.length > 0) {
      return progressEvents.reduce((currentMessage, event) => {
        return appendProgressStep(currentMessage, event.content, Boolean(event.toolHint))
      }, normalizeChatMessage(info.originMessage ?? { role: 'assistant', content: '', createdAt: new Date().toISOString() }))
    }

    return normalizeChatMessage(
      info.originMessage ?? {
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      },
    )
  }
}

export function createNanobotChatProvider() {
  return new NanobotChatProvider()
}
