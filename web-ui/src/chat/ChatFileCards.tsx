import { Button, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, LinkOutlined, PaperClipOutlined } from '@ant-design/icons'
import type { ChatAttachmentRef } from '../types'

const { Text } = Typography

function formatFileSize(sizeBytes?: number) {
  if (!sizeBytes || sizeBytes <= 0) {
    return '未知大小'
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function getAttachmentName(item: ChatAttachmentRef) {
  return item.name || item.relativePath.split('/').filter(Boolean).pop() || item.relativePath
}

interface ChatFileCardsProps {
  items: ChatAttachmentRef[]
  variant?: 'message' | 'draft' | 'recent'
  removable?: boolean
  onRemove?: (relativePath: string) => void
  onReference?: (attachment: ChatAttachmentRef) => void
  onInsertPath?: (relativePath: string) => void
}

export default function ChatFileCards({
  items,
  variant = 'message',
  removable,
  onRemove,
  onReference,
  onInsertPath,
}: ChatFileCardsProps) {
  if (!items.length) {
    return null
  }

  return (
    <div className={['chat-file-card-list', `is-${variant}`].join(' ')}>
      {items.map((item) => {
        const name = getAttachmentName(item)
        return (
          <div className="chat-file-card" key={item.relativePath}>
            <div className="chat-file-card-main">
              <div className="chat-file-card-title-row">
                <span className="chat-file-card-name">
                  <PaperClipOutlined />
                  <span>{name}</span>
                </span>
                <Tag className="chat-file-card-tag">{formatFileSize(item.sizeBytes)}</Tag>
              </div>
              <Tooltip title={item.relativePath}>
                <Text type="secondary" className="chat-file-card-path">
                  {item.relativePath}
                </Text>
              </Tooltip>
            </div>

            {removable || onReference || onInsertPath ? (
              <div className="chat-file-card-actions">
                {onReference ? (
                  <Button size="small" onClick={() => onReference(item)}>
                    引用
                  </Button>
                ) : null}
                {onInsertPath ? (
                  <Button size="small" type="text" icon={<LinkOutlined />} onClick={() => onInsertPath(item.relativePath)}>
                    路径
                  </Button>
                ) : null}
                {removable && onRemove ? (
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    danger
                    onClick={() => onRemove(item.relativePath)}
                  >
                    移除
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
