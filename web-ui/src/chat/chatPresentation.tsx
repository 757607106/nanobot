import type { CSSProperties, ReactNode } from 'react'
import React from 'react'
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  FileSearchOutlined,
  FunctionOutlined,
  PaperClipOutlined,
  SearchOutlined,
  SyncOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { Mermaid, ThoughtChain } from '@ant-design/x'
import type { ThoughtChainItemType } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Collapse, Flex, Space, Tag, Tooltip, Typography, theme } from 'antd'
import type { ComponentProps as XMarkdownComponentProps } from '@ant-design/x-markdown'
import { XMarkdown } from '@ant-design/x-markdown'
import { formatDateTimeZh } from '../locale'
import type { ChatAttachmentRef, ChatMessage, ChatToolCall } from '../types'
import { getToolCallName, normalizeChatMessage } from './chatMessageUtils'

const { Text } = Typography

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

function getStepIcon(kind: string, status: ThoughtChainItemType['status']) {
  if (status === 'error') return <CloseCircleOutlined />
  if (kind === 'tool') return <ToolOutlined />
  return <SyncOutlined spin={status === 'loading'} />
}

function getStepDescription(status: ThoughtChainItemType['status']) {
  switch (status) {
    case 'loading':
      return '执行中...'
    case 'error':
      return '执行失败'
    case 'success':
    default:
      return '已完成'
  }
}

function buildThoughtChainItems(
  steps: ChatMessage['progressSteps'],
  status: MessageInfo<ChatMessage>['status'],
): ThoughtChainItemType[] {
  const progressSteps = steps ?? []
  return progressSteps.map((step, index) => {
    const isLast = index === progressSteps.length - 1
    let itemStatus: ThoughtChainItemType['status'] = 'success'
    if (status === 'loading' || status === 'updating') {
      itemStatus = isLast ? 'loading' : 'success'
    } else if (status === 'error' || status === 'abort') {
      itemStatus = isLast ? 'error' : 'success'
    }
    return {
      key: step.key,
      icon: getStepIcon(step.kind, itemStatus),
      title: step.label,
      description: getStepDescription(itemStatus),
      status: itemStatus,
    }
  })
}

function MetaLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      type="secondary"
      style={{
        fontSize: 'var(--nb-text-2xs)',
        fontWeight: 'var(--nb-font-weight-strong)',
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </Text>
  )
}

/* ── Code block component: intercepts mermaid fenced blocks ── */
function CodeBlockComponent(props: XMarkdownComponentProps) {
  // Destructure XMarkdown-specific props and the DOM `class` attribute (renamed to className for React)
  const {
    lang,
    block,
    children,
    domNode,
    streamStatus,
    class: htmlClass,
    ...rest
  } = props as XMarkdownComponentProps & { class?: string }

  // For fenced ```mermaid code blocks, delegate to the Mermaid component
  // Only render when stream is done to avoid parsing incomplete syntax
  if (block && lang === 'mermaid' && children && streamStatus !== 'loading') {
    const codeText = typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? (children as React.ReactNode[]).map((c) => (typeof c === 'string' ? c : '')).join('')
        : ''
    if (codeText.trim()) {
      return <Mermaid>{codeText.trim()}</Mermaid>
    }
  }

  // Default code rendering — convert `class` to `className` for React
  return <code {...rest} className={htmlClass}>{children}</code>
}

/*
 * Stabilize the XMarkdown components mapping outside render.
 * Only map `code` — the code component detects `lang === 'mermaid'` internally.
 * Note: `mermaid: Mermaid` is NOT included because XMarkdown passes React nodes
 * (not raw strings) as children for HTML tag mappings, which Mermaid cannot parse.
 */
const XMARKDOWN_COMPONENTS: Record<string, React.ComponentType<XMarkdownComponentProps>> = {
  code: CodeBlockComponent as unknown as React.ComponentType<XMarkdownComponentProps>,
}

const XMARKDOWN_STREAMING_ACTIVE = { hasNextChunk: true }

