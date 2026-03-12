import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Popconfirm,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import type { InstalledSkill } from '../types'

const { Title, Text } = Typography

export default function SkillsPage() {
  const { message } = App.useApp()
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    void loadSkills()
  }, [])

  async function loadSkills() {
    try {
      setLoading(true)
      const data = await api.getInstalledSkills()
      setSkills(data)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to load skills')
    } finally {
      setLoading(false)
    }
  }

  async function handleFolderSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files || files.length === 0) {
      return
    }

    const formData = new FormData()
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      formData.append('path', path)
      formData.append('file', file)
    }
    event.target.value = ''

    try {
      setUploading(true)
      const uploaded = await api.uploadSkill(formData)
      message.success(`Skill "${uploaded.name}" uploaded`)
      await loadSkills()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to upload skill')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(skillId: string) {
    try {
      setDeletingId(skillId)
      await api.deleteSkill(skillId)
      message.success('Skill deleted')
      await loadSkills()
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to delete skill')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="page-card">
      <div className="page-header-block">
        <div>
          <Title level={2}>Skills</Title>
          <Text type="secondary">
            Manage the skill folders that the current backend can discover in the workspace.
          </Text>
        </div>
        <Space wrap>
          <input
            type="file"
            ref={folderInputRef}
            {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
            multiple
            style={{ display: 'none' }}
            onChange={(event) => void handleFolderSelect(event)}
          />
          <Button
            type="primary"
            icon={<FolderOpenOutlined />}
            loading={uploading}
            onClick={() => folderInputRef.current?.click()}
          >
            Upload Folder
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadSkills()}>
            Refresh
          </Button>
        </Space>
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert
          showIcon
          type="info"
          message="Upload a complete skill folder that contains SKILL.md."
          description="Uploaded folders are written into the active workspace's `skills/` directory, so they can be discovered by the current runtime without changing the agent core flow."
        />

        <div className="skills-dropzone-hint">
          <Text>
            Folder upload expects a structure like `my-skill/SKILL.md` plus any optional
            `scripts/`, `references/`, or `assets/` files inside the same folder.
          </Text>
        </div>

        {loading ? (
          <div className="center-box">
            <Spin />
          </div>
        ) : skills.length === 0 ? (
          <Empty description="No skills found" />
        ) : (
          <Row gutter={[16, 16]} className="skills-grid">
            {skills.map((skill) => (
              <Col xs={24} md={12} xl={8} key={skill.id}>
                <Card
                  title={
                    <Space wrap>
                      <span>{skill.name}</span>
                      <Tag>{skill.version || '1.0.0'}</Tag>
                    </Space>
                  }
                  extra={
                    <Space>
                      <Tag color={skill.source === 'workspace' ? 'green' : 'blue'}>
                        {skill.source}
                      </Tag>
                      {skill.enabled === false ? <Tag>Disabled</Tag> : <Tag color="success">Enabled</Tag>}
                    </Space>
                  }
                  actions={
                    skill.isDeletable
                      ? [
                          <Popconfirm
                            key="delete"
                            title="Delete this skill?"
                            okText="Delete"
                            cancelText="Cancel"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => void handleDelete(skill.id)}
                          >
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              loading={deletingId === skill.id}
                            >
                              Delete
                            </Button>
                          </Popconfirm>,
                        ]
                      : undefined
                  }
                >
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    <Text type="secondary">{skill.description || 'No description available.'}</Text>
                    {skill.author ? <Text type="secondary">Author: {skill.author}</Text> : null}
                    <div>
                      <Text type="secondary">Path</Text>
                      <div className="mono-block">{skill.path}</div>
                    </div>
                    {skill.tags && skill.tags.length > 0 ? (
                      <Space wrap size={4}>
                        {skill.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </Space>
                    ) : null}
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Space>
    </div>
  )
}
