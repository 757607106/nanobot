import type { ComponentProps, ComponentRef } from 'react'
import React, { forwardRef } from 'react'
import { Attachments, Sender } from '@ant-design/x'
import { Badge, Button, Card, Flex, Space, Typography, theme } from 'antd'
import { CloudUploadOutlined, LinkOutlined } from '@ant-design/icons'
import { AttachmentTags } from './chatPresentation'
import { testIds } from '../testIds'
import type { ChatAttachmentRef, ChatUploadItem } from '../types'

const { Text } = Typography

type ComposerAttachment = NonNullable<ComponentProps<typeof Attachments>['items']>[number]

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
}

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

    const senderHeader = (
      <Sender.Header
        title="本轮上下文"
        open={headerOpen}
        onOpenChange={setHeaderOpen}
        styles={{ content: { padding: 0 } }}
      >
        <Flex vertical gap={8} style={{ padding: '0 8px 16px' }}>
          {draftAttachmentRefs.length > 0 && (
            <Flex vertical gap={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>关联知识与记忆</Text>
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
      </Sender.Header>
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
          prefix={
            <div style={{ position: 'relative' }}>
              <Badge dot={pendingAttachments.length > 0 && !headerOpen} offset={[-4, 4]}>
                <Button 
                  type="text" 
                  onClick={() => setHeaderOpen(!headerOpen)} 
                  icon={<LinkOutlined />} 
                  disabled={uploadingFiles}
                />
              </Badge>
            </div>
          }
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
