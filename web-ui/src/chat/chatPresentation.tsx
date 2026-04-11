import type { ReactNode } from 'react'
import React from 'react'
import {
  CodeOutlined,
  FunctionOutlined,
  SyncOutlined,
  ToolOutlined,
  GlobalOutlined,
  FileTextOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import { Mermaid, ThoughtChain, Think, FileCard } from '@ant-design/x'
import type { ThoughtChainItemType } from '@ant-design/x'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Flex, Typography, theme } from 'antd'
import type { ComponentProps as XMarkdownComponentProps } from '@ant-design/x-markdown'
import { XMarkdown } from '@ant-design/x-markdown'
import type { ChatAttachmentRef, ChatMessage } from '../types'
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
    successIcon: <GlobalOutlined style={{ color: 'var(--nb-text-tertiary)' }} />
  },
  web_fetch: {
    activeTitle: '正在深度阅读网页',
    successTitle: '网页阅读完毕',
    activeIcon: <FileTextOutlined spin />,
    successIcon: <FileTextOutlined style={{ color: 'var(--nb-text-tertiary)' }} />
  },
  create_file: {
    activeTitle: '正在创建本地文件',
    successTitle: '文件创建完毕',
    activeIcon: <CodeOutlined spin />,
    successIcon: <CodeOutlined style={{ color: 'var(--nb-text-tertiary)' }} />
  },
  run_command: {
    activeTitle: '正在运行系统命令',
    successTitle: '命令执行完毕',
    activeIcon: <FunctionOutlined spin />,
    successIcon: <FunctionOutlined style={{ color: 'var(--nb-text-tertiary)' }} />
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
    icon: isSuccess ? <ToolOutlined style={{ color: 'var(--nb-text-tertiary)' }} /> : <LoadingOutlined />
  }
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

  // 构建交替渲染段落：Think 组件 + ThoughtChain 工具组
  type RenderSegment =
    | { type: 'think'; key: string; content: string; loading: boolean; isStreaming: boolean }
    | { type: 'tools'; key: string; items: ThoughtChainItemType[] }

  const segments: RenderSegment[] = []
  let pendingToolItems: ThoughtChainItemType[] = []

  // 将累积的工具项 flush 为一个 tools segment
  const flushTools = () => {
    if (pendingToolItems.length > 0) {
      segments.push({ type: 'tools', key: `tools-${segments.length}`, items: pendingToolItems })
      pendingToolItems = []
    }
  }

  if (progressSteps.length > 0) {
    // 路径 A: 从流式 progressSteps 构建
    for (const step of progressSteps) {
      if (step.kind === 'thinking') {
        flushTools()
        segments.push({
          type: 'think',
          key: step.key,
          content: step.reasoningContent || '',
          loading: false,
          isStreaming: false,
        })
      } else if (step.kind === 'tool') {
        const toolBaseName = step.label?.split(':')[0]?.trim() || 'tool'
        const meta = getToolUIMeta(toolBaseName, !!step.completed)
        pendingToolItems.push({
          key: step.key,
          title: meta.title,
          icon: step.completed ? meta.icon : <LoadingOutlined style={{ color: 'var(--nb-primary)' }} />,
          status: step.completed ? 'success' : 'loading',
          ...(step.completed && step.resultContent ? {
            collapsible: true,
            content: (
              <MarkdownBubble content={step.resultContent} isStreaming={false} />
            ),
          } : {}),
        })
      } else if (step.kind === 'progress') {
        pendingToolItems.push({
          key: step.key,
          title: step.label || '处理中',
          icon: <SyncOutlined spin style={{ color: 'var(--nb-primary)' }} />,
          status: 'loading',
        })
      }
    }
    flushTools()

    // 当前正在流式输出的思考
    const prevSnapshotEnd = progressSteps
      .filter(s => s.kind === 'thinking')
      .reduce((acc, s) => acc + (s.reasoningContent?.length || 0), 0)
    const currentThinking = effectiveReasoning.slice(prevSnapshotEnd)
    if (currentThinking) {
      segments.push({
        type: 'think',
        key: 'thinking-current',
        content: currentThinking,
        loading: isStreaming,
        isStreaming,
      })
    }
  } else if (subMessages.length > 1) {
    // 路径 B: 从 sub-messages 构建（历史消息）
    const toolResultMap = new Map<string, string>()
    for (const subMsg of subMessages) {
      if (subMsg.role === 'tool' && subMsg.toolCallId) {
        toolResultMap.set(String(subMsg.toolCallId), String(subMsg.content || ''))
      }
    }

    for (const subMsg of subMessages) {
      if (subMsg.role !== 'assistant') continue
      if (subMsg.reasoningContent?.trim()) {
        flushTools()
        segments.push({
          type: 'think',
          key: `hist-thinking-${segments.length}`,
          content: subMsg.reasoningContent,
          loading: false,
          isStreaming: false,
        })
      }
      if (subMsg.toolCalls?.length) {
        for (const toolCall of subMsg.toolCalls) {
          const toolName = getToolCallName(toolCall)
          const meta = getToolUIMeta(toolName, true)
          const toolCallId = String(toolCall.id || '').trim()
          const resultContent = toolCallId ? toolResultMap.get(toolCallId) : undefined

          pendingToolItems.push({
            key: `hist-tool-${segments.length}-${pendingToolItems.length}`,
            title: meta.title,
            icon: meta.icon,
            status: 'success',
            description: toolCall.function?.arguments ? (() => {
              const parsed = safeJsonParse(toolCall.function.arguments)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return Object.entries(parsed as Record<string, unknown>)
                  .slice(0, 3)
                  .map(([k, v]) => `${k}: ${typeof v === 'string' ? (v.length > 40 ? v.slice(0, 40) + '...' : v) : JSON.stringify(v)}`)
                  .join(' · ')
              }
              return undefined
            })() : undefined,
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
    flushTools()
  } else {
    // 路径 C: 单消息
    if (effectiveReasoning.trim()) {
      segments.push({
        type: 'think',
        key: 'thinking-current',
        content: effectiveReasoning,
        loading: isStreaming,
        isStreaming,
      })
    }
  }

  return (
    <Flex vertical gap={12}>
      {segments.map((seg) =>
        seg.type === 'think' ? (
          <Think
            key={seg.key}
            title="深度思考"
            loading={seg.loading}
            defaultExpanded={seg.loading}
          >
            <MarkdownBubble content={seg.content} isStreaming={seg.isStreaming} />
          </Think>
        ) : (
          <ThoughtChain
            key={seg.key}
            items={seg.items}
            line
            styles={{
              root: {
                background: token.colorFillQuaternary,
                padding: '12px 16px',
                borderRadius: 10,
              },
            }}
          />
        )
      )}

      {effectiveContent.trim() && (
        <MarkdownBubble
          content={effectiveContent.trim()}
          isStreaming={isStreaming}
        />
      )}

      {message.attachments?.length ? <AttachmentTags attachments={message.attachments} /> : null}

      {showPlaceholderCopy && segments.length === 0 && (
        <Text type="secondary">{assistantLoadingCopy}</Text>
      )}
    </Flex>
  )
}
