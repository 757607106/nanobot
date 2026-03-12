import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Popconfirm,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import PageHero from '../components/PageHero'
import type { InstalledSkill } from '../types'
const { Text } = Typography

type SkillFilter = 'all' | 'workspace' | 'builtin'

export default function SkillsPage() {
  const { message } = App.useApp()
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')

  useEffect(() => {
    void loadSkills()
  }, [])

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      if (filter === 'workspace' && skill.source !== 'workspace') {
        return false
      }
      if (filter === 'builtin' && skill.source === 'workspace') {
        return false
      }
      if (!query.trim()) {
        return true
      }
      const haystack = `${skill.name} ${skill.description} ${skill.author ?? ''} ${(skill.tags ?? []).join(' ')}`.toLowerCase()
      return haystack.includes(query.trim().toLowerCase())
    })
  }, [filter, query, skills])

  async function loadSkills() {
    try {
      setLoading(true)
      const data = await api.getInstalledSkills()
      setSkills(data)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载技能失败')
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
      message.success(`技能“${uploaded.name}”上传成功`)
      await loadSkills()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '上传技能失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(skillId: string) {
    try {
      setDeletingId(skillId)
      await api.deleteSkill(skillId)
      message.success('技能已删除')
      await loadSkills()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除技能失败')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="技能管理"
        title="管理当前工作区可发现的技能"
        description="上传、查看和清理技能目录，让当前后端运行时能够直接发现并加载这些能力。"
        actions={(
          <Space wrap>
            <Button
              type="primary"
              icon={<FolderOpenOutlined />}
              loading={uploading}
              onClick={() => folderInputRef.current?.click()}
            >
              上传文件夹
            </Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadSkills()}>
              刷新
            </Button>
          </Space>
        )}
        stats={[
          { label: '技能总数', value: skills.length },
          { label: '工作区技能', value: skills.filter((item) => item.source === 'workspace').length },
          { label: '内置技能', value: skills.filter((item) => item.source !== 'workspace').length },
        ]}
      />

      <div className="page-card">
        <input
          type="file"
          ref={folderInputRef}
          {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
          multiple
          style={{ display: 'none' }}
          onChange={(event) => void handleFolderSelect(event)}
        />

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="toolbar-row">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="按名称、描述或标签搜索技能"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Segmented
              value={filter}
              options={[
                { label: '全部', value: 'all' },
                { label: '工作区', value: 'workspace' },
                { label: '内置', value: 'builtin' },
              ]}
              onChange={(value) => setFilter(value as SkillFilter)}
            />
          </div>

          <div className="page-meta-grid">
            <div className="page-meta-card">
              <span>当前筛选</span>
              <strong>{filteredSkills.length} 个技能</strong>
            </div>
            <div className="page-meta-card">
              <span>工作区来源</span>
              <strong>{skills.filter((item) => item.source === 'workspace').length}</strong>
            </div>
            <div className="page-meta-card">
              <span>内置来源</span>
              <strong>{skills.filter((item) => item.source !== 'workspace').length}</strong>
            </div>
            <div className="page-meta-card">
              <span>当前操作</span>
              <strong>{uploading ? '正在上传技能目录' : '可上传或清理技能'}</strong>
            </div>
          </div>

          <Alert
            showIcon
            type="info"
            message="请上传包含 SKILL.md 的完整技能目录。"
            description="上传后的目录会写入当前工作区的 `skills/` 下，因此无需改动 agent 核心流程就能被运行时发现。"
          />

          <div className="skills-dropzone-hint">
            <Text>
              目录结构建议为 `my-skill/SKILL.md`，并可在同级包含 `scripts/`、`references/`
              或 `assets/` 等辅助文件。
            </Text>
          </div>

          <div className="page-scroll-shell skills-scroll-shell">
            {loading ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : filteredSkills.length === 0 ? (
              <Empty
                description={skills.length === 0 ? '当前没有可用技能' : '没有匹配当前筛选条件的技能'}
                className="empty-block"
              />
            ) : (
              <Row gutter={[16, 16]} className="skills-grid">
                {filteredSkills.map((skill) => (
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
                            {skill.source === 'workspace' ? '工作区' : '内置'}
                          </Tag>
                          {skill.enabled === false ? <Tag>已禁用</Tag> : <Tag color="success">已启用</Tag>}
                        </Space>
                      }
                      actions={
                        skill.isDeletable
                          ? [
                              <Popconfirm
                                key="delete"
                                title="确定删除这个技能吗？"
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true }}
                                onConfirm={() => void handleDelete(skill.id)}
                              >
                                <Button
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  loading={deletingId === skill.id}
                                >
                                  删除
                                </Button>
                              </Popconfirm>,
                            ]
                          : undefined
                      }
                    >
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <Text type="secondary">{skill.description || '暂无描述。'}</Text>
                        {skill.author ? <Text type="secondary">作者：{skill.author}</Text> : null}
                        <div>
                          <Text type="secondary">路径</Text>
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
          </div>
        </Space>
      </div>
    </div>
  )
}
