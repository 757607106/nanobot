import type { CSSProperties, ReactNode } from 'react'
import React from 'react'
import {
  ApiOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  CloseCircleOutlined,
  CodeOutlined,
  FileSearchOutlined,
  FunctionOutlined,
  SearchOutlined,
  SyncOutlined,
  ToolOutlined,
  GlobalOutlined,
  FileTextOutlined,
  LoadingOutlined,
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

interface ToolUIMap {
  activeTitle: string
  successTitle: string
  activeIcon: ReactNode
  successIcon: ReactNode
}

const TOOL_UI_MAPPING: Record<string, ToolUIMap> = {
  web_search: {
    activeTitle: '正在进行全网检索',
    successTitle: '完成网络信息收集',
    activeIcon: <GlobalOutlined spin />,
    successIcon: <CheckCircleFilled style={{ color: 'var(--nb-success)' }} />
  },
  web_fetch: {
    activeTitle: '正在深度阅读网页',
    successTitle: '网页阅读完毕',
    activeIcon: <FileTextOutlined spin />,
    successIcon: <CheckCircleFilled style={{ color: 'var(--nb-success)' }} />
  },
  create_file: {
    activeTitle: '正在创建本地文件',
    successTitle: '文件创建完毕',
    activeIcon: <CodeOutlined spin />,
    successIcon: <CheckCircleFilled style={{ color: 'var(--nb-success)' }} />
  },
  run_command: {
    activeTitle: '正在运行系统命令',
    successTitle: '命令执行完毕',
    activeIcon: <FunctionOutlined spin />,
    successIcon: <CheckCircleFilled style={{ color: 'var(--nb-success)' }} />
  }
}

function getToolUIMeta(toolName: string, isSuccess: boolean) {
  const meta = TOOL_UI_MAPPING[toolName]
  if (meta) {
    return {
      title: isSuccess ? meta.successTitle : meta.activeTitle,
      icon: isSuccess ? meta.successIcon : meta.activeIcon
    }
  }
  return {
    title: isSuccess ? `${toolName} 执行完毕` : `调用专属工具: ${toolName}`,
    icon: isSuccess ? <CheckCircleFilled style={{ color: 'var(--nb-success)' }} /> : <LoadingOutlined />
  }
}

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

/**
 * Automatically expands the 'Think' component while loading, and collapses it when finished.
 * This aligns with SOTA deep reasoning UX paradigms.
 */
function AutoThinkBlock({ loading, content }: { loading: boolean; content: string }) {
  const [expanded, setExpanded] = React.useState(loading)

  React.useEffect(() => {
    setExpanded(loading)
  }, [loading])

  return (
    <Think
      loading={loading}
      title="深度思考"
      expanded={expanded}
      onExpand={setExpanded}
    >
      <MarkdownBubble content={content} isStreaming={loading} />
    </Think>
  )
}

/* ── 工具图标 Badge ── */
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

export function ChatMessageBody({
  info,
  assistantLoadingCopy = '生成中...',
  showToolCalls = true,
}: {
  info: MessageInfo<ChatMessage>
  assistantLoadingCopy?: string
  showToolCalls?: boolean
}) {
  const { token } = theme.useToken()
  const codeStyle = useCodeBlockStyle()
  const message = normalizeChatMessage(info.message)
  const progressSteps = message.progressSteps ?? []
  const isStreaming = info.status === 'loading' || info.status === 'updating'

  if (message.role === 'tool') {
    return <div style={{ display: 'none' }} />
  }

  const subMessages: ChatMessage[] = (message as any)._subMessages || [message]

  // For grouped messages (loaded from server history), the primary message only has
  // the first LLM iteration's data. Aggregate content/reasoning from all sub-messages.
  let effectiveContent = message.content || ''
  let effectiveReasoning = message.reasoningContent || ''

  if (subMessages.length > 1) {
    // Aggregate reasoning from all assistant sub-messages
    const allReasoning = subMessages
      .filter(m => m.role === 'assistant' && m.reasoningContent)
      .map(m => m.reasoningContent!)
      .join('')
    if (allReasoning.length > effectiveReasoning.length) {
      effectiveReasoning = allReasoning
    }

    // Find content from the last assistant sub-message (the final answer)
    if (!effectiveContent.trim()) {
      const lastAssistantWithContent = [...subMessages]
        .reverse()
        .find(m => m.role === 'assistant' && m.content?.trim())
      if (lastAssistantWithContent) {
        effectiveContent = lastAssistantWithContent.content || ''
      }
    }
  }

  const showPlaceholderCopy =
    !Boolean(effectiveContent.trim()) &&
    message.role === 'assistant' &&
    isStreaming

  // 构建交替 ThoughtChain
  const unifiedItems: ThoughtChainItemType[] = []

  if (progressSteps.length > 0) {
    // 路径 A: 从流式 progressSteps 构建（streaming / sync 后保留的数据）
    for (const step of progressSteps) {
      if (step.kind === 'thinking') {
        unifiedItems.push({
          key: step.key,
          title: '深度思考',
          icon: <CheckCircleFilled style={{ color: 'var(--nb-success)' }} />,
          status: 'success',
          collapsible: true,
          content: (
            <MarkdownBubble content={step.reasoningContent || ''} isStreaming={false} />
          ),
        })
      } else if (step.kind === 'tool') {
        const toolBaseName = step.label?.split(':')[0]?.trim() || 'tool'
        const meta = getToolUIMeta(toolBaseName, !!step.completed)
        unifiedItems.push({
          key: step.key,
          title: meta.title,
          icon: step.completed ? meta.icon : <SyncOutlined spin style={{ color: 'var(--nb-primary)' }} />,
          status: step.completed ? 'success' : 'loading',
          ...(step.completed && step.resultContent ? {
            collapsible: true,
            content: (
              <MarkdownBubble content={step.resultContent} isStreaming={false} />
            ),
          } : {}),
        })
      } else if (step.kind === 'progress') {
        unifiedItems.push({
          key: step.key,
          title: step.label || '处理中',
          icon: <SyncOutlined spin style={{ color: 'var(--nb-primary)' }} />,
          status: 'loading',
        })
      }
    }

    // 当前正在流式输出的思考（还没遇到 toolHint 快照）
    const prevSnapshotEnd = progressSteps
      .filter(s => s.kind === 'thinking')
      .reduce((acc, s) => acc + (s.reasoningContent?.length || 0), 0)
    const currentThinking = effectiveReasoning.slice(prevSnapshotEnd)
    if (currentThinking) {
      unifiedItems.push({
        key: 'thinking-current',
        title: '深度思考',
        icon: isStreaming ? <SyncOutlined spin style={{ color: 'var(--nb-primary)' }} /> : <CheckCircleFilled style={{ color: 'var(--nb-success)' }} />,
        status: isStreaming ? 'loading' : 'success',
        collapsible: !isStreaming,
        content: (
          <MarkdownBubble content={currentThinking} isStreaming={isStreaming} />
        ),
      })
    }
  } else if (subMessages.length > 1) {
    // 路径 B: 从 sub-messages 构建（页面刷新加载历史，无 progressSteps）
    // Pre-collect tool results by toolCallId for matching
    const toolResultMap = new Map<string, string>()
    for (const subMsg of subMessages) {
      if (subMsg.role === 'tool' && subMsg.toolCallId) {
        toolResultMap.set(String(subMsg.toolCallId), String(subMsg.content || ''))
      }
    }

    for (const subMsg of subMessages) {
      if (subMsg.role !== 'assistant') continue
      // 思考
      if (subMsg.reasoningContent?.trim()) {
        unifiedItems.push({
          key: `hist-thinking-${unifiedItems.length}`,
          title: '深度思考',
          icon: <CheckCircleFilled style={{ color: 'var(--nb-success)' }} />,
          status: 'success',
          collapsible: true,
          content: (
            <MarkdownBubble content={subMsg.reasoningContent} isStreaming={false} />
          ),
        })
      }
      // 工具调用 + 匹配返回结果
      if (subMsg.toolCalls?.length) {
        for (const toolCall of subMsg.toolCalls) {
          const toolName = getToolCallName(toolCall)
          const meta = getToolUIMeta(toolName, true)
          const toolCallId = String(toolCall.id || '').trim()
          const resultContent = toolCallId ? toolResultMap.get(toolCallId) : undefined

          unifiedItems.push({
            key: `hist-tool-${unifiedItems.length}`,
            title: meta.title,
            icon: meta.icon,
            status: 'success',
            ...(resultContent ? {
              collapsible: true,
              content: (
                <MarkdownBubble content={resultContent} isStreaming={false} />
              ),
            } : {}),
          })
        }
      }
    }
  } else {
    // 路径 C: 单条消息，无 sub-messages，无 progressSteps（简单回复或无工具）
    if (effectiveReasoning.trim()) {
      unifiedItems.push({
        key: 'thinking-current',
        title: '深度思考',
        icon: isStreaming ? <SyncOutlined spin style={{ color: 'var(--nb-primary)' }} /> : <CheckCircleFilled style={{ color: 'var(--nb-success)' }} />,
        status: isStreaming ? 'loading' : 'success',
        collapsible: !isStreaming,
        content: (
          <MarkdownBubble content={effectiveReasoning} isStreaming={isStreaming} />
        ),
      })
    }
  }

  return (
    <Flex vertical gap={12}>
      {unifiedItems.length > 0 && (
        <ThoughtChain
          items={unifiedItems}
          style={{
            background: token.colorFillQuaternary,
            padding: '12px 16px',
            borderRadius: 10,
          }}
        />
      )}

      {effectiveContent.trim() && (
        <MarkdownBubble
          content={effectiveContent.trim()}
          isStreaming={isStreaming}
        />
      )}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {showPlaceholderCopy && unifiedItems.length === 0 && (
        <Text type="secondary">{assistantLoadingCopy}</Text>
      )}
    </Flex>
  )
}
