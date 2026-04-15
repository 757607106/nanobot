import {
  AbstractChatProvider,
  XRequest,
  type SSEOutput,
  type TransformMessage,
} from '@ant-design/x-sdk'
import type { ChatMessage, ChatRequestInput, StreamEvent } from '../types'
import {
  dedupeAttachmentRefs,
  getToolCallName,
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

function getLatestAssistantContent(subMessages: ChatMessage[], fallbackContent?: string) {
  for (let i = subMessages.length - 1; i >= 0; i -= 1) {
    const item = subMessages[i]
    if (item.role === 'assistant' && String(item.content || '').trim()) {
      return String(item.content || '')
    }
  }
  return String(fallbackContent || '')
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
    this._currentReasoningEffortEnabled = Boolean(
      requestParams.reasoningEffort && requestParams.reasoningEffort !== 'none',
    )
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
      // 增量更新 progressSteps（不再依赖 _progressEvents 批处理）
      const steps = [...(baseMessage.progressSteps ?? [])]
      progressEvents.push(currentEvent)

      if (currentEvent.toolHint && Array.isArray(currentEvent.toolCalls) && currentEvent.toolCalls.length > 0) {
        // 1. 在 tool 开始前，快照当前累积的 reasoning content
        const prevSnapshotEnd = steps
          .filter(s => s.kind === 'thinking')
          .reduce((acc, s) => acc + (s.reasoningContent?.length || 0), 0)
        const totalReasoning = baseMessage.reasoningContent || ''
        const newThinking = totalReasoning.slice(prevSnapshotEnd)
        if (newThinking) {
          steps.push({
            key: `thinking-${steps.length}-${Date.now()}`,
            label: '深度思考',
            kind: 'thinking',
            reasoningContent: newThinking,
            createdAt: baseMessage.createdAt || new Date().toISOString(),
          })
        }

        // 2. 添加 tool 开始步骤
        for (const toolCall of currentEvent.toolCalls) {
          const toolCallId = String(toolCall.id || '').trim()
          const label = getToolCallName(toolCall)
          const exists = toolCallId
            ? steps.some(s => s.kind === 'tool' && s.toolCallId === toolCallId && !s.completed)
            : steps.some(s => s.label === label && s.kind === 'tool' && !s.completed)
          if (!exists) {
            steps.push({
              key: toolCallId ? `tool-start-${toolCallId}` : `tool-start-${steps.length}-${label}`,
              label,
              kind: 'tool',
              completed: false,
              toolCallId: toolCallId || undefined,
              createdAt: baseMessage.createdAt || new Date().toISOString(),
            })
          }
        }

        // 3. 设置 segment 的 toolCalls
        const currentSegment = getOrCreateAssistantSegment(subMessages, baseMessage.createdAt)
        currentSegment.toolCalls = currentEvent.toolCalls
      } else if (currentEvent.toolComplete) {
        // 标记对应 tool 步骤为完成
        const targetCallId = String(currentEvent.toolCallId || '').trim()
        const targetName = currentEvent.toolName || currentEvent.content
        let found = false
        for (let i = steps.length - 1; i >= 0; i--) {
          const s = steps[i]
          if (s.kind === 'tool' && !s.completed) {
            if ((targetCallId && s.toolCallId && s.toolCallId === targetCallId) ||
                (s.label === targetName || (s.label && targetName && s.label.includes(targetName)))) {
              steps[i] = {
                ...s,
                completed: true,
                toolCallId: targetCallId || s.toolCallId,
                label: currentEvent.toolStatus ? `${targetName}: ${currentEvent.toolStatus}` : targetName,
                resultContent: currentEvent.content === undefined ? undefined : String(currentEvent.content),
              }
              found = true
              break
            }
          }
        }
        if (!found) {
          const label = currentEvent.toolName
            ? `${currentEvent.toolName}${currentEvent.toolStatus ? `: ${currentEvent.toolStatus}` : ''}`
            : currentEvent.content
          steps.push({
            key: targetCallId ? `tool-complete-${targetCallId}` : `tool-complete-${steps.length}-${label}`,
            label,
            kind: 'tool',
            completed: true,
            toolCallId: targetCallId || undefined,
            resultContent: currentEvent.content === undefined ? undefined : String(currentEvent.content),
            createdAt: baseMessage.createdAt || new Date().toISOString(),
          })
        }

        // 推送 tool 消息到 subMessages
        subMessages.push({
          role: 'tool',
          name: currentEvent.toolName,
          content: currentEvent.content === undefined ? '' : String(currentEvent.content),
          toolCallId: currentEvent.toolCallId || currentEvent.toolName,
          createdAt: new Date().toISOString(),
        })
      } else {
        // 其他 progress 事件（非 tool 的通用进度）
        const kind: 'progress' | 'tool' = currentEvent.toolHint ? 'tool' : 'progress'
        if (!steps.some(s => s.label === currentEvent.content && s.kind === kind)) {
          steps.push({
            key: `${kind}-${steps.length}-${currentEvent.content}`,
            label: currentEvent.content,
            kind,
            createdAt: baseMessage.createdAt || new Date().toISOString(),
          })
        }
      }

      baseMessage.progressSteps = steps
      // 仍然保存 _progressEvents 供 done 事件使用（备用）
      ;(baseMessage as any)._progressEvents = progressEvents
    }
    if (subMessages.length > 0) {
      ;(baseMessage as any)._subMessages = subMessages
    }

    if (info.status === 'success') {
      const allParsed = parseStreamEvents(info.chunks)
      const doneEvent = allParsed.find(
        (event): event is Extract<StreamEvent, { type: 'done' }> => event.type === 'done',
      )
      if (doneEvent?.message) {
        const serverMsg = doneEvent.message
        // Streaming may include intermediate iterations. Use the latest assistant
        // segment as fallback, and prefer server content when available.
        const streamContent = getLatestAssistantContent(subMessages, baseMessage.content || '')
        const serverContent = typeof serverMsg.content === 'string' ? serverMsg.content : ''
        const streamReasoning = baseMessage.reasoningContent || ''
        const serverReasoning = serverMsg.reasoningContent || ''
        const finalContent = serverContent.trim() ? serverContent : streamContent

        const finalMessage = normalizeChatMessage({
          ...baseMessage,
          ...serverMsg,
          content: finalContent,
          reasoningContent: streamReasoning.length >= serverReasoning.length ? streamReasoning : serverReasoning,
          progressSteps: baseMessage.progressSteps ?? serverMsg.progressSteps ?? [],
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
