import { Card, Tag, Tooltip, theme } from 'antd'
import { CodeOutlined, DeleteOutlined, GlobalOutlined, PoweroffOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { McpServerEntry, McpServerStatus } from '../../types'
import { transportLabels } from './utils'
import { formatDateTimeZh } from '../../locale'

interface ServerCardProps {
  entry: McpServerEntry
  loading: boolean
  onToggle: (entry: McpServerEntry) => void
  onDelete: (entry: McpServerEntry) => void
}

const statusConfig: Record<McpServerStatus, { label: string; color: string }> = {
  ready: { label: '就绪', color: 'success' },
  incomplete: { label: '待配置', color: 'warning' },
  disabled: { label: '已停用', color: 'default' },
}

export default function ServerCard({ entry, loading, onToggle, onDelete }: ServerCardProps) {
  const navigate = useNavigate()
  const { token } = theme.useToken()

  const preview = entry.transport === 'stdio'
    ? [entry.command || '', ...(entry.args || [])].filter(Boolean).join(' ')
    : entry.url || '未配置地址'

  const statusInfo = statusConfig[entry.status]

  const handleClick = () => {
    navigate(`/mcp/${encodeURIComponent(entry.name)}`)
  }

  return (
    <Card
      className="server-card group"
      styles={{
        body: { padding: token.paddingLG },
      }}
      hoverable
      onClick={handleClick}
    >
      <style>{`
        .server-card {
          cursor: pointer;
          transition: transform 200ms ease, box-shadow 200ms ease;
        }
        .server-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(99, 102, 241, 0.12), 0 4px 12px rgba(0, 0, 0, 0.04);
        }
        .server-card .card-actions {
          opacity: 0;
          transition: opacity 150ms ease;
        }
        .server-card:hover .card-actions {
          opacity: 1;
        }
      `}</style>

      {/* Header */}
      <div
        className="flex items-start justify-between"
        style={{ gap: 'var(--nb-spacing-sm)', marginBottom: 'var(--nb-spacing-sm)' }}
      >
        <div className="flex items-center" style={{ gap: 'var(--nb-spacing-sm)', minWidth: 0 }}>
          <div
            className="flex items-center justify-center"
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: 'var(--nb-radius-md)',
              background: token.colorBgContainerDisabled,
            }}
          >
            {entry.transport === 'stdio' ? (
              <CodeOutlined style={{ fontSize: 18, color: token.colorTextSecondary }} />
            ) : (
              <GlobalOutlined style={{ fontSize: 18, color: token.colorTextSecondary }} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: token.fontSizeLG,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.displayName || entry.name}
            </div>
            <div
              style={{
                fontSize: token.fontSizeSM,
                color: token.colorTextDescription,
                fontFamily: 'var(--font-mono, "IBM Plex Mono", monospace)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.name}
            </div>
          </div>
        </div>
        <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
      </div>

      {/* Preview */}
      <div
        style={{
          marginBottom: 'var(--nb-spacing-sm)',
          fontFamily: 'var(--font-mono, "IBM Plex Mono", monospace)',
          fontSize: 'var(--nb-text-sm)',
          color: token.colorTextSecondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {preview}
      </div>

      {/* Tags */}
      <div className="flex flex-wrap" style={{ gap: 'var(--nb-spacing-xs)', marginBottom: 'var(--nb-spacing-sm)' }}>
        <Tag>{transportLabels[entry.transport]}</Tag>
        <Tag color={entry.enabled ? 'green' : 'default'}>
          {entry.enabled ? '已启用' : '已停用'}
        </Tag>
        <Tag color="default">{entry.sourceLabel}</Tag>
        {entry.toolCountKnown && entry.toolCount ? (
          <Tag color="blue">{entry.toolCount} 工具</Tag>
        ) : null}
      </div>

      <div 
        style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: 8, 
          marginBottom: 'var(--nb-spacing-sm)',
          background: token.colorBgContainerDisabled,
          padding: 8,
          borderRadius: 'var(--nb-radius-md)'
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 2 }}>验证状态</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{entry.lastProbeStatus || statusInfo.label}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 2 }}>最近探测</div>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.lastCheckedAt ? formatDateTimeZh(entry.lastCheckedAt) : '尚未探测'}
          </div>
        </div>
      </div>

      {/* Tool Names */}
      {entry.toolNames && entry.toolNames.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 'var(--nb-spacing-sm)' }}>
          {entry.toolNames.slice(0, 6).map((toolName) => (
            <span
              key={toolName}
              style={{
                paddingInline: 'var(--nb-spacing-xs)',
                paddingBlock: 2,
                borderRadius: 'var(--nb-radius-full, 999px)',
                fontSize: 'var(--nb-text-xs)',
                fontFamily: 'var(--font-mono, "IBM Plex Mono", monospace)',
                background: token.colorBgContainerDisabled,
                color: token.colorTextSecondary,
              }}
            >
              {toolName}
            </span>
          ))}
          {entry.toolNames.length > 6 && (
            <span
              style={{
                fontSize: 'var(--nb-text-xs)',
                color: token.colorTextTertiary,
              }}
            >
              +{entry.toolNames.length - 6}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div
        className="card-actions flex justify-end"
        style={{
          gap: 4,
          paddingTop: 'var(--nb-spacing-sm)',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip title={entry.enabled ? '停用' : '启用'}>
          <button
            type="button"
            style={{
              padding: 'var(--nb-spacing-xs)',
              borderRadius: 'var(--nb-radius-md)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = token.colorBgTextHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            onClick={() => onToggle(entry)}
            disabled={loading}
          >
            <PoweroffOutlined
              style={{
                fontSize: 16,
                color: entry.enabled ? token.colorSuccess : token.colorTextDisabled,
              }}
            />
          </button>
        </Tooltip>
        <Tooltip title="删除">
          <button
            type="button"
            style={{
              padding: 'var(--nb-spacing-xs)',
              borderRadius: 'var(--nb-radius-md)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = token.colorBgTextHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            onClick={() => onDelete(entry)}
          >
            <DeleteOutlined style={{ fontSize: 16, color: token.colorError }} />
          </button>
        </Tooltip>
      </div>
    </Card>
  )
}
