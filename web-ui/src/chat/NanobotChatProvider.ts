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

function getStreamEvents(chunks: SSEOutput[]): StreamEvent[] {
  return chunks.map(parseStreamEvent).filter((event): event is StreamEvent => event !== null)
}

export class NanobotChatProvider extends AbstractChatProvider<ChatMessage, ChatRequestInput, SSEOutput> {
  private accumulatedChunks: SSEOutput[] = []
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
    this.accumulatedChunks = []
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
    if (info.chunk && typeof info.chunk === 'object') {
      this.accumulatedChunks.push(info.chunk)
    }

    const allChunks = this.accumulatedChunks.length > 0 ? this.accumulatedChunks : info.chunks
    const events = getStreamEvents(allChunks)

    const baseMessage = normalizeChatMessage(info.originMessage ?? { role: 'assistant', content: '', createdAt: new Date().toISOString() })

    if (this._currentReasoningEffortEnabled && baseMessage.reasoningContent === undefined) {
      baseMessage.reasoningContent = ''
    }

    const chunkEvents = events.filter((event) => event.type === 'chunk')
    if (chunkEvents.length > 0) {
      baseMessage.content = chunkEvents.map((event) => 'content' in event ? event.content : '').join('')
      if (this._currentReasoningEffortEnabled) {
        const reasoningParts = chunkEvents.map((event) => 'reasoningContent' in event ? (event.reasoningContent || '') : '')
        if (reasoningParts.some(p => p.length > 0)) {
          baseMessage.reasoningContent = reasoningParts.join('')
        }
      } else {
        // If reasoning is completely turned off, strip any dangling server reasoning content
        // so that the UI never thinks reasoning is active.
        baseMessage.reasoningContent = undefined
      }
    }

    const subMessages: ChatMessage[] = []
    let currentSubMsg: Partial<ChatMessage> = { role: 'assistant', reasoningContent: '', content: '', toolCalls: [] }

    for (const event of events) {
      if (event.type === 'chunk') {
        if ('reasoningContent' in event && event.reasoningContent && this._currentReasoningEffortEnabled) {
          currentSubMsg.reasoningContent = (currentSubMsg.reasoningContent || '') + event.reasoningContent
        }
        if ('content' in event && event.content) {
          currentSubMsg.content = (currentSubMsg.content || '') + event.content
        }
        if ('toolCalls' in (event as any) && (event as any).toolCalls) {
          currentSubMsg.toolCalls = (event as any).toolCalls as any
        }
      } else if (event.type === 'progress' && event.toolComplete) {
        // We finished a tool. Push the current assistant context, then the tool result.
        if (currentSubMsg.reasoningContent || currentSubMsg.content || (currentSubMsg.toolCalls && currentSubMsg.toolCalls.length > 0)) {
          subMessages.push(currentSubMsg as ChatMessage)
        }
        subMessages.push({
          role: 'tool',
          name: event.toolName,
          content: event.content === undefined ? '' : String(event.content),
          toolCallId: event.toolName
        } as ChatMessage)
        currentSubMsg = { role: 'assistant', reasoningContent: '', content: '', toolCalls: [] }
      }
    }
    if (currentSubMsg.reasoningContent || currentSubMsg.content || (currentSubMsg.toolCalls && currentSubMsg.toolCalls.length > 0)) {
      subMessages.push(currentSubMsg as ChatMessage)
    }

    ;(baseMessage as any)._subMessages = subMessages

    const progressSteps = collectProgressSteps(events, info.originMessage)
    if (progressSteps.length > 0) {
      baseMessage.progressSteps = progressSteps
    }

    if (info.status === 'success') {
      const doneEvent: any = events.find((event) => event.type === 'done')
      if (doneEvent && doneEvent.message) {
        const finalMsg = normalizeChatMessage({
          ...info.originMessage,
          ...doneEvent.message,
          progressSteps: doneEvent.progressSteps ?? (doneEvent.message.progressSteps ?? []),
        })

        // Preserve our meticulously constructed tool time-series UI segments!
        ;(finalMsg as any)._subMessages = (baseMessage as any)._subMessages

        // Forcefully assert our local reasoning toggle over the backend's default DB dumps!
        if (!this._currentReasoningEffortEnabled) {
          finalMsg.reasoningContent = undefined;
          if ((finalMsg as any)._subMessages) {
             (finalMsg as any)._subMessages.forEach((s: any) => {
               s.reasoningContent = undefined
             })
          }
        }

        return finalMsg
      }
    }

    return baseMessage
  }
}

export function createNanobotChatProvider(options: NanobotChatProviderOptions = {}) {
  return new NanobotChatProvider(options)
}
