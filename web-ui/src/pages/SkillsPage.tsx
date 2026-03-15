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
  DownloadOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import { PLATFORM_BRAND_NAME, replaceBrandText } from '../branding'
import PageHero from '../components/PageHero'
import { formatDateTimeZh } from '../locale'
import type { InstalledSkill, MarketplaceSkill } from '../types'
const { Text } = Typography

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

  useEffect(() => {
    void loadSkills()
    void loadMarketplaceSkills('')
  }, [])

  const installedSkillIds = useMemo(() => new Set(skills.map((skill) => skill.id)), [skills])

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
    } catch (error) {
      message.error(error instanceof Error ? error.message : (force ? '覆盖安装技能失败' : '从 SkillHub 安装技能失败'))
    } finally {
      setInstallingId(null)
    }
  }

  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact"
        eyebrow="技能管理"
        title="先从技能市场拿能力"
        description="优先从 SkillHub 远端市场直接安装技能，手动上传只作为兜底；右侧始终展示当前实例已经装好的能力。"
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
            <Button icon={<UploadOutlined />} loading={uploading} onClick={() => zipInputRef.current?.click()}>
              上传 ZIP
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
      <input
        type="file"
        ref={zipInputRef}
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={(event) => void handleZipSelect(event)}
      />

      <div className="page-grid skills-page-grid">
        <div className="page-stack skills-market-stack">
          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>推荐路径：SkillHub 远端市场</Typography.Title>
                <Text type="secondary">直接搜索官方市场并安装到当前工作区。</Text>
              </div>
              <Space wrap size={8}>
                <Tag color="processing">推荐</Tag>
                <Tag>{marketplaceSkills.length} 个结果</Tag>
              </Space>
            </div>

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Input.Search
                allowClear
                enterButton="搜索 SkillHub"
                prefix={<SearchOutlined />}
                placeholder="输入技能名称、描述或关键词"
                value={marketQuery}
                onChange={(event) => setMarketQuery(event.target.value)}
                onSearch={(value) => void handleMarketplaceSearch(value)}
              />
              <Space wrap>
                <Button icon={<ReloadOutlined />} loading={marketLoading} onClick={() => void handleMarketplaceSearch(marketQuery)}>
                  刷新结果
                </Button>
                <Button href="https://skillhub.tencent.com/" target="_blank" rel="noreferrer">
                  打开 SkillHub 官网
                </Button>
              </Space>

              <div className="page-scroll-shell skills-scroll-shell">
                {marketLoading ? (
                  <div className="center-box">
                    <Spin />
                  </div>
                ) : marketplaceSkills.length === 0 ? (
                  <Empty description="SkillHub 暂时没有匹配技能" className="empty-block" />
                ) : (
                  <Row gutter={[16, 16]} className="skills-grid">
                    {marketplaceSkills.map((skill) => {
                      const alreadyInstalled = installedSkillIds.has(skill.slug)
                      return (
                        <Col xs={24} md={12} key={skill.slug}>
                          <Card
                            title={
                              <Space wrap>
                                <span>{skill.name}</span>
                                {skill.version ? <Tag>{skill.version}</Tag> : null}
                              </Space>
                            }
                            extra={
                              <Space>
                                <Tag color="blue">{skill.source}</Tag>
                                {alreadyInstalled ? <Tag color="success">已安装</Tag> : null}
                              </Space>
                            }
                            actions={
                              alreadyInstalled
                                ? [
                                    <Button
                                      key="reinstall"
                                      type="text"
                                      icon={<ReloadOutlined />}
                                      loading={installingId === skill.slug}
                                      onClick={() => void handleInstallMarketplaceSkill(skill, true)}
                                    >
                                      覆盖安装
                                    </Button>,
                                  ]
                                : [
                                    <Button
                                      key="install"
                                      type="text"
                                      icon={<DownloadOutlined />}
                                      loading={installingId === skill.slug}
                                      onClick={() => void handleInstallMarketplaceSkill(skill)}
                                    >
                                      安装到工作区
                                    </Button>,
                                  ]
                            }
                          >
                            <Space direction="vertical" size="small" style={{ width: '100%' }}>
                              <Text type="secondary">{skill.description || '暂无描述。'}</Text>
                              <Space wrap size={8}>
                                <Tag color={MARKET_COMPATIBILITY_META[skill.compatibility]?.color || 'default'}>
                                  {skill.compatibilityLabel}
                                </Tag>
                                {typeof skill.downloads === 'number' ? <Tag>下载 {skill.downloads}</Tag> : null}
                                {skill.updatedAt ? <Tag>更新于 {formatDateTimeZh(skill.updatedAt)}</Tag> : null}
                              </Space>
                              {skill.compatibilityReasons && skill.compatibilityReasons.length > 0 ? (
                                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                  {skill.compatibilityReasons.map((reason) => (
                                    <Text key={reason} type={skill.compatibility === 'unsupported' ? undefined : 'secondary'}>
                                      {replaceBrandText(reason)}
                                    </Text>
                                  ))}
                                </Space>
                              ) : null}
                              {skill.tags && skill.tags.length > 0 ? (
                                <Space wrap size={4}>
                                  {skill.tags.map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                  ))}
                                </Space>
                              ) : null}
                              {skill.homepage ? (
                                <Button type="link" href={skill.homepage} target="_blank" rel="noreferrer" style={{ paddingInline: 0 }}>
                                  查看市场详情
                                </Button>
                              ) : null}
                            </Space>
                          </Card>
                        </Col>
                      )
                    })}
                  </Row>
                )}
              </div>
            </Space>
          </Card>

          <Card className="config-panel-card">
            <div className="config-card-header">
              <div className="page-section-title">
                <Typography.Title level={4}>兜底路径：手动上传</Typography.Title>
                <Text type="secondary">市场外的技能目录或 ZIP 包都可以直接上传到当前工作区。</Text>
              </div>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<FolderOpenOutlined />}
                  loading={uploading}
                  onClick={() => folderInputRef.current?.click()}
                >
                  上传技能目录
                </Button>
                <Button icon={<UploadOutlined />} loading={uploading} onClick={() => zipInputRef.current?.click()}>
                  上传技能 ZIP
                </Button>
              </Space>
            </div>

            <Alert
              showIcon
              type="info"
              message="上传前请确认目录或 ZIP 里包含 SKILL.md。"
              description="上传后会写入当前工作区的 `skills/` 目录；ZIP 仅支持单个技能包。"
            />
          </Card>
        </div>

        <Card className="config-panel-card skills-library-card">
          <div className="config-card-header">
            <div className="page-section-title">
              <Typography.Title level={4}>已安装技能</Typography.Title>
              <Text type="secondary">这里展示当前实例可用的技能。</Text>
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
                description={skills.length === 0 ? '还没有安装技能' : '没有匹配结果'}
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
                        {skill.author ? <Text type="secondary">作者：{getSkillAuthorLabel(skill.author)}</Text> : null}
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
