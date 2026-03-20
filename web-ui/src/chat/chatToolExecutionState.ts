import type { MessageInfo } from '@ant-design/x-sdk'
import type { ChatMessage } from '../types'
import { getToolCallName, normalizeChatMessage } from './chatMessageUtils'
import type { ToolExecutionEntry } from './ChatToolExecutionCards'

interface BuildToolExecutionStateResult {
  byAssistantId: Map<string | number, ToolExecutionEntry[]>
  hiddenToolMessageIds: Set<string | number>
}

function findLatestPendingEntry(entries: Array<{ assistantId: string | number; entryIndex: number; name: string }>, assistantMap: Map<string | number, ToolExecutionEntry[]>, toolName?: string) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index]
    const entry = assistantMap.get(candidate.assistantId)?.[candidate.entryIndex]
    if (!entry || entry.results.length > 0) {
      continue
    }
    if (!toolName || entry.name === toolName) {
      return candidate
    }
  }
  return null
}

export function buildToolExecutionState(messageInfos: MessageInfo<ChatMessage>[]): BuildToolExecutionStateResult {
  const byAssistantId = new Map<string | number, ToolExecutionEntry[]>()
  const hiddenToolMessageIds = new Set<string | number>()
  const toolCallLookup = new Map<string, { assistantId: string | number; entryIndex: number }>()
  const pendingEntries: Array<{ assistantId: string | number; entryIndex: number; name: string }> = []

  for (const info of messageInfos) {
    const message = normalizeChatMessage(info.message)

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const entries = message.toolCalls.map((toolCall, index) => ({
        key: `${info.id}-${toolCall.id || index}-${getToolCallName(toolCall)}`,
        callId: toolCall.id,
        name: getToolCallName(toolCall),
        args: toolCall.function?.arguments,
        results: [],
        status: info.status === 'error' || info.status === 'abort'
          ? 'error' as const
          : info.status === 'loading' || info.status === 'updating'
            ? 'running' as const
            : 'pending' as const,
      }))

      byAssistantId.set(info.id, entries)

      entries.forEach((entry, index) => {
        if (entry.callId) {
          toolCallLookup.set(entry.callId, { assistantId: info.id, entryIndex: index })
        }
        pendingEntries.push({ assistantId: info.id, entryIndex: index, name: entry.name })
      })
      continue
    }

    if (message.role !== 'tool') {
      continue
    }

    const target = message.toolCallId
      ? toolCallLookup.get(message.toolCallId)
      : findLatestPendingEntry(pendingEntries, byAssistantId, message.name)

    if (!target) {
      continue
    }

    const entry = byAssistantId.get(target.assistantId)?.[target.entryIndex]
    if (!entry) {
      continue
    }

    entry.results.push({
      key: `${info.id}-${entry.results.length}`,
      name: message.name || entry.name,
      content: String(message.content || ''),
      createdAt: message.createdAt,
    })
    entry.status = 'success'
    hiddenToolMessageIds.add(info.id)
  }

  return {
    byAssistantId,
    hiddenToolMessageIds,
  }
}
