import type { CSSProperties, ReactNode } from 'react'
import React from 'react'
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  FileSearchOutlined,
  FunctionOutlined,
  SearchOutlined,
  SyncOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { Mermaid, ThoughtChain, Think, FileCard } from '@ant-design/x'
import type { ThoughtChainItemType } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Collapse, Flex, Typography, theme } from 'antd'
import type { ComponentProps as XMarkdownComponentProps } from '@ant-design/x-markdown'
import { XMarkdown } from '@ant-design/x-markdown'
import { formatDateTimeZh } from '../locale'
import type { ChatAttachmentRef, ChatMessage, ChatToolCall } from '../types'
import { getToolCallName, normalizeChatMessage } from './chatMessageUtils'

const { Text } = Typography

const TOOL_RESULT_PREVIEW_LIMIT = 1400


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

function buildThoughtChainItems(
  steps: ChatMessage['progressSteps'],
  status: MessageInfo<ChatMessage>['status'],
): ThoughtChainItemType[] {
  const progressSteps = steps ?? []
  const isActive = status === 'loading' || status === 'updating'
  const isFailed = status === 'error' || status === 'abort'

  return progressSteps.map((step, index) => {
    const isLast = index === progressSteps.length - 1
    let itemStatus: ThoughtChainItemType['status'] = 'success'

    if (step.completed) {
      // 后端已确认该工具执行完毕，直接标记成功
      itemStatus = 'success'
    } else if (isActive) {
      itemStatus = isLast ? 'loading' : 'success'
    } else if (isFailed) {
      itemStatus = isLast ? 'error' : 'success'
    }

    return {
      key: step.key,
      icon: getStepIcon(step.kind, itemStatus),
      title: step.label,
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
  if (block && lang === 'mermaid' && children) {
    if (streamStatus !== 'done') {
      return <code {...rest} className={htmlClass}>{children}</code>
    }
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

const XMARKDOWN_COMPONENTS: Record<string, React.ComponentType<XMarkdownComponentProps>> = {
  code: CodeBlockComponent as unknown as React.ComponentType<XMarkdownComponentProps>,
}

/* ── Markdown 渲染 ── */
function MarkdownBubble({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="markdown-bubble">
      <XMarkdown
        content={content}
        streaming={isStreaming ? { hasNextChunk: true } : undefined}
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
  if (!attachments.length) {
    return null
  }

  return (
    <FileCard.List
      size="small"
      overflow="wrap"
      removable={removable}
      onRemove={(item) => {
        if (item.id) {
          onRemove?.(item.id)
        }
      }}
      items={attachments.map((item) => ({
        id: item.relativePath,
        key: item.relativePath,
        name: getAttachmentName(item),
      }))}
    />
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
function ToolCallCards({ toolCalls, toolResults }: { toolCalls: ChatToolCall[], toolResults?: ChatMessage[] }) {
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
          // match result by tool_call_id or sequence natively
          const resultMsg = toolResults?.find(r => r.toolCallId === toolCall.id) || toolResults?.[index]
          const fullResult = resultMsg ? String(resultMsg.content || '') : ''
          const resultPreview = fullResult ? truncateContent(formatResultContent(fullResult)) : ''
          const resultSummary = resultMsg ? getResultSummary(fullResult) : ''

          return {
            key: `${name}-${index}`,
            label: (
              <Flex align="center" gap={6} style={{ minWidth: 0 }}>
                {resultMsg ? (
                  <ToolIconBox icon={<CheckCircleOutlined />} color={token.colorSuccess} />
                ) : (
                  <ToolIconBox icon={getToolIcon(name)} color={token.colorPrimary} />
                )}
                <Text strong style={{ fontSize: 'var(--nb-text-sm)', flexShrink: 0 }}>{name}</Text>
                <Text
                  type="secondary"
                  ellipsis
                  style={{ fontSize: 'var(--nb-text-2xs)', flex: 1, minWidth: 0 }}
                >
                  {resultMsg && resultSummary ? resultSummary : getToolArgumentsPreview(toolCall)}
                </Text>
              </Flex>
            ),
            children: (
              <Flex vertical gap={8}>
                {resultMsg ? (
                  <Flex vertical gap={4}>
                    <Text type="secondary" style={{ fontSize: 'var(--nb-text-2xs)' }}>返回结果</Text>
                    <pre className="tool-result-json-block" style={{ ...codeStyle, maxHeight: 200 }}>
                      {resultPreview}
                    </pre>
                  </Flex>
                ) : (
                  <Flex vertical gap={4}>
                    <Text type="secondary" style={{ fontSize: 'var(--nb-text-2xs)' }}>调用参数</Text>
                    <pre className="tool-call-json-block" style={{ ...codeStyle, maxHeight: 200 }}>
                      {formatToolArgumentsBlock(toolCall)}
                    </pre>
                  </Flex>
                )}
              </Flex>
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

export function ChatMessageBody({
  info,
  assistantLoadingCopy = '正在组织回复与工具执行结果...',
  showToolCalls = true,
}: {
  info: MessageInfo<ChatMessage>
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
              key: 'progress',
              label: (
                <Flex align="center" gap={6} style={{ minWidth: 0 }}>
                  <ToolIconBox 
                    icon={info.status === 'loading' || info.status === 'updating' ? <SyncOutlined spin /> : <CheckCircleOutlined />} 
                    color={info.status === 'loading' || info.status === 'updating' ? token.colorPrimary : token.colorSuccess} 
                  />
                  <Text strong style={{ fontSize: 'var(--nb-text-sm)', flexShrink: 0 }}>执行脉络</Text>
                  <Text type="secondary" ellipsis style={{ fontSize: 'var(--nb-text-2xs)', flex: 1, minWidth: 0 }}>
                    {progressSteps[progressSteps.length - 1]?.label || '处理中...'}
                  </Text>
                </Flex>
              ),
              children: (
                <ThoughtChain
                  items={buildThoughtChainItems(progressSteps, info.status).map(item => ({
                    ...item,
                    description: undefined // 移除过于臃肿的二级描述
                  }))}
                  styles={{
                    item: {
                      padding: '4px 0',
                    },
                  }}
                  style={{
                    padding: '0 8px 8px 8px',
                    gap: 0,
                  }}
                />
              ),
            },
          ]}
        />
      ) : null}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {hasReasoningContent && message.role === 'assistant' ? (
        <Think loading={isStreaming} title="深度思考">
          <MarkdownBubble
            content={String(message.reasoningContent)}
            isStreaming={isStreaming}
          />
        </Think>
      ) : null}

      {hasMessageContent ? (
        <MarkdownBubble
          content={String(message.content ?? '')}
          isStreaming={message.role === 'assistant' && isStreaming}
        />
      ) : showPlaceholderCopy ? (
        <Text type="secondary">{assistantLoadingCopy}</Text>
      ) : null}

      {showToolCalls && message.role === 'assistant' ? (
        <ToolCallCards 
          toolCalls={message.toolCalls || []} 
          toolResults={(message as any)._toolResults as ChatMessage[] | undefined} 
        />
      ) : null}
    </Flex>
  )
}
