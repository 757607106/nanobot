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

export default function SkillsPage() {
  const { message } = App.useApp()
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void loadSkills()
  }, [])

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      if (!query.trim()) {
        return true
      }
      const haystack = `${skill.name} ${skill.description} ${skill.author ?? ''} ${(skill.tags ?? []).join(' ')}`.toLowerCase()
      return haystack.includes(query.trim().toLowerCase())
    })
  }, [query, skills])

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
        title="先从技能市场拿能力"
        description="这个页面只保留三件事：打开技能市场、手动上传兜底、查看当前实例已经安装了哪些技能。"
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

      <input
        type="file"
        ref={folderInputRef}
        {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
        multiple
        style={{ display: 'none' }}
        onChange={(event) => void handleFolderSelect(event)}
      />

      <div className="page-grid skills-page-grid">
        <div className="page-stack skills-market-stack">
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>推荐路径：技能市场</Typography.Title>
                <Text type="secondary">优先去市场浏览和下载技能，当前实例内置了 ClawHub 兼容技能生态。</Text>
              </div>
              <Tag color="processing">推荐</Tag>
            </div>

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text type="secondary">
                先在市场里找到合适的技能，再把下载好的技能目录带回当前实例；如果市场里没有，也可以走下方手动上传兜底。
              </Text>
              <Space wrap>
                <Button type="primary" href="https://clawhub.ai" target="_blank" rel="noreferrer">
                  打开 ClawHub 市场
                </Button>
                <Button href="https://openclawdoc.com/docs/skills/clawhub/" target="_blank" rel="noreferrer">
                  查看市场说明
                </Button>
                <Button href="https://openclawdoc.com/docs/skills/overview/" target="_blank" rel="noreferrer">
                  查看 Skills 说明
                </Button>
              </Space>
            </Space>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>兜底路径：手动上传</Typography.Title>
                <Text type="secondary">市场外的技能目录仍可直接上传到当前工作区，不影响原版 nanobot 主链。</Text>
              </div>
              <Button
                type="primary"
                icon={<FolderOpenOutlined />}
                loading={uploading}
                onClick={() => folderInputRef.current?.click()}
              >
                上传技能目录
              </Button>
            </div>

            <Alert
              showIcon
              type="info"
              message="上传前请确认目录里包含 SKILL.md。"
              description="上传后的目录会写入当前工作区的 `skills/` 下，运行时会自动继续沿用原版技能发现机制。"
            />
          </Card>
        </div>

        <Card className="config-panel-card skills-library-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>已安装技能</Typography.Title>
              <Text type="secondary">这里只展示当前实例已经可用的技能，并保留删除工作区技能的能力。</Text>
            </div>
            <Tag>{filteredSkills.length} 项技能</Tag>
          </div>

          <div className="toolbar-row">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="按名称、描述或标签搜索技能"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="page-scroll-shell skills-scroll-shell">
            {loading ? (
              <div className="center-box">
                <Spin />
              </div>
            ) : filteredSkills.length === 0 ? (
              <Empty
                description={skills.length === 0 ? '当前还没有安装任何技能' : '没有匹配当前搜索条件的技能'}
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
        </Card>
      </div>
    </div>
  )
}
