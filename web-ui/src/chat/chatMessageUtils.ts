import type { SSEOutput } from '@ant-design/x-sdk'
import type {
  ChatAttachmentRef,
  ChatMessage,
  ChatProgressStep,
  ChatToolCall,
  ChatUploadItem,
  StreamEvent,
} from '../types'

const ATTACHMENT_BLOCK_MARKER = '[附加文件]'
const USER_PROMPT_MARKER = '[用户问题]'

function getFileName(path: string) {
  return path.split('/').filter(Boolean).pop() || path
}

export function dedupeAttachmentRefs(items: ChatAttachmentRef[]) {
  const map = new Map<string, ChatAttachmentRef>()
  for (const item of items) {
    const key = item.relativePath || item.path || item.name
    if (!key) {
      continue
    }
    map.set(key, item)
  }
  return Array.from(map.values())
}

export function toChatAttachmentRef(item: ChatUploadItem): ChatAttachmentRef {
  return {
    name: item.name,
    path: item.path,
    relativePath: item.relativePath,
    sizeBytes: item.sizeBytes,
    uploadedAt: item.uploadedAt,
  }
}

export function buildChatRequestQuery(content: string, attachments: ChatAttachmentRef[]) {
  const trimmed = content.trim()
  const uniqueAttachments = dedupeAttachmentRefs(attachments)
  if (!uniqueAttachments.length) {
    return trimmed
  }
  const attachmentLines = uniqueAttachments.map((item) => `- ${item.relativePath}`)
  return `${ATTACHMENT_BLOCK_MARKER}\n${attachmentLines.join('\n')}\n\n${USER_PROMPT_MARKER}\n${trimmed}`
}

function parseChatRequestQuery(content: string) {
  const match = new RegExp('^\\[\u9644\u52a0\u6587\u4ef6\\]\\n([\\s\\S]*?)\\n\\n\\[\u7528\u6237\u95ee\u9898\\]\\n([\\s\\S]*)$').exec(content)
  if (!match) {
    return {
      content,
      attachments: [] as ChatAttachmentRef[],
    }
  }

  const [, attachmentBlock, userPrompt] = match
  const attachments = attachmentBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .map((relativePath) => ({
      name: getFileName(relativePath),
      relativePath,
      path: relativePath,
    }))

  return {
    content: userPrompt,
    attachments,
  }
}

export function getToolCallName(toolCall: ChatToolCall) {
  return toolCall.function?.name || toolCall.name || 'tool'
}

export function normalizeChatMessage(message: ChatMessage): ChatMessage {
  const normalized = {
    ...message,
    toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : [],
    attachments: dedupeAttachmentRefs(Array.isArray(message.attachments) ? message.attachments : []),
    progressSteps: Array.isArray(message.progressSteps) ? message.progressSteps : [],
  }

  if (normalized.role === 'user' && normalized.content) {
    const parsed = parseChatRequestQuery(normalized.content)
    return {
      ...normalized,
      content: parsed.content,
      attachments: dedupeAttachmentRefs([...normalized.attachments, ...parsed.attachments]),
    }
  }

  return normalized
}

export function parseStreamEvent(chunk?: SSEOutput | null): StreamEvent | null {
  if (!chunk || typeof chunk.data !== 'string' || !chunk.data.trim()) {
    return null
  }

  try {
    return JSON.parse(chunk.data) as StreamEvent
  } catch {
    return null
  }
}

function hasProgressStep(steps: ChatProgressStep[], label: string, kind: ChatProgressStep['kind']) {
  return steps.some((step) => step.label === label && step.kind === kind)
}

export function appendProgressStep(
  message: ChatMessage | undefined,
  label: string,
  toolHint: boolean,
): ChatMessage {
  const currentMessage = normalizeChatMessage(
    message ?? {
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    },
  )
  const nextStep: ChatProgressStep = {
    key: `${toolHint ? 'tool' : 'progress'}-${currentMessage.progressSteps?.length ?? 0}-${label}`,
    label,
    kind: toolHint ? 'tool' : 'progress',
    createdAt: new Date().toISOString(),
  }
  const progressSteps = currentMessage.progressSteps ?? []

  return {
    ...currentMessage,
    progressSteps: hasProgressStep(progressSteps, nextStep.label, nextStep.kind)
      ? progressSteps
      : [...progressSteps, nextStep],
  }
}

export function collectProgressSteps(events: StreamEvent[], originMessage?: ChatMessage) {
  return events.reduce<ChatProgressStep[]>((steps, event, index) => {
    if (event.type !== 'progress') {
      return steps
    }
    if (event.toolComplete) {
      // Find the corresponding starting step for this tool and mark it completed,
      // rather than appending a duplicate 'completed' record.
      const targetName = event.toolName || event.content
      
      // Find the LAST uncompleted tool step that matches the tool name.
      // E.g., 'Executing web_search...' includes 'web_search'.
      let existingStepIndex = -1
      for (let i = steps.length - 1; i >= 0; i--) {
        const s = steps[i]
        if (s.kind === 'tool' && !s.completed) {
          const sLabel = s.label as string
          if (sLabel === targetName || sLabel.includes(targetName)) {
            existingStepIndex = i
            break
          }
        }
      }

      if (existingStepIndex !== -1) {
        const newSteps = [...steps]
        newSteps[existingStepIndex] = {
          ...newSteps[existingStepIndex],
          completed: true,
          label: event.toolStatus ? `${targetName}: ${event.toolStatus}` : targetName,
        }
        return newSteps
      }

      // If not found, just append it
      const label = event.toolName
        ? `${event.toolName}${event.toolStatus ? `: ${event.toolStatus}` : ''}`
        : event.content
      return [
        ...steps,
        {
          key: `tool-complete-${index}-${label}`,
          label,
          kind: 'tool' as const,
          completed: true,
          createdAt: originMessage?.createdAt || new Date().toISOString(),
        },
      ]
    }
    const kind: ChatProgressStep['kind'] = event.toolHint ? 'tool' : 'progress'
    if (hasProgressStep(steps, event.content, kind)) {
      return steps
    }
    return [
      ...steps,
      {
        key: `${kind}-${index}-${event.content}`,
        label: event.content,
        kind,
        createdAt: originMessage?.createdAt || new Date().toISOString(),
      },
    ]
  }, [])
}
