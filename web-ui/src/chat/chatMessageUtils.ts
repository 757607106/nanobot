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
  return `${ATTACHMENT_BLOCK_MARKER}
${attachmentLines.join('\n')}

${USER_PROMPT_MARKER}
${trimmed}`
}

export function parseChatRequestQuery(content: string) {
  const match = content.match(/^\[附加文件\]\n([\s\S]*?)\n\n\[用户问题\]\n([\s\S]*)$/)
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
  }, normalizeChatMessage(originMessage ?? { role: 'assistant', content: '' }).progressSteps ?? [])
}
