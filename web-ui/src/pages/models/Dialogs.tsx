import { Alert, Button, Flex, Input, Modal, Segmented, Table, Tag, Typography, theme } from 'antd'
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
  onDraftChange: (draft: AddModelDraft) => void
  onConfirm: () => void
  onCancel: () => void
}

export function AddModelDialog({ open, draft, onDraftChange, onConfirm, onCancel }: AddModelDialogProps) {
  return (
    <Modal
      open={open}
      title="添加模型"
      okText="确认"
      cancelText="取消"
      destroyOnHidden
      centered
      onOk={onConfirm}
      onCancel={onCancel}
    >
      <Flex vertical gap={16} style={{ marginTop: 8 }}>
        <FieldGroup label="模型 ID">
          <Input
            aria-label="模型 ID"
            value={draft.modelId}
            onChange={(e) => onDraftChange({ ...draft, modelId: e.target.value })}
            placeholder="模型 ID"
          />
        </FieldGroup>

        <FieldGroup label="展示名称">
          <Input
            aria-label="展示名称"
            value={draft.modelName}
            onChange={(e) => onDraftChange({ ...draft, modelName: e.target.value })}
            placeholder="展示名称"
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
      </Flex>
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
      <Flex vertical gap={12} style={{ marginTop: 8 }}>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {models.length > 0 ? (
          <Table
            rowKey="modelId"
            pagination={false}
            size="small"
            columns={columns}
            dataSource={models.map((modelId) => ({
              modelId,
              type: inferCapabilityType(modelId),
            }))}
          />
        ) : (
          !error && <div style={{ textAlign: 'center', padding: '24px 0' }}>暂无模型</div>
        )}
      </Flex>
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

  return (
    <Modal
      open={open}
      title="测试连接"
      okText="开始测试"
      cancelText="取消"
      destroyOnHidden
      centered
      confirmLoading={testing}
      onOk={onConfirm}
      onCancel={onCancel}
    >
      <Flex vertical gap={16} style={{ marginTop: 8 }}>
        <FieldGroup label="模型 ID">
          <Input
            aria-label="模型 ID"
            value={draft.model}
            onChange={(e) => onDraftChange({ ...draft, model: e.target.value })}
            placeholder="模型 ID"
          />
        </FieldGroup>

        <FieldGroup label="API Key">
          <Input.Password
            aria-label="API Key"
            value={draft.apiKey}
            onChange={(e) => onDraftChange({ ...draft, apiKey: e.target.value })}
          />
        </FieldGroup>

        <FieldGroup label="API Base URL">
          <Input
            aria-label="API Base URL"
            value={draft.apiBase}
            onChange={(e) => onDraftChange({ ...draft, apiBase: e.target.value })}
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
              <Typography.Text strong style={{ color: result.ok ? token.colorSuccess : token.colorError }}>
                测试{result.ok ? '通过' : '失败'}
                {result.model ? ` (${result.model})` : ''}
              </Typography.Text>

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
      </Flex>
    </Modal>
  )
}

interface DeleteConfirmDialogProps {
  open: boolean
  bindingName: string | null
  bindingLabel: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmDialog({
  open,
  bindingName,
  bindingLabel,
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
      <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
        确定要删除「{bindingLabel || bindingName}」吗？
      </Typography.Paragraph>
    </Modal>
  )
}
