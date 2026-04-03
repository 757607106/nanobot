import type { ReactNode } from 'react'
import { NodeIndexOutlined, PaperClipOutlined, ToolOutlined } from '@ant-design/icons'
import { ThoughtChain } from '@ant-design/x'
import type { ThoughtChainItem } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Collapse, Flex, Space, Tag, Tooltip, Typography, theme } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatDateTimeZh } from '../locale'
import type { ChatAttachmentRef, ChatMessage, ChatToolCall } from '../types'
import { getToolCallName, normalizeChatMessage } from './chatMessageUtils'

const { Text, Paragraph } = Typography

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
    const isTool = step.kind === 'tool'
    return {
      key: step.key,
      icon: isTool ? <ToolOutlined /> : <NodeIndexOutlined />,
      title: isTool ? `工具：${step.label}` : step.label,
      description: isTool ? '正在执行工具调用' : '执行过程',
      status: itemStatus,
    }
  })
}

function MetaLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      type="secondary"
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  )
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
  const { token } = theme.useToken()

  if (!attachments.length) {
    return null
  }

  return (
    <Flex wrap gap={8}>
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
            style={{
              marginInlineEnd: 0,
              maxWidth: '100%',
              borderRadius: 999,
              background: token.colorFillQuaternary,
              borderColor: token.colorBorderSecondary,
            }}
          >
            {getAttachmentName(item)}
          </Tag>
        </Tooltip>
      ))}
    </Flex>
  )
}

function ToolCallCards({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  const { token } = theme.useToken()

  if (!toolCalls.length) {
    return null
  }

  return (
    <Flex vertical gap={8}>
      <MetaLabel>工具调用</MetaLabel>
      <Collapse
        size="small"
        items={toolCalls.map((toolCall, index) => {
          const name = getToolCallName(toolCall)
          return {
            key: `${name}-${index}`,
            label: (
              <Flex justify="space-between" align="center" gap={12} wrap="wrap">
                <Space size={8}>
                  <ToolOutlined />
                  <Text strong>{name}</Text>
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {getToolArgumentsPreview(toolCall)}
                </Text>
              </Flex>
            ),
            children: (
              <Paragraph
                code
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: token.borderRadiusLG,
                  background: token.colorFillAlter,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {formatToolArgumentsBlock(toolCall)}
              </Paragraph>
            ),
          }
        })}
      />
    </Flex>
  )
}

function ToolResultCard({ message }: { message: ChatMessage }) {
  const { token } = theme.useToken()
  const fullContent = String(message.content || '')
  const previewContent = truncateContent(fullContent)
  const isTruncated = previewContent !== fullContent

  const codeBlockStyle: React.CSSProperties = {
    margin: 0,
    padding: 12,
    borderRadius: token.borderRadiusLG,
    background: token.colorFillAlter,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: 400,
    overflow: 'auto',
  }

  return (
    <Collapse
      size="small"
      items={[
        {
          key: 'result',
          label: (
            <Flex justify="space-between" align="center" gap={12} wrap="wrap">
              <Space size={8}>
                <ToolOutlined />
                <Text strong>{message.name || 'tool'}</Text>
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {message.createdAt ? formatDateTimeZh(message.createdAt) : '刚刚'}
              </Text>
            </Flex>
          ),
          children: (
            <Flex vertical gap={8}>
              <Paragraph code style={codeBlockStyle}>
                {previewContent}
              </Paragraph>
              {isTruncated ? (
                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: 'full',
                      label: '展开完整工具结果',
                      children: (
                        <Paragraph code style={codeBlockStyle}>
                          {fullContent}
                        </Paragraph>
                      ),
                    },
                  ]}
                />
              ) : null}
            </Flex>
          ),
        },
      ]}
    />
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
  const { token } = theme.useToken()
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
    <Flex vertical gap={12}>
      {progressSteps.length > 0 ? (
        <Flex vertical gap={8}>
          <MetaLabel>执行过程</MetaLabel>
          {progressDisplay === 'tag-list' ? (
            <Space wrap>
              {progressSteps.map((step) => (
                <Tag key={step.key} color={step.kind === 'tool' ? 'blue' : 'gold'}>
                  {step.label}
                </Tag>
              ))}
            </Space>
          ) : (
            <ThoughtChain
              items={buildThoughtChainItems(progressSteps, info.status)}
              style={{
                padding: 10,
                borderRadius: token.borderRadiusLG,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            />
          )}
        </Flex>
      ) : null}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {hasMessageContent ? (
        <MarkdownBubble content={String(message.content ?? '')} />
      ) : showPlaceholderCopy ? (
        <Text type="secondary">{assistantLoadingCopy}</Text>
      ) : null}

      {showToolCalls && message.role === 'assistant' ? <ToolCallCards toolCalls={message.toolCalls || []} /> : null}
    </Flex>
  )
}
