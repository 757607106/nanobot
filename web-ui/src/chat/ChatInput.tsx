import type { ComponentProps, ComponentRef } from 'react'
import { forwardRef } from 'react'
import { Attachments, Sender } from '@ant-design/x'
import { Button, Card, Flex, Space, Typography, theme } from 'antd'
import { CloudUploadOutlined, LinkOutlined, PaperClipOutlined } from '@ant-design/icons'
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
  sessionFiles: ChatUploadItem[]
  recentUploads: ChatUploadItem[]
  onOpenLibrary: () => void
  onToggleSessionFile: (item: ChatUploadItem) => void
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
      sessionFiles,
      recentUploads,
      onOpenLibrary,
      onToggleSessionFile,
      dropContainerRef,
      isDesktopLayout,
    },
    ref,
  ) {
    const { token } = theme.useToken()
    const surfaceRadius = token.borderRadiusLG + 8

    const showSenderHeader = pendingAttachments.length > 0 || draftAttachmentRefs.length > 0

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
          onPasteFile={(_firstFile, files) => {
            const nextAttachments = Array.from(files).map(createPendingAttachment)
            onPendingAttachmentsChange([...pendingAttachments, ...nextAttachments])
          }}
          autoSize={{ minRows: 1, maxRows: 5 }}
          placeholder={`给 ${assistantLabel} 发送消息`}
          style={{
            borderRadius: surfaceRadius,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            boxShadow: token.boxShadowTertiary,
          }}
          styles={{
            content: {
              gap: 12,
              padding: 12,
              alignItems: 'flex-end',
            },
            footer: {
              padding: '0 12px 12px',
            },
          }}
          header={
            showSenderHeader ? (
              <Sender.Header open title="本轮上下文" closable={false}>
                <Flex vertical gap={12}>
                  {draftAttachmentRefs.length ? (
                    <Card size="small" title="本轮引用">
                      <AttachmentTags
                        attachments={draftAttachmentRefs}
                        removable
                        onRemove={(relativePath) => {
                          onDraftAttachmentRefsChange(
                            draftAttachmentRefs.filter((item) => item.relativePath !== relativePath),
                          )
                        }}
                      />
                    </Card>
                  ) : null}
                  {pendingAttachments.length > 0 ? (
                    <Card size="small" title="待上传文件">
                      <Attachments
                        items={pendingAttachments}
                        multiple
                        disabled={uploadingFiles}
                        overflow="scrollX"
                        beforeUpload={() => false}
                        onChange={({ fileList }) => onPendingAttachmentsChange(fileList as ComposerAttachment[])}
                      />
                    </Card>
                  ) : null}
                </Flex>
              </Sender.Header>
            ) : null
          }
          prefix={
            <Space size={8}>
              <span data-testid={testIds.chat.fileInput}>
                <Attachments
                  items={pendingAttachments}
                  multiple
                  disabled={uploadingFiles}
                  beforeUpload={() => false}
                  onChange={({ fileList }) => onPendingAttachmentsChange(fileList as ComposerAttachment[])}
                  getDropContainer={() => dropContainerRef.current}
                  placeholder={{
                    icon: <CloudUploadOutlined />,
                    title: '拖拽文件到这里',
                    description: '发送时自动上传。',
                  }}
                >
                  <Button
                    type="text"
                    icon={<LinkOutlined />}
                    disabled={uploadingFiles}
                    data-testid={testIds.chat.uploadFile}
                  />
                </Attachments>
              </span>
              <Button
                type="text"
                icon={<PaperClipOutlined />}
                onClick={onOpenLibrary}
                disabled={recentUploads.length === 0}
              >
                历史文件
              </Button>
            </Space>
          }
          footer={
            <Flex justify="space-between" align="center" gap={8} wrap="wrap">
              <Text type="secondary">
                {uploadingFiles
                  ? '附件上传中...'
                  : pendingAttachments.length
                    ? `按 Enter 发送，${pendingAttachments.length} 个附件会随消息一并上传。`
                    : 'Enter 发送，Shift + Enter 换行。'}
              </Text>
            </Flex>
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
