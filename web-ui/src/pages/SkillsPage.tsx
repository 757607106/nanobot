import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import {
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
  Tabs,
  Tag,
  Typography,
} from 'antd'
import {
  AppstoreOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import { PLATFORM_BRAND_NAME, replaceBrandText } from '../branding'
import DevOnly from '../components/DevOnly'
import { MotionGroup, MotionPanel } from '../components/MotionSurface'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type { InstalledSkill, MarketplaceSkill } from '../types'

const { Text, Paragraph } = Typography

const MARKET_COMPATIBILITY_META: Record<MarketplaceSkill['compatibility'], { color: string }> = {
  native: { color: 'success' },
  partial: { color: 'warning' },
  unsupported: { color: 'error' },
  unknown: { color: 'default' },
}

function getSkillAuthorLabel(author?: string | null) {
  if (!author) {
    return null
  }
  return author.trim().toLowerCase() === 'nanobot' ? PLATFORM_BRAND_NAME : replaceBrandText(author)
}

export default function SkillsPage() {
  const { message } = App.useApp()
  const folderInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [marketLoading, setMarketLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [marketQuery, setMarketQuery] = useState('')
  const [activeTab, setActiveTab] = useState('installed')

  useEffect(() => {
    void loadSkills()
    void loadMarketplaceSkills('')
  }, [])

  const installedSkillIds = useMemo(() => new Set(skills.map((skill) => skill.id)), [skills])
  const workspaceSkillCount = useMemo(
    () => skills.filter((item) => item.source === 'workspace').length,
    [skills],
  )
  const builtInSkillCount = useMemo(
    () => skills.filter((item) => item.source !== 'workspace').length,
    [skills],
  )

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

  async function loadMarketplaceSkills(nextQuery: string) {
    try {
      setMarketLoading(true)
      const data = await api.searchMarketplaceSkills(nextQuery, 18)
      setMarketplaceSkills(data)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 SkillHub 市场失败')
    } finally {
      setMarketLoading(false)
    }
  }

  async function handleMarketplaceSearch(value?: string) {
    const nextQuery = (value ?? marketQuery).trim()
    setMarketQuery(nextQuery)
    await loadMarketplaceSkills(nextQuery)
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
      setActiveTab('installed')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '上传技能失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleZipSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      setUploading(true)
      const uploaded = await api.uploadSkillZip(formData)
      message.success(`技能“${uploaded.name}”上传成功`)
      await loadSkills()
      setActiveTab('installed')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '上传 ZIP 技能失败')
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

  async function handleInstallMarketplaceSkill(skill: MarketplaceSkill, force = false) {
    try {
      setInstallingId(skill.slug)
      const installed = await api.installMarketplaceSkill(skill.slug, force)
      message.success(force ? `技能“${installed.name}”已覆盖安装` : `技能“${installed.name}”安装成功`)
      await Promise.all([loadSkills(), loadMarketplaceSkills(marketQuery)])
      if (!force) {
        setActiveTab('installed')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : (force ? '覆盖安装技能失败' : '从 SkillHub 安装技能失败'))
    } finally {
      setInstallingId(null)
    }
  }

  const renderInstalledView = () => (
    <div className="tab-content-shell">
      <div className="toolbar-row" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索已安装技能..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ maxWidth: 400, flex: 1 }}
        />
        <Space>
          <Button
            icon={<FolderOpenOutlined />}
            loading={uploading}
            onClick={() => folderInputRef.current?.click()}
          >
            上传文件夹
          </Button>
          <Button icon={<UploadOutlined />} loading={uploading} onClick={() => zipInputRef.current?.click()}>
            上传 ZIP
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadSkills()} />
        </Space>
      </div>

      <div className="page-scroll-shell skills-scroll-shell">
        {loading ? (
          <div className="center-box" style={{ padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : filteredSkills.length === 0 ? (
          <Empty
            description={skills.length === 0 ? '还没有安装技能' : '没有匹配结果'}
            className="empty-block"
            style={{ padding: 40 }}
          />
        ) : (
          <Row gutter={[16, 16]} className="skills-grid">
            {filteredSkills.map((skill) => (
              <Col xs={24} sm={12} md={8} lg={6} xl={6} key={skill.id}>
                <MotionPanel className="skill-card-shell" standalone>
                  <Card
                    hoverable
                    className="skill-card"
                    style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                    bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column' }}
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
                                block
                              >
                                删除
                              </Button>
                            </Popconfirm>,
                          ]
                        : [<Button key="builtin" type="text" disabled>系统内置</Button>]
                    }
                  >
                    <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                       <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
                         <Text strong ellipsis style={{ fontSize: 16 }}>{skill.name}</Text>
                         <Space size={6}>
                            <Tag bordered={false} style={{ margin: 0 }}>{skill.version || '1.0.0'}</Tag>
                            <Tag color={skill.source === 'workspace' ? 'green' : 'blue'} bordered={false} style={{ margin: 0 }}>
                              {skill.source === 'workspace' ? '工作区' : '内置'}
                            </Tag>
                         </Space>
                       </Space>
                    </div>
                    
                    <div style={{ flex: 1, marginBottom: 16 }}>
                      <Paragraph type="secondary" ellipsis={{ rows: 2, expandable: false }} style={{ marginBottom: 0, minHeight: 44 }}>
                        {skill.description || '暂无描述。'}
                      </Paragraph>
                    </div>

                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      {skill.author ? <Text type="secondary" style={{ fontSize: 12 }}>作者：{getSkillAuthorLabel(skill.author)}</Text> : null}
                      {skill.tags && skill.tags.length > 0 ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', height: 24, overflow: 'hidden' }}>
                          {skill.tags.map((tag) => (
                            <Tag key={tag} style={{ margin: 0, fontSize: 12, lineHeight: '20px' }}>{tag}</Tag>
                          ))}
                        </div>
                      ) : null}
                    </Space>
                  </Card>
                </MotionPanel>
              </Col>
            ))}
          </Row>
        )}
      </div>
    </div>
  )

  const renderMarketView = () => (
    <div className="tab-content-shell">
      <div className="toolbar-row" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input.Search
          allowClear
          enterButton="搜索市场"
          prefix={<SearchOutlined />}
          placeholder="搜索 SkillHub 市场..."
          value={marketQuery}
          onChange={(event) => setMarketQuery(event.target.value)}
          onSearch={(value) => void handleMarketplaceSearch(value)}
          style={{ maxWidth: 400, flex: 1 }}
        />
        <Space>
          <Button icon={<ReloadOutlined />} loading={marketLoading} onClick={() => void handleMarketplaceSearch(marketQuery)}>
            刷新
          </Button>
          <Button href="https://skillhub.tencent.com/" target="_blank" rel="noreferrer">
            SkillHub 官网
          </Button>
        </Space>
      </div>

      <div className="page-scroll-shell skills-scroll-shell">
        {marketLoading ? (
          <div className="center-box" style={{ padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : marketplaceSkills.length === 0 ? (
          <Empty description="没有找到匹配的技能" className="empty-block" style={{ padding: 40 }} />
        ) : (
          <Row gutter={[16, 16]} className="skills-grid">
            {marketplaceSkills.map((skill) => {
              const alreadyInstalled = installedSkillIds.has(skill.slug)
              return (
                <Col xs={24} sm={12} md={8} lg={6} xl={6} key={skill.slug}>
                  <MotionPanel className="skill-card-shell" standalone>
                    <Card
                      hoverable
                      className="skill-card"
                      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                      bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                      actions={
                        alreadyInstalled
                          ? [
                              <Button
                                key="reinstall"
                                type="text"
                                icon={<ReloadOutlined />}
                                loading={installingId === skill.slug}
                                onClick={() => void handleInstallMarketplaceSkill(skill, true)}
                                block
                              >
                                覆盖安装
                              </Button>,
                            ]
                          : [
                              <Button
                                key="install"
                                type="primary"
                                ghost
                                icon={<CloudDownloadOutlined />}
                                loading={installingId === skill.slug}
                                onClick={() => void handleInstallMarketplaceSkill(skill)}
                                block
                              >
                                安装
                              </Button>,
                            ]
                      }
                    >
                      <div style={{ marginBottom: 12 }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <Text strong ellipsis style={{ fontSize: 16, flex: 1 }}>{skill.name}</Text>
                            {alreadyInstalled && <Tag color="success" style={{ margin: 0 }}>已安装</Tag>}
                         </div>
                         <Space size={6}>
                            <Tag bordered={false} style={{ margin: 0 }}>{skill.version}</Tag>
                            <Tag color={MARKET_COMPATIBILITY_META[skill.compatibility]?.color || 'default'} bordered={false} style={{ margin: 0 }}>
                              {skill.compatibilityLabel}
                            </Tag>
                         </Space>
                      </div>

                      <div style={{ flex: 1, marginBottom: 16 }}>
                        <Paragraph type="secondary" ellipsis={{ rows: 2, expandable: false }} style={{ marginBottom: 0, minHeight: 44 }}>
                          {skill.description || '暂无描述。'}
                        </Paragraph>
                      </div>

                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--nb-text-secondary)' }}>
                            <span>下载 {skill.downloads}</span>
                            <span>{skill.updatedAt ? formatDateTimeZh(skill.updatedAt).split(' ')[0] : '-'}</span>
                         </div>
                        {skill.tags && skill.tags.length > 0 ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', height: 24, overflow: 'hidden' }}>
                            {skill.tags.map((tag) => (
                              <Tag key={tag} style={{ margin: 0, fontSize: 12, lineHeight: '20px' }}>{tag}</Tag>
                            ))}
                          </div>
                        ) : null}
                      </Space>
                    </Card>
                  </MotionPanel>
                </Col>
              )
            })}
          </Row>
        )}
      </div>
    </div>
  )

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        eyebrow="扩展能力"
        title="技能中心"
        description="管理工作区已安装的技能，或从 SkillHub 市场发现新能力。"
        stats={[
          { label: '已安装', value: skills.length },
          { label: '市场资源', value: marketplaceSkills.length },
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
      <input
        type="file"
        ref={zipInputRef}
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={(event) => void handleZipSelect(event)}
      />

      <div className="page-content-wrapper" style={{ padding: '0 var(--nb-layout-gutter)' }}>
        <Tabs
          className="skills-page-tabs"
          activeKey={activeTab}
          onChange={setActiveTab}
          type="card"
          size="large"
          items={[
            {
              key: 'installed',
              label: (
                <span>
                  <AppstoreOutlined />
                  已安装技能 ({skills.length})
                </span>
              ),
              children: renderInstalledView(),
            },
            {
              key: 'market',
              label: (
                <span>
                  <CloudDownloadOutlined />
                  技能市场 ({marketplaceSkills.length})
                </span>
              ),
              children: renderMarketView(),
            },
          ]}
        />
      </div>
    </div>
  )
}