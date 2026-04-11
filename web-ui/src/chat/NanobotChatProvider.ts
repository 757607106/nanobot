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
const XREQUEST_PLACEHOLDER_URL = `${API_BASE}/chat/messages?stream=1`

export interface NanobotChatProviderOptions {
  url?: string
  agentId?: string
}

// A standard clean fetch interceptor exclusively for handling global 401 auth redirects,
// without interfering with XRequest's native stream reading, JSON stringification, or request building.
const interceptFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const mergedInit: RequestInit = {
    credentials: 'include',
    ...init,
  }
  const response = await fetch(input, mergedInit)
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nanobot:auth-required'))
  }
  return response
}

function parseStreamEvents(chunks?: SSEOutput[]): StreamEvent[] {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return []
  }
  return chunks
    .map(parseStreamEvent)
    .filter((event): event is StreamEvent => event !== null)
}

function cloneSubMessages(message?: ChatMessage): ChatMessage[] {
  const raw = (message as any)?._subMessages
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map((item: ChatMessage) => normalizeChatMessage(item))
}

function readProgressEvents(message?: ChatMessage) {
  const raw = (message as any)?._progressEvents
  if (!Array.isArray(raw)) {
    return [] as Extract<StreamEvent, { type: 'progress' }>[]
  }
  return raw.filter((event: StreamEvent) => event?.type === 'progress') as Extract<StreamEvent, { type: 'progress' }>[]
}

function getOrCreateAssistantSegment(subMessages: ChatMessage[], createdAt?: string) {
  const last = subMessages[subMessages.length - 1]
  if (last && last.role === 'assistant') {
    return last
  }
  const segment = normalizeChatMessage({
    role: 'assistant',
    content: '',
    reasoningContent: '',
    toolCalls: [],
    createdAt: createdAt || new Date().toISOString(),
  })
  subMessages.push(segment)
  return segment
}

function clearReasoning(message: ChatMessage, subMessages: ChatMessage[]) {
  message.reasoningContent = undefined
  for (const item of subMessages) {
    item.reasoningContent = undefined
  }
}

export class NanobotChatProvider extends AbstractChatProvider<ChatMessage, ChatRequestInput, SSEOutput> {
  private _currentReasoningEffortEnabled = false
  private _agentId?: string

  constructor(options: NanobotChatProviderOptions = {}) {
    super({
      request: XRequest(options.url || XREQUEST_PLACEHOLDER_URL, {
        manual: true,
        fetch: interceptFetch,
      }),
    })
    this._agentId = options.agentId
  }

  transformParams(requestParams: Partial<ChatRequestInput>) {
    this._currentReasoningEffortEnabled = Boolean(requestParams.reasoningEffort)
    const sessionId = String(requestParams.sessionId || '').trim()
    const query = String(requestParams.query || '').trim()

    return {
      sessionId,
      agentId: this._agentId || undefined,
      content: query,
      query, // Keep query for any internal UI references
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
    const baseMessage = normalizeChatMessage(
      info.originMessage ?? {
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      },
    )
    const subMessages = cloneSubMessages(info.originMessage)
    const progressEvents = readProgressEvents(info.originMessage)
    const currentEvent = parseStreamEvent(info.chunk)

    if (currentEvent?.type === 'chunk') {
      if (currentEvent.content) {
        baseMessage.content = `${baseMessage.content || ''}${currentEvent.content}`
      }
      if (this._currentReasoningEffortEnabled) {
        if (currentEvent.reasoningContent) {
          baseMessage.reasoningContent = `${baseMessage.reasoningContent || ''}${currentEvent.reasoningContent}`
        }
      } else {
        baseMessage.reasoningContent = undefined
      }

      const currentSegment = getOrCreateAssistantSegment(subMessages, baseMessage.createdAt)
      if (currentEvent.content) {
        currentSegment.content = `${currentSegment.content || ''}${currentEvent.content}`
      }
      if (this._currentReasoningEffortEnabled && currentEvent.reasoningContent) {
        currentSegment.reasoningContent = `${currentSegment.reasoningContent || ''}${currentEvent.reasoningContent}`
      }
    } else if (currentEvent?.type === 'progress') {
      progressEvents.push(currentEvent)
      if (currentEvent.toolHint && Array.isArray(currentEvent.toolCalls) && currentEvent.toolCalls.length > 0) {
        const currentSegment = getOrCreateAssistantSegment(subMessages, baseMessage.createdAt)
        currentSegment.toolCalls = currentEvent.toolCalls
      } else if (currentEvent.toolComplete) {
        subMessages.push({
          role: 'tool',
          name: currentEvent.toolName,
          content: currentEvent.content === undefined ? '' : String(currentEvent.content),
          toolCallId: currentEvent.toolCallId || currentEvent.toolName,
          createdAt: new Date().toISOString(),
        })
      }
    }

    if (progressEvents.length > 0) {
      baseMessage.progressSteps = collectProgressSteps(progressEvents, info.originMessage)
      ;(baseMessage as any)._progressEvents = progressEvents
    }
    if (subMessages.length > 0) {
      ;(baseMessage as any)._subMessages = subMessages
    }

    if (info.status === 'success') {
      const doneEvent = parseStreamEvents(info.chunks).find(
        (event): event is Extract<StreamEvent, { type: 'done' }> => event.type === 'done',
      )
      if (doneEvent?.message) {
        const finalMessage = normalizeChatMessage({
          ...baseMessage,
          ...doneEvent.message,
          progressSteps:
            doneEvent.message.progressSteps
            ?? baseMessage.progressSteps
            ?? [],
        })
        if (subMessages.length > 0) {
          ;(finalMessage as any)._subMessages = subMessages
        }
        if (progressEvents.length > 0) {
          ;(finalMessage as any)._progressEvents = progressEvents
        }
        if (!this._currentReasoningEffortEnabled) {
          clearReasoning(finalMessage, subMessages)
        }
        return finalMessage
      }
    }

    if (!this._currentReasoningEffortEnabled) {
      clearReasoning(baseMessage, subMessages)
    }

    return baseMessage
  }
}

export function createNanobotChatProvider(options: NanobotChatProviderOptions = {}) {
  return new NanobotChatProvider(options)
}