/* ── Markdown 渲染 ── */
function MarkdownBubble({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="markdown-bubble">
      <XMarkdown
        content={content}
        streaming={isStreaming ? XMARKDOWN_STREAMING_ACTIVE : undefined}
        components={XMARKDOWN_COMPONENTS}
        paragraphTag="div"
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

const TOOL_ICON_MAP: Record<string, ReactNode> = {
  search: <SearchOutlined />,
  find: <FileSearchOutlined />,
  query: <FileSearchOutlined />,
  exec: <CodeOutlined />,
  run: <CodeOutlined />,
  code: <CodeOutlined />,
  api: <ApiOutlined />,
  call: <FunctionOutlined />,
  func: <FunctionOutlined />,
}

function getToolIcon(name: string) {
  const lower = name.toLowerCase()
  for (const [keyword, icon] of Object.entries(TOOL_ICON_MAP)) {
    if (lower.includes(keyword)) return icon
  }
  return <ToolOutlined />
}

/* ── Shared code block style ── */
function useCodeBlockStyle(): CSSProperties {
  const { token } = theme.useToken()
  return {
    margin: 0,
    padding: 10,
    borderRadius: 8,
    background: token.colorFillAlter,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontSize: 'var(--nb-text-xs)',
    fontFamily: 'var(--nb-font-mono, monospace)',
    maxHeight: 360,
    overflow: 'auto',
    border: `1px solid ${token.colorBorderSecondary}`,
    lineHeight: 1.6,
  }
}

/* ── Tool icon badge ── */
function ToolIconBox({ icon, color }: { icon: ReactNode; color: string }) {
  return (
    <div style={{
      width: 22,
      height: 22,
      borderRadius: 6,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 11, color, display: 'flex', lineHeight: 1 }}>{icon}</span>
    </div>
  )
}

/* ── 工具调用卡片（紧凑样式） ── */
function ToolCallCards({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  const { token } = theme.useToken()
  const codeStyle = useCodeBlockStyle()

  if (!toolCalls.length) {
    return null
  }

  return (
    <Flex vertical gap={4}>
      <MetaLabel>工具调用</MetaLabel>
      <Collapse
        size="small"
        expandIconPosition="end"
        bordered={false}
        style={{
          borderRadius: 10,
          background: token.colorFillQuaternary,
        }}
        items={toolCalls.map((toolCall, index) => {
          const name = getToolCallName(toolCall)
          return {
            key: `${name}-${index}`,
            label: (
              <Flex align="center" gap={6} style={{ minWidth: 0 }}>
                <ToolIconBox icon={getToolIcon(name)} color={token.colorPrimary} />
                <Text strong style={{ fontSize: 'var(--nb-text-sm)', flexShrink: 0 }}>{name}</Text>
                <Text
                  type="secondary"
                  ellipsis
                  style={{ fontSize: 'var(--nb-text-2xs)', flex: 1, minWidth: 0 }}
                >
                  {getToolArgumentsPreview(toolCall)}
                </Text>
              </Flex>
            ),
            children: (
              <pre className="tool-call-json-block" style={codeStyle}>
                {formatToolArgumentsBlock(toolCall)}
              </pre>
            ),
          }
        })}
      />
    </Flex>
  )
}

function formatResultContent(content: string) {
  const parsed = safeJsonParse(content)
  if (parsed) {
    return JSON.stringify(parsed, null, 2)
  }
  return content
}

function getResultSummary(content: string, limit = 80): string {
  const parsed = safeJsonParse(content)
  if (parsed) {
    if (typeof parsed === 'object' && parsed !== null) {
      const keys = Object.keys(parsed as Record<string, unknown>)
      if (Array.isArray(parsed)) {
        return `数组 · ${parsed.length} 项`
      }
      return keys.slice(0, 4).join(', ') + (keys.length > 4 ? ` (+${keys.length - 4})` : '')
    }
    return String(parsed).slice(0, limit)
  }
  const firstLine = content.split('\n')[0]?.trim() || ''
  return firstLine.length > limit ? `${firstLine.slice(0, limit)}...` : firstLine
}

/* ── 工具结果卡片（紧凑单层） ── */
function ToolResultCard({ message }: { message: ChatMessage }) {
  const { token } = theme.useToken()
  const codeStyle = useCodeBlockStyle()
  const fullContent = String(message.content || '')
  const formatted = formatResultContent(fullContent)
  const previewContent = truncateContent(formatted)
  const toolName = message.name || 'tool'
  const summary = getResultSummary(fullContent)

  return (
    <Collapse
      size="small"
      expandIconPosition="end"
      bordered={false}
      style={{
        borderRadius: 10,
        background: token.colorFillQuaternary,
      }}
      items={[
        {
          key: 'result',
          label: (
            <Flex align="center" gap={6} style={{ minWidth: 0 }}>
              <ToolIconBox icon={<CheckCircleOutlined />} color={token.colorSuccess} />
              <Text strong style={{ fontSize: 'var(--nb-text-sm)', flexShrink: 0 }}>{toolName}</Text>
              {summary ? (
                <Text
                  type="secondary"
                  ellipsis
                  style={{ fontSize: 'var(--nb-text-2xs)', flex: 1, minWidth: 0 }}
                >
                  {summary}
                </Text>
              ) : null}
            </Flex>
          ),
          children: (
            <pre className="tool-result-json-block" style={codeStyle}>
              {previewContent}
            </pre>
          ),
        },
      ]}
    />
  )
}

/* ── Reasoning / Thinking block ── */
function ReasoningBlock({ content }: { content: string }) {
  const { token } = theme.useToken()

  return (
    <Collapse
      ghost
      size="small"
      defaultActiveKey={[]}
      items={[
        {
          key: 'reasoning',
          label: (
            <Flex align="center" gap={6}>
              <span style={{ fontSize: 14 }}>💭</span>
              <Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>深度思考</Text>
              <Text type="secondary" style={{ fontSize: 'var(--nb-text-2xs)' }}>
                {content.length > 200 ? `${Math.ceil(content.length / 100) * 100}+ 字` : ''}
              </Text>
            </Flex>
          ),
          children: (
            <div
              className="reasoning-content-block"
              style={{
                fontSize: 'var(--nb-text-sm)',
                color: token.colorTextSecondary,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 400,
                overflowY: 'auto',
                padding: '8px 12px',
                borderRadius: 8,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              {content}
            </div>
          ),
        },
      ]}
      style={{
        borderRadius: 10,
        border: `1px solid color-mix(in srgb, ${token.colorPrimary} 15%, transparent)`,
        background: `color-mix(in srgb, ${token.colorPrimary} 4%, transparent)`,
      }}
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
  const hasReasoningContent = Boolean(String(message.reasoningContent || '').trim())
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
              styles={{
                item: {
                  padding: '6px 10px',
                  borderRadius: '8px',
                  transition: 'all 0.2s ease',
                },
              }}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
                gap: '2px',
              }}
            />
          )}
        </Flex>
      ) : null}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {hasReasoningContent && message.role === 'assistant' ? (
        <ReasoningBlock content={String(message.reasoningContent)} />
      ) : null}

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
