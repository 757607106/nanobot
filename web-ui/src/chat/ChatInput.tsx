import type { ComponentProps, ComponentRef } from 'react'
import React, { forwardRef } from 'react'
import { Attachments, Sender } from '@ant-design/x'
import { Badge, Button, Divider, Flex, Segmented, Switch, Typography, theme } from 'antd'
import { CloudUploadOutlined, CloseOutlined, LinkOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { AttachmentTags } from './chatPresentation'
import { testIds } from '../testIds'
import type { ChatAttachmentRef, ChatUploadItem } from '../types'

const { Text } = Typography

type ComposerAttachment = NonNullable<ComponentProps<typeof Attachments>['items']>[number]

export type ReasoningEffortLevel = 'low' | 'medium' | 'high'

export interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onCancel: () => void
  isRequesting: boolean
  uploadingFiles: boolean
  assistantLabel: string
  pendingAttachments: ComposerAttachment[]
  onPendingAttachmentsChange: (attachments: ComposerAttachment[]) => void
  draftAttachmentRefs: ChatAttachmentRef[]
  onDraftAttachmentRefsChange: (refs: ChatAttachmentRef[]) => void
  dropContainerRef: React.RefObject<HTMLElement | null>
  isDesktopLayout: boolean
  reasoningSupported: boolean
  reasoningEffort: ReasoningEffortLevel | null
  onReasoningEffortChange: (value: ReasoningEffortLevel | null) => void
}

const EFFORT_OPTIONS = [
  { value: 'low' as const, label: '轻度' },
  { value: 'medium' as const, label: '标准' },
  { value: 'high' as const, label: '深入' },
]

