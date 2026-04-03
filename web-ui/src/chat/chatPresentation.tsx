import type { CSSProperties, ReactNode } from 'react'
import { PaperClipOutlined, ToolOutlined } from '@ant-design/icons'
import { ThoughtChain } from '@ant-design/x'
import type { ThoughtChainItem } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Collapse, Flex, Space, Tag, Tooltip, Typography, theme } from 'antd'
import { XMarkdown } from '@ant-design/x-markdown'
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
      icon: <ToolOutlined />,
      title: isTool ? step.label : step.label,
      description: isTool ? '工具执行中' : '处理中',
      status: itemStatus,
    }
  })
}

function MetaLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      type="secondary"
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </Text>
  )
}

/* ── Markdown 渲染 ── */
function MarkdownBubble({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="markdown-bubble">
      <XMarkdown
        content={content}
        streaming={isStreaming ? { hasNextChunk: true } : undefined}
      />
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

/* ── 工具调用卡片 (重构为美观紧凑样式) ── */
function ToolCallCards({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  const { token } = theme.useToken()

  if (!toolCalls.length) {
    return null
  }

  const codeStyle: CSSProperties = {
    margin: 0,
    padding: 12,
    borderRadius: 8,
    background: token.colorFillAlter,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontSize: 12,
    fontFamily: 'var(--nb-font-mono, monospace)',
    maxHeight: 320,
    overflow: 'auto',
    border: `1px solid ${token.colorBorderSecondary}`,
  }

  return (
    <Flex vertical gap={6}>
      <MetaLabel>工具调用</MetaLabel>
      <Collapse
        size="small"
        expandIconPosition="end"
        style={{
          borderRadius: 10,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
        }}
        items={toolCalls.map((toolCall, index) => {
          const name = getToolCallName(toolCall)
          return {
            key: `${name}-${index}`,
            label: (
              <Flex align="center" gap={8}>
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: `${token.colorPrimary}14`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <ToolOutlined style={{ fontSize: 12, color: token.colorPrimary }} />
                </div>
                <Text strong style={{ fontSize: 13 }}>{name}</Text>
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                  {getToolArgumentsPreview(toolCall)}
                </Text>
              </Flex>
            ),
            children: (
              <Paragraph code style={codeStyle}>
                {formatToolArgumentsBlock(toolCall)}
              </Paragraph>
            ),
          }
        })}
      />
    </Flex>
  )
}

/* ── 工具结果卡片 ── */
function ToolResultCard({ message }: { message: ChatMessage }) {
  const { token } = theme.useToken()
  const fullContent = String(message.content || '')
  const previewContent = truncateContent(fullContent)
  const isTruncated = previewContent !== fullContent

  const codeStyle: CSSProperties = {
    margin: 0,
    padding: 12,
    borderRadius: 8,
    background: token.colorFillAlter,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: 400,
    overflow: 'auto',
    fontSize: 12,
    fontFamily: 'var(--nb-font-mono, monospace)',
    border: `1px solid ${token.colorBorderSecondary}`,
  }

  return (
    <Collapse
      size="small"
      expandIconPosition="end"
      style={{
        borderRadius: 10,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
      }}
      items={[
        {
          key: 'result',
          label: (
            <Flex align="center" gap={8}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: `${token.colorWarning}14`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <ToolOutlined style={{ fontSize: 12, color: token.colorWarning }} />
              </div>
              <Text strong style={{ fontSize: 13 }}>{message.name || 'tool'}</Text>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                {message.createdAt ? formatDateTimeZh(message.createdAt) : '刚刚'}
              </Text>
            </Flex>
          ),
          children: (
            <Flex vertical gap={8}>
              <Paragraph code style={codeStyle}>
                {previewContent}
              </Paragraph>
              {isTruncated ? (
                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: 'full',
                      label: '展开完整结果',
                      children: (
                        <Paragraph code style={codeStyle}>
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
  const isStreaming = info.status === 'loading' || info.status === 'updating'

  if (message.role === 'tool') {
    return <ToolResultCard message={message} />
  }

  const hasMessageContent = Boolean(String(message.content || '').trim())
  const showPlaceholderCopy =
    !hasMessageContent &&
    message.role === 'assistant' &&
    isStreaming

  return (
    <Flex vertical gap={12}>
      {progressSteps.length > 0 ? (
        <Flex vertical gap={6}>
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
                borderRadius: 10,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            />
          )}
        </Flex>
      ) : null}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {hasMessageContent ? (
        <MarkdownBubble
          content={String(message.content ?? '')}
          isStreaming={message.role === 'assistant' && isStreaming}
        />
      ) : showPlaceholderCopy ? (
        <Text type="secondary">{assistantLoadingCopy}</Text>
      ) : null}

      {showToolCalls && message.role === 'assistant' ? <ToolCallCards toolCalls={message.toolCalls || []} /> : null}
    </Flex>
  )
}
