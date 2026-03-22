import type { Dispatch, SetStateAction } from 'react'
import { Button, Input, Select, Space, Switch, Typography } from 'antd'
import { SaveOutlined } from '@ant-design/icons'

const { Text } = Typography

interface KnowledgeSettingsFormState {
  name: string
  description: string
  enabled: boolean
  kbType: string
  embedModelName: string
  llmModelName: string
  language: string
  chunkPresetId: string
  autoGenerateQuestions: boolean
  qaSeparator: string
  tagsText: string
}

interface OptionItem {
  value: string
  label: string
}

interface KnowledgeSettingsTabProps {
  isLightRag: boolean
  isMilvus: boolean
  formState: KnowledgeSettingsFormState
  chunkPresetOptions: OptionItem[]
  languageOptions: OptionItem[]
  generatingDescription: boolean
  supportsDescriptionGeneration: boolean
  savingKb: boolean
  onFormStateChange: Dispatch<SetStateAction<KnowledgeSettingsFormState>>
  onGenerateDescription: () => void
  onSave: () => void
}

export function KnowledgeSettingsTab({
  isLightRag,
  isMilvus,
  formState,
  chunkPresetOptions,
  languageOptions,
  generatingDescription,
  supportsDescriptionGeneration,
  savingKb,
  onFormStateChange,
  onGenerateDescription,
  onSave,
}: KnowledgeSettingsTabProps) {
  return (
    <div className="knowledge-tab-panel">
      <div className="knowledge-settings-grid">
        <div className="studio-form-field">
          <Text type="secondary">名称</Text>
          <Input value={formState.name} onChange={(event) => onFormStateChange((prev) => ({ ...prev, name: event.target.value }))} />
        </div>
        <div className="studio-form-field">
          <Text type="secondary">知识库类型</Text>
          <Input value={isLightRag ? 'lightrag' : isMilvus ? 'milvus' : ''} disabled />
        </div>
        <div className="studio-form-field">
          <Text type="secondary">Embedding 模型</Text>
          <Input value={formState.embedModelName} onChange={(event) => onFormStateChange((prev) => ({ ...prev, embedModelName: event.target.value }))} />
        </div>
        <div className="studio-form-field">
          <Text type="secondary">LLM 模型</Text>
          <Input value={formState.llmModelName} onChange={(event) => onFormStateChange((prev) => ({ ...prev, llmModelName: event.target.value }))} />
        </div>
        {isLightRag ? (
          <div className="studio-form-field">
            <Text type="secondary">语言</Text>
            <Select
              value={formState.language}
              options={languageOptions}
              onChange={(value) => onFormStateChange((prev) => ({ ...prev, language: value }))}
            />
          </div>
        ) : null}
        <div className="studio-form-field">
          <Text type="secondary">分块策略</Text>
          <Select
            value={formState.chunkPresetId}
            options={chunkPresetOptions}
            onChange={(value) => onFormStateChange((prev) => ({ ...prev, chunkPresetId: value }))}
          />
        </div>
        <div className="studio-form-field">
          <Text type="secondary">自动生成问题</Text>
          <Switch checked={formState.autoGenerateQuestions} onChange={(checked) => onFormStateChange((prev) => ({ ...prev, autoGenerateQuestions: checked }))} />
        </div>
        {isMilvus ? (
          <div className="studio-form-field studio-form-field-span-2">
            <Text type="secondary">QA 分隔符</Text>
            <Input
              placeholder="例如：---FAQ---"
              value={formState.qaSeparator}
              onChange={(event) => onFormStateChange((prev) => ({ ...prev, qaSeparator: event.target.value }))}
            />
          </div>
        ) : null}
        <div className="studio-form-field studio-form-field-span-2">
          <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
            <Text type="secondary">描述</Text>
            <Button size="small" loading={generatingDescription} disabled={!supportsDescriptionGeneration} onClick={onGenerateDescription}>
              AI 生成描述
            </Button>
          </Space>
          <Input.TextArea rows={4} value={formState.description} onChange={(event) => onFormStateChange((prev) => ({ ...prev, description: event.target.value }))} />
        </div>
        <div className="studio-form-field studio-form-field-span-2">
          <Text type="secondary">标签</Text>
          <Input
            placeholder="用逗号分隔"
            value={formState.tagsText}
            onChange={(event) => onFormStateChange((prev) => ({ ...prev, tagsText: event.target.value }))}
          />
        </div>
        <div className="studio-form-field">
          <Text type="secondary">启用状态</Text>
          <Switch checked={formState.enabled} onChange={(checked) => onFormStateChange((prev) => ({ ...prev, enabled: checked }))} />
        </div>
      </div>
      <div className="knowledge-query-actions">
        <Button type="primary" icon={<SaveOutlined />} loading={savingKb} onClick={onSave}>
          保存知识库设置
        </Button>
      </div>
    </div>
  )
}
