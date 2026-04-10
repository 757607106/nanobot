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
  assistantLoadingCopy = '正在组织回复与工具执行结果...',
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
  const toolResults = (message as any)._toolResults as ChatMessage[] | undefined

  if (message.role === 'tool') {
    return <div style={{ display: 'none' }} />
  }

  const subMessages: ChatMessage[] = (message as any)._subMessages || [message]

  // Group tool results into their preceding assistant segment to form atomic turns
  const segments: Array<ChatMessage & { _toolResults: ChatMessage[] }> = []
  for (const subMsg of subMessages) {
    if (subMsg.role === 'tool') {
      const lastSeg = segments[segments.length - 1]
      if (lastSeg) {
        lastSeg._toolResults.push(subMsg)
      } else {
        segments.push({ role: 'assistant', content: '', _toolResults: [subMsg] })
      }
    } else {
      segments.push({ ...subMsg, _toolResults: [] })
    }
  }

  const showPlaceholderCopy =
    !Boolean(String(message.content || '').trim()) &&
    message.role === 'assistant' &&
    isStreaming

  // We rely on segments mapping for completed tools (which have rich outputs).
  // For tools that are currently executing (loading), we retain them in progressSteps.
  const generalProgressSteps = progressSteps.filter(step => step.kind !== 'tool' || !step.completed)
  const generalChainItems = buildThoughtChainItems(generalProgressSteps, info.status).map(item => ({
    ...item,
    description: undefined,
  }))

  return (
    <Flex vertical gap={12}>
      {segments.map((seg, index) => {
        const hasReasoning = Boolean(seg.reasoningContent)
        const hasToolCalls = Boolean(seg.toolCalls && seg.toolCalls.length > 0)
        const isLastSegment = index === segments.length - 1

        const toolChainItems: ThoughtChainItemType[] = []

        if (hasToolCalls) {
          seg.toolCalls!.forEach((t, tIndex) => {
            const name = getToolCallName(t)
            const resultMsg = seg._toolResults.find(r => r.toolCallId === t.id) || seg._toolResults[tIndex]
            
            const meta = getToolUIMeta(name, !!resultMsg)

            toolChainItems.push({
              key: `tc-${index}-${t.id || tIndex}`,
              title: meta.title,
              icon: meta.icon,
              status: resultMsg ? 'success' : 'loading',
              collapsible: true, // Natively expand tool args & results using Ant Design X standard!
              content: (
                <Flex vertical gap="small">
                  <XMarkdown content={`**输入参数:**\n\`\`\`json\n${formatToolArgumentsBlock(t)}\n\`\`\``} />
                  {resultMsg && (
                    <XMarkdown content={`**返回结果:**\n\`\`\`json\n${truncateContent(formatResultContent(String(resultMsg.content || '')))}\n\`\`\``} />
                  )}
                </Flex>
              ),
            })
          })
        } else if (seg._toolResults.length > 0) {
          // Fallback if tools were executed without a matching toolCall entry
          seg._toolResults.forEach((r, rIndex) => {
            const name = r.name || '未知工具'
            const meta = getToolUIMeta(name, true)

            toolChainItems.push({
              key: `tr-orphan-${index}-${rIndex}`,
              title: meta.title,
              icon: meta.icon,
              status: 'success',
              collapsible: true,
              content: <XMarkdown content={`\`\`\`json\n${truncateContent(formatResultContent(String(r.content || '')))}\n\`\`\``} />,
            })
          })
        }

        return (
          <React.Fragment key={`segment-${seg.id || index}`}>
            {hasReasoning && (
              <Think loading={isStreaming && isLastSegment} title="深度思考">
                <MarkdownBubble
                  content={String(seg.reasoningContent)}
                  isStreaming={isStreaming && isLastSegment}
                />
              </Think>
            )}

            {toolChainItems.length > 0 && (
              <ThoughtChain
                items={toolChainItems}
                style={{
                  background: token.colorFillQuaternary,
                  padding: '12px 16px',
                  borderRadius: 10,
                  marginTop: hasReasoning ? 4 : 0,
                }}
              />
            )}
          </React.Fragment>
        )
      })}

      {generalChainItems.length > 0 && (
        <ThoughtChain
          items={generalChainItems}
          style={{
            background: token.colorFillQuaternary,
            padding: '12px 16px',
            borderRadius: 10,
          }}
        />
      )}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {/* Aggregate any final actual text contents across segments */}
      {(() => {
        const fullContent = segments
          .filter(s => s.role === 'assistant' || s.role === 'user')
          .map(s => s.content)
          .join('\n')
          .trim()
        
        if (fullContent) {
          return <MarkdownBubble content={fullContent} isStreaming={isStreaming} />
        }
        if (showPlaceholderCopy) {
          return <Text type="secondary">{assistantLoadingCopy}</Text>
        }
        return null
      })()}
    </Flex>
  )
}