export const ChatInput = forwardRef<ComponentRef<typeof Sender>, ChatInputProps>(
  function ChatInput(
    {
      value,
      onChange,
      onSubmit,
      onCancel,
      isRequesting,
      uploadingFiles,
      assistantLabel,
      pendingAttachments,
      onPendingAttachmentsChange,
      draftAttachmentRefs,
      onDraftAttachmentRefsChange,
      dropContainerRef,
      isDesktopLayout,
      reasoningSupported,
      reasoningEffort,
      onReasoningEffortChange,
    },
    ref,
  ) {
    const { token } = theme.useToken()
    const [headerOpen, setHeaderOpen] = React.useState(false)

    // Expand header automatically when sending new files
    React.useEffect(() => {
      if (pendingAttachments.length > 0) {
        setHeaderOpen(true)
      }
    }, [pendingAttachments.length])

    React.useEffect(() => {
      // Clear all created object URLs when the component is unmounted
      return () => {
        pendingAttachments.forEach((item) => {
          if (item.url?.startsWith('blob:')) {
            URL.revokeObjectURL(item.url)
          }
        })
      }
    }, [pendingAttachments])

    const handleAttachmentsChange = ({ file, fileList }: any) => {
      const updatedFileList = fileList.map((item: any) => {
        if (item.uid === file.uid && file.status !== 'removed' && item.originFileObj) {
          // clear URL
          if (item.url?.startsWith('blob:')) {
            URL.revokeObjectURL(item.url)
          }
          // create new preview URL
          return {
            ...item,
            url: URL.createObjectURL(item.originFileObj),
          }
        }
        return item
      })
      onPendingAttachmentsChange(updatedFileList as ComposerAttachment[])
    }

    const thinkingEnabled = reasoningEffort !== null

    const senderHeader = (
      headerOpen ? (
        <div style={{ padding: '0 8px 16px' }}>
          <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: token.fontSizeSM, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              本轮上下文
            </Text>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label="收起上下文"
              onClick={() => setHeaderOpen(false)}
              disabled={uploadingFiles}
            />
          </Flex>
          <Flex vertical gap={8}>
            {draftAttachmentRefs.length > 0 && (
              <Flex vertical gap={4}>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>关联知识与记忆</Text>
                <AttachmentTags
                  attachments={draftAttachmentRefs}
                  removable
                  onRemove={(relativePath) => {
                    onDraftAttachmentRefsChange(
                      draftAttachmentRefs.filter((item) => item.relativePath !== relativePath),
                    )
                  }}
                />
              </Flex>
            )}
            <Attachments
              beforeUpload={() => false}
              items={pendingAttachments}
              onChange={handleAttachmentsChange}
              disabled={uploadingFiles}
              placeholder={(type) =>
                type === 'drop'
                  ? {
                      title: '松开鼠标以添加',
                    }
                  : {
                      icon: <CloudUploadOutlined />,
                      title: '上传附件',
                      description: '点击或拖拽文件到此区域进行上传',
                    }
              }
              getDropContainer={() => dropContainerRef.current}
            />
          </Flex>
        </div>
      ) : null
    )

    const senderFooter = (
      <Flex justify="space-between" align="center" style={{ width: '100%' }}>
        <Flex gap={4} align="center">
          <div style={{ position: 'relative' }}>
            <Badge dot={pendingAttachments.length > 0 && !headerOpen} offset={[-4, 4]}>
              <Button
                type="text"
                size="small"
                aria-label="添加附件"
                onClick={() => setHeaderOpen(!headerOpen)}
                icon={<LinkOutlined />}
                disabled={uploadingFiles}
              />
            </Badge>
          </div>
          <Divider type="vertical" style={{ margin: '0 2px' }} />
          {reasoningSupported && (
            <Flex align="center" gap={6} style={{
              padding: '4px 4px 4px 12px',
              borderRadius: 24,
              background: thinkingEnabled ? `color-mix(in srgb, ${token.colorPrimary} 6%, transparent)` : 'transparent',
              border: `1px solid ${thinkingEnabled ? `color-mix(in srgb, ${token.colorPrimary} 20%, transparent)` : 'transparent'}`,
              transition: 'all 0.25s ease'
            }}>
              <ThunderboltOutlined style={{
                fontSize: 14,
                color: thinkingEnabled ? token.colorPrimary : token.colorTextQuaternary,
                transition: 'color 0.25s',
              }} />
              <Text
                id="chat-thinking-label"
                style={{
                  fontSize: token.fontSizeSM,
                  color: thinkingEnabled ? token.colorPrimary : token.colorTextSecondary,
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'color 0.25s',
                  fontWeight: thinkingEnabled ? 500 : 400,
                }}
                role="button"
                tabIndex={0}
                onClick={() => onReasoningEffortChange(thinkingEnabled ? null : 'medium')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onReasoningEffortChange(thinkingEnabled ? null : 'medium')
                  }
                }}
              >
                深度思考
              </Text>
              <Switch
                size="small"
                checked={thinkingEnabled}
                aria-labelledby="chat-thinking-label"
                onChange={(checked) => onReasoningEffortChange(checked ? 'medium' : null)}
                style={{ margin: '0 4px' }}
              />
              {thinkingEnabled && (
                <Segmented
                  size="small"
                  value={reasoningEffort!}
                  options={EFFORT_OPTIONS}
                  onChange={(val) => onReasoningEffortChange(val as ReasoningEffortLevel)}
                  aria-label="思考强度"
                  style={{ background: token.colorBgContainer, boxShadow: token.boxShadow }}
                />
              )}
            </Flex>
          )}
        </Flex>
        <Flex align="center">
          {isRequesting || uploadingFiles ? (
            <Button onClick={onCancel} disabled={!isRequesting} style={{ borderRadius: 12 }}>
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              onClick={() => onSubmit(value)}
              disabled={!value.trim()}
              style={{ borderRadius: 12, fontWeight: 500 }}
            >
              发送
            </Button>
          )}
        </Flex>
      </Flex>
    )

    return (
      <div style={{ padding: isDesktopLayout ? '0 24px 24px' : '0 16px 16px' }} data-testid={testIds.chat.composer}>
        <Sender
          ref={ref}
          value={value}
          loading={isRequesting || uploadingFiles}
          disabled={uploadingFiles}
          onChange={onChange}
          onSubmit={(val) => {
            void onSubmit(val)
          }}
          onCancel={onCancel}
          onPasteFile={(files) => {
            const nextAttachments = Array.from(files).map(createPendingAttachment)
            handleAttachmentsChange({ 
               file: nextAttachments[0], 
               fileList: [...pendingAttachments, ...nextAttachments] 
            })
          }}
          autoSize={{ minRows: 1, maxRows: 5 }}
          placeholder={`给 ${assistantLabel} 发送消息`}
          header={senderHeader}
          suffix={false}
          footer={senderFooter}
        />
      </div>
    )
  },
)

function createPendingAttachment(file: File): ComposerAttachment {
  const uid = `${Date.now()}-${file.name}`
  return {
    uid,
    name: file.name,
    size: file.size,
    type: file.type,
    originFileObj: Object.assign(file, {
      uid,
      lastModifiedDate: new Date(file.lastModified),
    }) as ComposerAttachment['originFileObj'],
    status: 'done',
  } as ComposerAttachment
}

export type ChatInputRef = ComponentRef<typeof ChatInput>
