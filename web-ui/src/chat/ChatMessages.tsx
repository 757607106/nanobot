import type { ComponentProps, ComponentRef } from 'react'
import { useRef } from 'react'
import type { MessageInfo } from '@ant-design/x-sdk'
import { Bubble } from '@ant-design/x'
import { Button, Card, Empty, Flex, Space, Spin, Typography, theme } from 'antd'
import { ReloadOutlined, RobotOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons'
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
  const surfaceRadius = token.borderRadiusLG + 8

  const bubbleItems: ComponentProps<typeof Bubble.List>['items'] = messageInfos.map((info) => {
    const item = normalizeChatMessage(info.message)
    const isUser = item.role === 'user'
    const isAssistant = item.role === 'assistant'
    const isTool = item.role === 'tool'
    const canReload = isAssistant && !isRequesting

    let background = token.colorBgElevated
    let borderColor = token.colorBorderSecondary
    let color = token.colorText

    if (isUser) {
      background = `linear-gradient(135deg, ${token.colorPrimary}, ${token.colorInfo})`
      borderColor = token.colorPrimaryBorder
      color = token.colorWhite
    } else if (isTool) {
      background = token.colorFillTertiary
      borderColor = token.colorBorder
    }

    if (info.status === 'error') {
      borderColor = token.colorErrorBorder
    } else if (info.status === 'abort') {
      borderColor = token.colorWarningBorder
    }

    return {
      key: info.id,
      placement: isUser ? 'end' : 'start',
      loading:
        isAssistant &&
        (info.status === 'loading' || info.status === 'updating') &&
        !(item.progressSteps?.length || item.content),
      avatar: {
        icon: isUser ? <UserOutlined /> : isTool ? <ToolOutlined /> : <RobotOutlined />,
        style: {
          background: isUser ? token.colorPrimary : isTool ? token.colorWarning : token.colorInfo,
          color: token.colorWhite,
        },
      },
      variant: isUser ? 'filled' : isTool ? 'outlined' : 'shadow',
      shape: 'corner',
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
          borderRadius: surfaceRadius,
          padding: isDesktopLayout ? '16px 18px' : '14px 16px',
          background,
          border: `1px solid ${borderColor}`,
          color,
          boxShadow: isUser ? token.boxShadowSecondary : token.boxShadowTertiary,
        },
        header: {
          marginBottom: 8,
        },
        footer: {
          marginTop: 8,
        },
      },
      header: (
        <Flex justify="space-between" gap={12} wrap="wrap">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {getChatMessageTitle(item, { assistantLabel })}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {item.createdAt ? formatDateTimeZh(item.createdAt) : '刚刚'}
          </Text>
        </Flex>
      ),
      footer: isAssistant ? (
        <Space size={12} wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>
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
      ) : isTool ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          工具结果
        </Text>
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
          <Empty
            description={
              currentSessionId
                ? '发送第一条消息，开始这轮协作。'
                : '新建会话后，即可开始提问或上传文件。'
            }
          />
          {quickPrompts?.length ? (
            <Space wrap>
              {quickPrompts.slice(0, 4).map((prompt) => (
                <Button
                  key={prompt}
                  onClick={() => onQuickPromptClick(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </Space>
          ) : null}
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
