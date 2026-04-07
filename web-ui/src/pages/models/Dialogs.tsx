import { Alert, Button, Empty, Flex, Input, Modal, Segmented, Space, Table, Tag, Typography, theme } from 'antd'
import type { TableColumnsType } from 'antd'
import { capabilityLabel, inferCapabilityType } from './utils'
import type { AddModelDraft, CapabilityType, TestDraft } from './types'
import type { ModelBindingTestResult } from '../../types'

function capabilityColor(type: CapabilityType) {
  if (type === 'embedding') return 'gold'
  if (type === 'multimodal') return 'purple'
  return 'blue'
}

interface FieldGroupProps {
  label: string
  children: React.ReactNode
}

function FieldGroup({ label, children }: FieldGroupProps) {
  return (
    <Flex vertical gap={6}>
      <Typography.Text strong style={{ fontSize: 13 }}>
        {label}
      </Typography.Text>
      {children}
    </Flex>
  )
}

interface AddModelDialogProps {
  open: boolean
  draft: AddModelDraft
  providerLabel: string
  existingBindingCount: number
  suggestedRouteId: string
  onDraftChange: (draft: AddModelDraft) => void
  onConfirm: () => void
  onCancel: () => void
}

export function AddModelDialog({
  open,
  draft,
  providerLabel,
  existingBindingCount,
  suggestedRouteId,
  onDraftChange,
  onConfirm,
  onCancel,
}: AddModelDialogProps) {
  const canConfirm = Boolean(draft.modelId.trim())
  return (
    <Modal
      open={open}
      title="添加模型"
      width={560}
      okText="确认"
      cancelText="取消"
      okButtonProps={{ disabled: !canConfirm }}
      destroyOnHidden
      centered
      onOk={onConfirm}
      onCancel={onCancel}
      styles={{ body: { paddingTop: 12 } }}
    >
      <div className="console-modal-stack">
        <div className="resource-summary-strip">
          <div className="resource-summary-tile">
            <span className="resource-summary-label">供应商</span>
            <span className="resource-summary-value" style={{ fontSize: 16 }}>{providerLabel || '未选择'}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">已有模型</span>
            <span className="resource-summary-value">{existingBindingCount}</span>
          </div>
        </div>

        <FieldGroup label="模型 ID（必填）">
          <Input
            aria-label="模型 ID"
            value={draft.modelId}
            onChange={(e) => {
              const nextId = e.target.value
              const inferred = inferCapabilityType(nextId)
              onDraftChange({ ...draft, modelId: nextId, capabilityType: inferred })
            }}
            placeholder="例如 text-embedding-v4、deepseek-chat"
            status={draft.modelId.trim() ? undefined : undefined}
          />
        </FieldGroup>

        <FieldGroup label="展示名称">
          <Input
            aria-label="展示名称"
            value={draft.modelName}
            onChange={(e) => onDraftChange({ ...draft, modelName: e.target.value })}
            placeholder={draft.modelId.trim() || '例如 DeepSeek Chat'}
          />
        </FieldGroup>

        <FieldGroup label="能力类型">
          <Segmented
            block
            value={draft.capabilityType}
            onChange={(value) => onDraftChange({ ...draft, capabilityType: value as CapabilityType })}
            options={[
              { label: '文本对话', value: 'text_chat' },
              { label: '向量嵌入', value: 'embedding' },
              { label: '多模态', value: 'multimodal' },
            ]}
          />
        </FieldGroup>
      </div>
    </Modal>
  )
}

interface RemoteModelsDialogProps {
  open: boolean
  models: string[]
  error: string | null
  onClose: () => void
  onImport: (modelId: string) => void
}

export function RemoteModelsDialog({ open, models, error, onClose, onImport }: RemoteModelsDialogProps) {
  const modelRows = models.map((modelId) => ({
    modelId,
    type: inferCapabilityType(modelId),
  }))

  const columns: TableColumnsType<{ modelId: string; type: CapabilityType }> = [
    {
      title: '模型 ID',
      dataIndex: 'modelId',
      key: 'modelId',
    },
    {
      title: '能力类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (value) => (
        <Tag color={capabilityColor(value as CapabilityType)}>
          {capabilityLabel(value as CapabilityType)}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      width: 100,
      render: (_, record) => (
          <Button size="small" type="link" onClick={() => onImport(record.modelId)}>
            导入
          </Button>
        ),
    },
  ]

  const typedCounts = modelRows.reduce(
    (acc, item) => {
      acc[item.type] += 1
      return acc
    },
    { text_chat: 0, embedding: 0, multimodal: 0, rerank: 0 } satisfies Record<CapabilityType, number>,
  )

  return (
    <Modal
      open={open}
      title="远端模型列表"
      footer={<Button onClick={onClose}>关闭</Button>}
      destroyOnHidden
      centered
      width={720}
      onCancel={onClose}
    >
      <div className="console-modal-stack">
        <div className="resource-summary-strip">
          <div className="resource-summary-tile">
            <span className="resource-summary-label">可发现模型</span>
            <span className="resource-summary-value">{modelRows.length}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">文本对话</span>
            <span className="resource-summary-value">{typedCounts.text_chat}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">多模态</span>
            <span className="resource-summary-value">{typedCounts.multimodal}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">嵌入模型</span>
            <span className="resource-summary-value">{typedCounts.embedding}</span>
          </div>
        </div>

        {error ? <Alert type="error" showIcon message={error} /> : null}
        {modelRows.length > 0 ? (
          <Table
            rowKey="modelId"
            pagination={false}
            size="small"
            columns={columns}
            dataSource={modelRows}
            locale={{
              emptyText: (
                <Empty
                  image={false} className="minimal-empty"
                  description="当前供应商还没有返回模型列表"
                />
              ),
            }}
          />
        ) : (
          !error && (
            <div className="workspace-empty-state" style={{ minHeight: 180 }}>
              <Empty
                image={false} className="minimal-empty"
                description="当前供应商还没有返回模型列表"
              />
            </div>
          )
        )}
      </div>
    </Modal>
  )
}

