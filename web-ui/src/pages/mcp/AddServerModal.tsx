import { Button, Drawer, Input, InputNumber, Select, Space, theme } from 'antd'
import type { McpServerEntry } from '../../types'
import { buildServerConfig, ServerDraft, transportOptions } from './utils'
import { useToast } from '../../toast'

interface AddServerModalProps {
  open: boolean
  editingEntry: McpServerEntry | null
  draft: ServerDraft
  existingNames: Set<string>
  saving: boolean
  onDraftChange: (draft: ServerDraft) => void
  onClose: () => void
  onSave: (config: ReturnType<typeof buildServerConfig> & { displayName: string | null; enabled: boolean }) => Promise<void>
}

export default function AddServerModal({
  open,
  editingEntry,
  draft,
  existingNames,
  saving,
  onDraftChange,
  onClose,
  onSave,
}: AddServerModalProps) {
  const message = useToast()
  const { token } = theme.useToken()

  const isRemote = draft.type !== 'stdio'
  const activeName = editingEntry ? draft.displayName : draft.name
  const canSave = editingEntry
    ? activeName.trim().length > 0
    : draft.name.trim().length > 0 && !existingNames.has(draft.name.trim())

  const handleSave = async () => {
    try {
      const config = buildServerConfig(draft)
      await onSave({
        ...config,
        displayName: activeName.trim() || null,
        enabled: editingEntry?.enabled ?? true,
      })
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  const labelStyle = {
    display: 'block',
    fontSize: 'var(--nb-text-sm)',
    fontWeight: 'var(--nb-font-weight-medium)',
    color: token.colorText,
    marginBottom: 6,
  }

  const formGroupStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  }

  return (
    <Drawer
      open={open}
      title={editingEntry ? '编辑服务连接' : '添加服务连接'}
      onClose={onClose}
      destroyOnClose
      width={520}
      styles={{
        body: { padding: 'var(--nb-spacing-lg)' },
        footer: { padding: 'var(--nb-spacing-md) var(--nb-spacing-lg)' },
      }}
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={handleSave} loading={saving} disabled={!canSave}>
            保存
          </Button>
        </Space>
      }
    >
      <div className="flex flex-col" style={{ gap: 'var(--nb-spacing-md)' }}>
        {/* 名称 */}
        <div style={formGroupStyle}>
          <label style={labelStyle}>
            {editingEntry ? '展示名称' : '服务名称'}
          </label>
          <Input
            value={activeName}
            onChange={(e) => {
              if (editingEntry) {
                onDraftChange({ ...draft, displayName: e.target.value })
              } else {
                onDraftChange({ ...draft, name: e.target.value })
              }
            }}
            placeholder={editingEntry ? '展示名称' : '唯一标识，如 weather-api'}
            status={!editingEntry && existingNames.has(draft.name.trim()) ? 'error' : undefined}
          />
          {editingEntry && (
            <span style={{ fontSize: 'var(--nb-text-xs)', color: token.colorTextTertiary }}>
              连接 ID：{editingEntry.name}
            </span>
          )}
          {!editingEntry && existingNames.has(draft.name.trim()) && (
            <span style={{ fontSize: 'var(--nb-text-xs)', color: token.colorError }}>
              该名称已存在
            </span>
          )}
        </div>

        {/* 类型 */}
        <div style={formGroupStyle}>
          <label style={labelStyle}>传输方式</label>
          <Select
            value={draft.type}
            onChange={(value) => onDraftChange({ ...draft, type: value })}
            options={transportOptions.map((item) => ({
              value: item.value,
              label: `${item.label} — ${item.description}`,
            }))}
          />
        </div>

        {/* 远程配置 */}
        {isRemote ? (
          <>
            <div style={formGroupStyle}>
              <label style={labelStyle}>远程地址</label>
              <Input
                value={draft.url}
                onChange={(e) => onDraftChange({ ...draft, url: e.target.value })}
                placeholder="https://api.example.com/mcp"
              />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>请求头（可选）</label>
              <Input.TextArea
                rows={3}
                value={draft.headersText}
                onChange={(e) => onDraftChange({ ...draft, headersText: e.target.value })}
                placeholder="Authorization: Bearer <token>"
                style={{ fontFamily: 'var(--nb-font-mono)' }}
              />
            </div>
          </>
        ) : (
          <>
            <div style={formGroupStyle}>
              <label style={labelStyle}>命令</label>
              <Input
                value={draft.command}
                onChange={(e) => onDraftChange({ ...draft, command: e.target.value })}
                placeholder="uvx 或 npx"
              />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>参数（可选）</label>
              <Input
                value={draft.argsText}
                onChange={(e) => onDraftChange({ ...draft, argsText: e.target.value })}
                placeholder="参数以空格分隔"
              />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>环境变量（可选）</label>
              <Input.TextArea
                rows={4}
                value={draft.envText}
                onChange={(e) => onDraftChange({ ...draft, envText: e.target.value })}
                placeholder="KEY=value&#10;API_KEY=xxx"
                style={{ fontFamily: 'var(--nb-font-mono)' }}
              />
            </div>
          </>
        )}

        {/* 超时 */}
        <div className="flex items-center" style={{ gap: 'var(--nb-spacing-md)' }}>
          <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>
            超时时间
          </label>
          <Space.Compact>
            <InputNumber
              min={1}
              max={300}
              value={draft.toolTimeout}
              onChange={(value) => onDraftChange({ ...draft, toolTimeout: Number(value || 30) })}
            />
            <span
              style={{
                paddingInline: 10,
                display: 'inline-flex',
                alignItems: 'center',
                border: `1px solid ${token.colorBorder}`,
                borderInlineStart: 'none',
                borderTopRightRadius: 8,
                borderBottomRightRadius: 8,
                background: token.colorFillTertiary,
                color: token.colorTextSecondary,
                fontSize: 'var(--nb-text-xs)',
                lineHeight: 1,
              }}
            >
              秒
            </span>
          </Space.Compact>
        </div>
      </div>
    </Drawer>
  )
}
