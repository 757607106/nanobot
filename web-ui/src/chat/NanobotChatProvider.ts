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
  collectProgressSteps,
  dedupeAttachmentRefs,
  normalizeChatMessage,
  parseStreamEvent,
} from './chatMessageUtils'

const API_BASE = '/api/v1'
const XREQUEST_PLACEHOLDER_URL = `${API_BASE}/chat/sessions/__provider__`

export interface NanobotChatProviderOptions {
  buildMessagesPath?: (requestParams: Partial<ChatRequestInput>) => string
}

function buildDefaultMessagesPath(requestParams: Partial<ChatRequestInput>) {
  const sessionId = String(requestParams.sessionId || '').trim()
  return `${API_BASE}/chat/sessions/${encodeURIComponent(sessionId)}/messages?stream=1`
}

function createFetchChatStream(
  buildMessagesPath: (requestParams: Partial<ChatRequestInput>) => string,
) {
  return async (
    _baseURL: RequestInfo | URL,
    options: XRequestOptions<ChatRequestInput, SSEOutput, ChatMessage>,
  ) => {
    const requestParams = options.params ?? {}
    const sessionId = String(requestParams.sessionId || '').trim()
    const query = String(requestParams.query || '').trim()

    if (!sessionId) {
      throw new Error('sessionId is required')
    }

    if (!query) {
      throw new Error('query is required')
    }

    const response = await fetch(buildMessagesPath(requestParams), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      credentials: 'include',
      signal: options.signal,
      body: JSON.stringify({
        content: query,
        displayContent: requestParams.displayContent,
        attachments: requestParams.attachments || [],
        reasoningEffort: requestParams.reasoningEffort || null,
      }),
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
}

function getStreamEvents(chunks: SSEOutput[]): StreamEvent[] {
  return chunks.map(parseStreamEvent).filter((event): event is StreamEvent => event !== null)
}

export class NanobotChatProvider extends AbstractChatProvider<ChatMessage, ChatRequestInput, SSEOutput> {
  private accumulatedChunks: SSEOutput[] = []
  private _currentReasoningEffortEnabled = false

  constructor(options: NanobotChatProviderOptions = {}) {
    const buildMessagesPath = options.buildMessagesPath || buildDefaultMessagesPath
    super({
      request: XRequest(XREQUEST_PLACEHOLDER_URL, {
        manual: true,
        fetch: createFetchChatStream(buildMessagesPath),
      }),
    })
  }

  transformParams(requestParams: Partial<ChatRequestInput>) {
    this.accumulatedChunks = []
    this._currentReasoningEffortEnabled = Boolean(requestParams.reasoningEffort)
    const sessionId = String(requestParams.sessionId || '').trim()
    const query = String(requestParams.query || '').trim()

    return {
      sessionId,
      query,
      displayContent: String(requestParams.displayContent || query).trim(),
      attachments: dedupeAttachmentRefs(requestParams.attachments || []),
      reasoningEffort: requestParams.reasoningEffort || null,
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
    if (info.chunk && typeof info.chunk === 'object') {
      this.accumulatedChunks.push(info.chunk)
    }

    const allChunks = this.accumulatedChunks.length > 0 ? this.accumulatedChunks : info.chunks
    const events = getStreamEvents(allChunks)
    const doneEvent = [...events].reverse().find((event) => event.type === 'done')

    if (doneEvent?.message) {
      const collectedSteps = collectProgressSteps(events, info.originMessage)
      return normalizeChatMessage({
        ...doneEvent.message,
        progressSteps: collectedSteps.length > 0
          ? collectedSteps
          : (doneEvent.message.progressSteps ?? []),
      })
    }

    const baseMessage = normalizeChatMessage(info.originMessage ?? { role: 'assistant', content: '', createdAt: new Date().toISOString() })

    if (this._currentReasoningEffortEnabled && baseMessage.reasoningContent === undefined) {
      baseMessage.reasoningContent = ''
    }

    const chunkEvents = events.filter((event) => event.type === 'chunk')
    if (chunkEvents.length > 0) {
      baseMessage.content = chunkEvents.map((event) => 'content' in event ? event.content : '').join('')
    }

    const progressSteps = collectProgressSteps(events, info.originMessage)
    if (progressSteps.length > 0) {
      baseMessage.progressSteps = progressSteps
    }

    return baseMessage
  }
}

export function createNanobotChatProvider(options: NanobotChatProviderOptions = {}) {
  return new NanobotChatProvider(options)
}
