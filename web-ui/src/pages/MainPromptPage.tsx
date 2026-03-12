import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, Popconfirm, Segmented, Space, Typography } from 'antd'
import { EditOutlined, EyeOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import TextArea from 'antd/es/input/TextArea'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'

const { Title, Text } = Typography

type PreviewMode = 'edit' | 'preview'

export default function MainPromptPage() {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [identityContent, setIdentityContent] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('edit')

  useEffect(() => {
    void loadPrompt()
  }, [])

  async function loadPrompt() {
    try {
      setLoading(true)
      const data = await api.getMainAgentPrompt()
      setIdentityContent(data.identity_content || '')
      setUpdatedAt(data.updated_at || '')
      setSourcePath(data.source_path || '')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to load main prompt')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      setSaving(true)
      const saved = await api.updateMainAgentPrompt(identityContent)
      setIdentityContent(saved.identity_content || '')
      setUpdatedAt(saved.updated_at || '')
      setSourcePath(saved.source_path || '')
      message.success('Prompt saved')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to save prompt')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    try {
      await api.resetMainAgentPrompt()
      message.success('Prompt reset to workspace default')
      await loadPrompt()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to reset prompt')
    }
  }

  return (
    <div className="page-card">
      <div className="page-header-block">
        <div>
          <Title level={2}>Agent Prompt</Title>
          <Text type="secondary">
            Edit the workspace `AGENTS.md` file that the current backend already loads into the
            system prompt.
          </Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadPrompt()} loading={loading}>
            Reload
          </Button>
          <Popconfirm
            title="Reset to default?"
            description="This will overwrite the current workspace AGENTS.md with the bundled template."
            okText="Reset"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleReset()}
          >
            <Button>Reset</Button>
          </Popconfirm>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </Space>
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert
          showIcon
          type="info"
          message="Changes here affect future conversations."
          description="Edits are written to the active workspace's AGENTS.md, so new sessions pick them up through the existing backend bootstrap file loading path."
        />

        <Card loading={loading} title="Main Agent Prompt">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {sourcePath ? (
              <div>
                <Text type="secondary">Source</Text>
                <div className="mono-block">{sourcePath}</div>
              </div>
            ) : null}

            {updatedAt ? (
              <Text type="secondary">Updated at: {new Date(updatedAt).toLocaleString()}</Text>
            ) : null}

            <Segmented
              value={previewMode}
              options={[
                { value: 'edit', label: <span><EditOutlined /> Edit</span> },
                { value: 'preview', label: <span><EyeOutlined /> Preview</span> },
              ]}
              onChange={(value) => setPreviewMode(value as PreviewMode)}
            />

            {previewMode === 'edit' ? (
              <TextArea
                rows={18}
                value={identityContent}
                onChange={(event) => setIdentityContent(event.target.value)}
                style={{ fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace' }}
              />
            ) : (
              <div className="prompt-preview">
                <ReactMarkdown>{identityContent || '_No prompt content_'}</ReactMarkdown>
              </div>
            )}
          </Space>
        </Card>
      </Space>
    </div>
  )
}
