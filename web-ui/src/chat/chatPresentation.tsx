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

  const hasRichToolCalls = showToolCalls && message.toolCalls && message.toolCalls.length > 0;

  // 1. 生成层次交织的内部节点：由于大模型的“深度思考”文本与工具调用在逻辑上是先后关联的。
  // 我们通过分析 _iterations（完毕后）或 progressSteps（流式中），将思考过程（Text）紧密分布在具体的工具（ThoughtChain.Item）正上方。
  const innerNodes: React.ReactNode[] = []
  const iterations = (message as any)._iterations as Array<{ reasoningContent?: string; toolCalls?: any[]; _toolResults?: any[] }> | undefined

  const renderElegantToolNode = (toolCall: any, resultMsg: any, uniqueIdx: number) => {
    const fullResult = resultMsg ? String(resultMsg.content || '') : ''
    const resultSummary = resultMsg ? getResultSummary(fullResult) : ''
    
    return (
      <ThoughtChain.Item
        key={`elegant-tool-${uniqueIdx}`}
        variant="solid"
        icon={resultMsg ? <CheckCircleOutlined style={{ color: token.colorSuccess }} /> : <SyncOutlined spin style={{ color: token.colorPrimary }} />}
        title={<Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>执行动作: {getToolCallName(toolCall)}</Text>}
        description={
          <Flex vertical gap={4} style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 'var(--nb-text-2xs)' }}>
              调用参数: {getToolArgumentsPreview(toolCall)}
            </Text>
            {resultMsg && (
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'result',
                    label: <Text type="secondary" style={{ fontSize: 'var(--nb-text-2xs)' }}>返回结果: {resultSummary || '详见返回JSON'}</Text>,
                    children: (
                      <pre className="tool-result-json-block" style={{ ...codeStyle, maxHeight: 300, overflow: 'auto', margin: 0 }}>
                        {truncateContent(formatResultContent(fullResult))}
                      </pre>
                    ),
                  },
                ]}
              />
            )}
          </Flex>
        }
        status={resultMsg ? 'success' : 'loading'}
      />
    )
  }

  if (iterations && iterations.length > 1 && !isStreaming) {
    // 方式 A：流式结束后，使用后端按批次写库的 _iterations 精准还原层次编排
    iterations.forEach((iter, idx) => {
      if (iter.reasoningContent?.trim()) {
        innerNodes.push(
          <Text key={`iter-txt-${idx}`} type="secondary" style={{ whiteSpace: 'pre-wrap', marginBottom: iter.toolCalls?.length ? 4 : 0 }}>
            {iter.reasoningContent}
          </Text>
        )
      }
      iter.toolCalls?.forEach((tc, tIdx) => {
        const resultMsg = iter._toolResults?.find(r => r.toolCallId === tc.id) || iter._toolResults?.[tIdx]
        innerNodes.push(renderElegantToolNode(tc, resultMsg, idx * 1000 + tIdx))
      })
    })
  } else {
    // 方式 B：流式生成中或单循环，利用 progressSteps 产生的事件流进行对齐还原
    let mappedToolIndex = 0
    progressSteps.forEach((step, idx) => {
      if (step.kind === 'progress' && step.label.trim()) {
        innerNodes.push(
          <Text key={`prog-txt-${idx}`} type="secondary" style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>
            {step.label}
          </Text>
        )
      } else if (step.kind === 'tool') {
        const tc = message.toolCalls?.[mappedToolIndex]
        if (tc) {
          const resultMsg = toolResults?.find(r => r.toolCallId === tc.id) || toolResults?.[mappedToolIndex]
          innerNodes.push(renderElegantToolNode(tc, resultMsg, idx))
          mappedToolIndex++
        } else {
          // JSON 参数尚未通过网络全量抵达时的降级占位表示
          innerNodes.push(
            <ThoughtChain.Item
              key={`prog-wait-${idx}`}
              variant="solid"
              icon={<SyncOutlined spin />}
              title={<Text strong>执行动作: {step.label}</Text>}
              status="loading"
            />
          )
        }
      }
    })
    
    // 兜底补齐：如果有未匹配完的挂起 toolCalls，默认排列在最后
    if (message.toolCalls && mappedToolIndex < message.toolCalls.length) {
      for (let i = mappedToolIndex; i < message.toolCalls.length; i++) {
        const tc = message.toolCalls[i]
        const resultMsg = toolResults?.find(r => r.toolCallId === tc.id) || toolResults?.[i]
        innerNodes.push(renderElegantToolNode(tc, resultMsg, 10000 + i))
      }
    }
  }

  // 2. 组装最顶层的单一 ThoughtChain 折叠板（符合官方设计建议，不污染全局排版）
  const chainItems: ThoughtChainItemType[] = []
  if (innerNodes.length > 0) {
    const totalTools = message.toolCalls?.length || 0
    const isAllFinished = toolResults && toolResults.length >= totalTools

    chainItems.push({
      key: 'tool-chain-root',
      icon: isAllFinished && !isStreaming ? <CheckCircleOutlined style={{ color: token.colorSuccess }} /> : <SyncOutlined spin style={{ color: token.colorPrimary }} />,
      title: totalTools > 0 ? '执行动作序列' : '动作思考序列',
      description: totalTools > 0 ? `系统共执行了 ${totalTools} 项工具调用` : '大模型执行思维演练中',
      collapsible: true, // 允许手动折叠
      status: (isAllFinished && !isStreaming) ? 'success' : 'loading',
      content: (
        <Flex gap="small" vertical style={{ padding: '8px 0', marginLeft: '4px' }}>
          {innerNodes}
        </Flex>
      ),
    })
  }

  const hasMessageContent = Boolean(String(message.content || '').trim())
  const hasReasoningContent = message.reasoningContent != null
  const showPlaceholderCopy =
    !hasMessageContent &&
    message.role === 'assistant' &&
    isStreaming

  return (
    <Flex vertical gap={12}>
      {hasReasoningContent && message.role === 'assistant' && chainItems.length === 0 ? (
        <Think loading={isStreaming} title="深度思考">
          <MarkdownBubble
            content={String(message.reasoningContent)}
            isStreaming={isStreaming}
          />
        </Think>
      ) : null}

      {chainItems.length > 0 ? (
        <ThoughtChain
          items={chainItems}
          style={{
            background: token.colorFillQuaternary,
            padding: '12px 16px',
            borderRadius: 10,
          }}
        />
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
    </Flex>
  )
}
