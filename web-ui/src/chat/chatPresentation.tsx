import { NodeIndexOutlined, PaperClipOutlined, ToolOutlined } from '@ant-design/icons'
import { ThoughtChain } from '@ant-design/x'
import type { ThoughtChainItem } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Space, Tag, Tooltip } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatDateTimeZh } from '../locale'
import type { ChatAttachmentRef, ChatMessage, ChatToolCall } from '../types'
import { getToolCallName, normalizeChatMessage } from './chatMessageUtils'

const TOOL_RESULT_PREVIEW_LIMIT = 1400

type ChatProgressDisplay = 'thought-chain' | 'tag-list'

function truncateContent(content: string, limit = TOOL_RESULT_PREVIEW_LIMIT) {
  if (content.length <= limit) {
    return content
  }
  return `${content.slice(0, limit)}\n\n...`
}

function safeJsonParse(value?: string) {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function summarizeValue(value: unknown, limit = 64): string {
  if (typeof value === 'string') {
    const compact = value.replace(/\s+/g, ' ').trim()
    return compact.length > limit ? `${compact.slice(0, limit)}...` : compact
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `${value.length} 项`
  }
  if (value && typeof value === 'object') {
    return '对象'
  }
  return '空'
}

function getToolArgumentsPreview(toolCall: ChatToolCall) {
  const args = toolCall.function?.arguments
  if (!args) {
    return '无参数'
  }

  const parsed = safeJsonParse(args)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const preview = Object.entries(parsed as Record<string, unknown>)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${summarizeValue(value)}`)
      .join(' · ')
    return preview || '查看参数'
  }

  const compact = args.replace(/\s+/g, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact
}

function formatToolArgumentsBlock(toolCall: ChatToolCall) {
  const args = toolCall.function?.arguments
  if (!args) {
    return '无参数'
  }
  const parsed = safeJsonParse(args)
  if (parsed) {
    return JSON.stringify(parsed, null, 2)
  }
  return args
}

function buildThoughtChainItems(
  steps: ChatMessage['progressSteps'],
  status: MessageInfo<ChatMessage>['status'],
): ThoughtChainItem[] {
  const progressSteps = steps ?? []
  return progressSteps.map((step, index) => {
    const isLast = index === progressSteps.length - 1
    let itemStatus: ThoughtChainItem['status'] = 'success'
    if (status === 'loading' || status === 'updating') {
      itemStatus = isLast ? 'pending' : 'success'
    } else if (status === 'error' || status === 'abort') {
      itemStatus = isLast ? 'error' : 'success'
    }
    return {
      key: step.key,
      icon: step.kind === 'tool' ? <ToolOutlined /> : <NodeIndexOutlined />,
      title: step.kind === 'tool' ? `工具：${step.label}` : step.label,
      description: step.kind === 'tool' ? '工具调用进度' : '执行过程',
      status: itemStatus,
    }
  })
}

function MarkdownBubble({ content }: { content: string }) {
  return (
    <div className="markdown-bubble">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

export function getDisplaySessionTitle(title?: string) {
  if (!title || title === 'New Chat') {
    return '新会话'
  }
  return title
}

export function getAttachmentName(item: ChatAttachmentRef) {
  return item.name || item.relativePath.split('/').filter(Boolean).pop() || item.relativePath
}

export function getChatMessageTitle(
  message: ChatMessage,
  options?: {
    assistantLabel?: string
  },
) {
  if (message.role === 'user') {
    return '你'
  }
  if (message.role === 'assistant') {
    return options?.assistantLabel || '助手'
  }
  if (message.role === 'tool') {
    return message.name || 'tool'
  }
  return message.role
}

export function AttachmentTags({
  attachments,
  removable,
  onRemove,
}: {
  attachments: ChatAttachmentRef[]
  removable?: boolean
  onRemove?: (relativePath: string) => void
}) {
  if (!attachments.length) {
    return null
  }

  return (
    <div className="chat-attachment-tags">
      {attachments.map((item) => (
        <Tooltip key={item.relativePath} title={item.relativePath}>
          <Tag
            closable={removable}
            onClose={(event) => {
              event.preventDefault()
              onRemove?.(item.relativePath)
            }}
            icon={<PaperClipOutlined />}
            className="chat-attachment-tag"
          >
            {getAttachmentName(item)}
          </Tag>
        </Tooltip>
      ))}
    </div>
  )
}

function ToolCallCards({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  if (!toolCalls.length) {
    return null
  }

  return (
    <div className="chat-message-meta-block">
      <div className="chat-message-meta-label">工具调用</div>
      <div className="chat-tool-call-list">
        {toolCalls.map((toolCall, index) => {
          const name = getToolCallName(toolCall)
          return (
            <details key={`${name}-${index}`} className="chat-tool-call-card">
              <summary className="chat-tool-call-summary">
                <span className="chat-tool-call-title">
                  <ToolOutlined />
                  <span>{name}</span>
                </span>
                <span className="chat-tool-call-preview">{getToolArgumentsPreview(toolCall)}</span>
              </summary>
              <pre className="chat-tool-call-pre">{formatToolArgumentsBlock(toolCall)}</pre>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function ToolResultCard({ message }: { message: ChatMessage }) {
  const fullContent = String(message.content || '')
  const previewContent = truncateContent(fullContent)
  const isTruncated = previewContent !== fullContent

  return (
    <div className="chat-tool-result-card">
      <div className="chat-tool-result-head">
        <span>{message.name || 'tool'}</span>
        <span>{message.createdAt ? formatDateTimeZh(message.createdAt) : '刚刚'}</span>
      </div>
      <pre className="chat-tool-result-pre">{previewContent}</pre>
      {isTruncated ? (
        <details className="chat-tool-result-details">
          <summary className="chat-tool-result-summary">展开完整工具结果</summary>
          <pre className="chat-tool-result-pre is-expanded">{fullContent}</pre>
        </details>
      ) : null}
    </div>
  )
}

export function ChatMessageBody({
  info,
  progressDisplay = 'thought-chain',
  assistantLoadingCopy = '正在组织回复与工具执行结果...',
  showToolCalls = true,
}: {
  info: MessageInfo<ChatMessage>
  progressDisplay?: ChatProgressDisplay
  assistantLoadingCopy?: string
  showToolCalls?: boolean
}) {
  const message = normalizeChatMessage(info.message)
  const progressSteps = message.progressSteps ?? []

  if (message.role === 'tool') {
    return <ToolResultCard message={message} />
  }

  const hasMessageContent = Boolean(String(message.content || '').trim())
  const showPlaceholderCopy =
    !hasMessageContent &&
    message.role === 'assistant' &&
    (info.status === 'loading' || info.status === 'updating')

  return (
    <div className="chat-message-stack">
      {progressSteps.length > 0 ? (
        <div className="chat-message-meta-block">
          <div className="chat-message-meta-label">执行过程</div>
          {progressDisplay === 'tag-list' ? (
            <Space wrap>
              {progressSteps.map((step) => (
                <Tag key={step.key} color={step.kind === 'tool' ? 'blue' : 'gold'}>
                  {step.label}
                </Tag>
              ))}
            </Space>
          ) : (
            <ThoughtChain items={buildThoughtChainItems(progressSteps, info.status)} className="chat-thought-chain" />
          )}
        </div>
      ) : null}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {hasMessageContent ? (
        <MarkdownBubble content={String(message.content ?? '')} />
      ) : showPlaceholderCopy ? (
        <div className="chat-loading-copy">{assistantLoadingCopy}</div>
      ) : null}

      {showToolCalls && message.role === 'assistant' ? <ToolCallCards toolCalls={message.toolCalls || []} /> : null}
    </div>
  )
}