interface TestConnectionDialogProps {
  open: boolean
  testing: boolean
  draft: TestDraft
  result: ModelBindingTestResult | null
  onDraftChange: (draft: TestDraft) => void
  onConfirm: () => void
  onCancel: () => void
}

export function TestConnectionDialog({
  open,
  testing,
  draft,
  result,
  onDraftChange,
  onConfirm,
  onCancel,
}: TestConnectionDialogProps) {
  const { token } = theme.useToken()
  const hasApiKey = Boolean(draft.apiKey.trim())
  const hasApiBase = Boolean(draft.apiBase.trim())

  return (
    <Modal
      open={open}
      title="测试连接"
      width={760}
      okText="开始测试"
      cancelText="取消"
      destroyOnHidden
      centered
      confirmLoading={testing}
      onOk={onConfirm}
      onCancel={onCancel}
      styles={{ body: { paddingTop: 12 } }}
    >
      <div className="console-modal-stack">
        <div className="resource-summary-strip">
          <div className="resource-summary-tile">
            <span className="resource-summary-label">目标模型</span>
            <span className="resource-summary-value" style={{ fontSize: 16 }}>{draft.model || '待输入'}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">API Key</span>
            <span className="resource-summary-value">{hasApiKey ? '已提供' : '未提供'}</span>
          </div>
          <div className="resource-summary-tile">
            <span className="resource-summary-label">API Base</span>
            <span className="resource-summary-value">{hasApiBase ? '已指定' : '默认地址'}</span>
          </div>
        </div>

        <div className="console-modal-grid">
          <FieldGroup label="模型 ID">
            <Input
              aria-label="模型 ID"
              value={draft.model}
              onChange={(e) => onDraftChange({ ...draft, model: e.target.value })}
              placeholder="模型 ID"
            />
          </FieldGroup>

          <FieldGroup label="API Base URL">
            <Input
              aria-label="API Base URL"
              value={draft.apiBase}
              onChange={(e) => onDraftChange({ ...draft, apiBase: e.target.value })}
            />
          </FieldGroup>
        </div>

        <FieldGroup label="API Key">
          <Input.Password
            aria-label="API Key"
            value={draft.apiKey}
            onChange={(e) => onDraftChange({ ...draft, apiKey: e.target.value })}
          />
        </FieldGroup>

        {result ? (
          <div
            style={{
              padding: 16,
              borderRadius: token.borderRadius,
              border: `1px solid ${result.ok ? token.colorSuccess : token.colorError}30`,
              background: `${result.ok ? token.colorSuccess : token.colorError}08`,
            }}
          >
            <Flex vertical gap={12}>
              <Space wrap size={[8, 8]}>
                <Typography.Text strong style={{ color: result.ok ? token.colorSuccess : token.colorError }}>
                  测试{result.ok ? '通过' : '失败'}
                  {result.model ? ` (${result.model})` : ''}
                </Typography.Text>
                <Tag color={result.ok ? 'success' : 'error'}>{result.finishReason || (result.ok ? 'completed' : 'failed')}</Tag>
                {typeof result.latencyMs === 'number' ? <Tag>{result.latencyMs} ms</Tag> : null}
              </Space>

              {result.responsePreview ? (
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    borderRadius: token.borderRadius,
                    overflowX: 'auto',
                    background: token.colorBgContainer,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                  }}
                >
                  {result.responsePreview}
                </pre>
              ) : null}

              {!result.ok && result.message ? (
                <Alert type="error" showIcon message={result.message} />
              ) : null}
            </Flex>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

interface DeleteConfirmDialogProps {
  open: boolean
  bindingName: string | null
  bindingLabel: string | null
  isDefault: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmDialog({
  open,
  bindingName,
  bindingLabel,
  isDefault,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title="删除模型绑定"
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      destroyOnHidden
      centered
      onOk={onConfirm}
      onCancel={onCancel}
    >
      <div className="console-modal-stack">
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          确定要删除「{bindingLabel || bindingName}」吗？
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          {isDefault ? '当前路由为默认绑定。' : '删除后该路由不可用。'}
        </Typography.Text>
      </div>
    </Modal>
  )
}
