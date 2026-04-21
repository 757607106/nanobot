import type { ComponentRef } from 'react'
import { useEffect, useRef } from 'react'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Bubble, Welcome } from '@ant-design/x'
import type { BubbleItemType } from '@ant-design/x'
import { Avatar, Button, Flex, Space, Spin, Typography, theme } from 'antd'
import { ReloadOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons'
import { ChatMessageBody, getChatMessageTitle } from './chatPresentation'
import { normalizeChatMessage } from './chatMessageUtils'
import { formatDateTimeZh } from '../locale'
import { testIds } from '../testIds'
import type { ChatMessage } from '../types'

const { Text } = Typography

function getMessageStatusLabel(status: MessageInfo<ChatMessage>['status']) {
  if (status === 'loading' || status === 'updating') {
    return '生成中'
  }
  if (status === 'error') {
    return '回复失败'
  }
  if (status === 'abort') {
    return '已停止生成'
  }
  return '助手回复'
}

export interface ChatMessagesProps {
  messageInfos: MessageInfo<ChatMessage>[]
  currentSessionId: string | null
  isRequesting: boolean
  isLoadingMessages: boolean
  assistantLabel: string
  quickPrompts?: string[]
  onReloadMessage: (messageId: string | number) => void
  onQuickPromptClick: (prompt: string) => void
  isDesktopLayout: boolean
}

export function ChatMessages({
  messageInfos,
  currentSessionId,
  isRequesting,
  isLoadingMessages,
  assistantLabel,
  quickPrompts,
  onReloadMessage,
  onQuickPromptClick,
  isDesktopLayout,
}: ChatMessagesProps) {
  const { token } = theme.useToken()
  const historyRef = useRef<HTMLDivElement | null>(null)
  const prevSessionRef = useRef<string | null | undefined>(undefined)

  // 切换会话或历史消息加载完毕后，自动滚动到底部
  useEffect(() => {
    const sessionChanged = prevSessionRef.current !== currentSessionId
    prevSessionRef.current = currentSessionId

    if (isLoadingMessages) return
    if (!messageInfos.length) return

    // 使用 rAF 确保 DOM 已渲染完毕
    requestAnimationFrame(() => {
      const container = historyRef.current
      if (container) {
        container.scrollTop = container.scrollHeight
      }
    })
  }, [currentSessionId, isLoadingMessages, messageInfos.length])

  const groupedMessageInfos: MessageInfo<ChatMessage>[] = []
  let currentAssistant: MessageInfo<ChatMessage> | null = null

  // Pre-process messages to group all consecutive 'assistant' and 'tool' records into a single 'assistant' message.
  // This matches the live-streaming visual where an entire agent loop shares one unified Bubble.
  for (const info of messageInfos) {
    if (info.message.role === 'assistant') {
      if (currentAssistant) {
        // Instead of string concatenation, we preserve the distinct sub-messages
        ;(currentAssistant.message as any)._subMessages.push(info.message)
      } else {
        currentAssistant = { ...info, message: { ...info.message, _subMessages: [info.message] } as any }
        groupedMessageInfos.push(currentAssistant)
      }
    } else if (info.message.role === 'tool') {
      if (currentAssistant) {
        ;(currentAssistant.message as any)._subMessages.push(info.message)
      } else {
        groupedMessageInfos.push(info)
      }
    } else {
      currentAssistant = null
      groupedMessageInfos.push(info)
    }
  }

  const bubbleItems: BubbleItemType[] = groupedMessageInfos.map((info) => {
    const item = normalizeChatMessage(info.message)
    const isUser = item.role === 'user'
    const isAssistant = item.role === 'assistant'
    const isTool = item.role === 'tool'
    const canReload = isAssistant && !isRequesting

    let background = token.colorBgContainer
    let borderColor = token.colorBorderSecondary
    let color = token.colorText

    if (isUser) {
      background = token.colorFillAlter
      borderColor = token.colorBorder
      color = token.colorText
    } else if (isTool) {
      background = 'transparent'
      borderColor = 'transparent'
    }

    if (info.status === 'error') {
      borderColor = token.colorError
    } else if (info.status === 'abort') {
      borderColor = token.colorWarning
    }

    return {
      key: info.id,
      role: isUser ? 'user' : isTool ? 'system' : 'ai',
      placement: isUser ? 'end' : 'start',
      loading:
        isAssistant &&
        (info.status === 'loading' || info.status === 'updating') &&
        !(item.progressSteps?.length || item.content),
      avatar: isTool ? (
        <div style={{ width: 32, height: 32, visibility: 'hidden' }} />
      ) : (
        <Avatar
          icon={isUser ? <UserOutlined /> : <RobotOutlined />}
          style={{
            background: isUser ? token.colorPrimary : token.colorBgContainer,
            color: isUser ? token.colorTextLightSolid : token.colorText,
            boxShadow: token.boxShadow,
          }}
        />
      ),
      variant: 'borderless', // custom defined via styles
      shape: 'round',
      classNames: {
        content: [
          'chat-bubble-content',
          isUser ? 'chat-bubble-content-user' : '',
          isAssistant ? 'chat-bubble-content-assistant' : '',
          isTool ? 'chat-bubble-content-tool' : '',
        ]
          .filter(Boolean)
          .join(' '),
      },
      styles: {
        content: {
          borderRadius: isTool ? 12 : 20,
          padding: isTool ? '4px 0' : isUser ? '10px 16px' : (isDesktopLayout ? '16px 20px' : '14px 18px'),
          background,
          border: isTool ? 'none' : `1px solid ${borderColor}`,
          color,
          boxShadow: isUser ? token.boxShadowSecondary : isTool ? 'none' : token.boxShadow,
          backdropFilter: isUser ? 'none' : isTool ? 'none' : 'blur(28px) saturate(140%)',
        },
        header: {
          marginBottom: isTool ? 0 : 8,
        },
        footer: {
          marginTop: isTool ? 0 : 8,
        },
      },
      header: isTool ? null : (
        <Flex justify="space-between" gap={12} wrap="wrap">
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {getChatMessageTitle(item, { assistantLabel })}
          </Text>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {item.createdAt ? formatDateTimeZh(item.createdAt) : '刚刚'}
          </Text>
        </Flex>
      ),
      footer: isAssistant ? (
        <Space size={12} wrap>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {getMessageStatusLabel(info.status)}
          </Text>
          {canReload ? (
            <Button
              type="link"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => onReloadMessage(info.id)}
            >
              重新生成
            </Button>
          ) : null}
        </Space>
      ) : null,
      content: <ChatMessageBody info={info} />,
    }
  })

  return (
    <div ref={historyRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: isDesktopLayout ? '20px 24px 12px' : '16px 16px 12px' }}>
      {isLoadingMessages ? (
        <Flex align="center" justify="center" style={{ minHeight: 280 }}>
          <Spin />
        </Flex>
      ) : messageInfos.length === 0 ? (
        <Flex vertical align="center" justify="center" gap={16} style={{ minHeight: '100%', padding: 24 }}>
          <Welcome
            variant="borderless"
            title={assistantLabel}
            description="有什么想聊的或者需要帮忙的吗？"
          />
        </Flex>
      ) : (
        <div data-testid={testIds.chat.bubbleList}>
          <Bubble.List items={bubbleItems} className="chat-bubble-list" autoScroll />
        </div>
      )}
    </div>
  )
}

export type ChatMessagesRef = ComponentRef<typeof ChatMessages>
