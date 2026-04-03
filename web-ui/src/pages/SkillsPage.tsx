import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Popconfirm,
  Row,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  theme,
} from 'antd'
import { motion } from 'framer-motion'
import {
  AppstoreOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import { PLATFORM_BRAND_NAME, replaceBrandText } from '../branding'
import { MotionPanel } from '../components/MotionSurface'
import PageHeader from '../components/console/PageHeader'
import { formatDateTimeZh } from '../locale'
import type { InstalledSkill, MarketplaceSkill } from '../types'

const { Text, Paragraph } = Typography
const PAGE_SIZE = 18

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

function SkillCard({
  skill,
  isInstalled,
  onDelete,
  onInstall,
  deleting,
  installing,
}: {
  skill: {
    name: string
    description?: string | null
    version?: string | null
    author?: string | null
    tags?: string[] | null
  }
  isInstalled?: boolean
  onDelete?: () => void
  onInstall?: (force?: boolean) => void
  deleting?: boolean
  installing?: boolean
}) {
  const { token } = theme.useToken()

  // Generate avatar color from skill name
  const avatarColor = `hsl(${(skill.name.charCodeAt(0) || 65) * 137 % 360}, 65%, 55%)`

  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.06)' }}
      className="h-full"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--nb-spacing-md)',
        borderRadius: 'var(--nb-radius-card)',
        background: 'var(--nb-card-subtle-bg)',
        border: '1px solid var(--nb-card-subtle-border)',
        transition: 'all 0.2s ease',
      }}
    >
      <div className="flex justify-between items-start" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-3" style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: avatarColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {skill.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text strong ellipsis style={{ fontSize: 15, display: 'block', letterSpacing: '-0.01em' }}>
              {skill.name}
            </Typography.Text>
            <Tag bordered={false} style={{ marginTop: 4, borderRadius: 6, fontSize: 11 }}>
              V{skill.version || '1.0.0'}
            </Tag>
          </div>
        </div>
      </div>

      <Typography.Paragraph
        type="secondary"
        ellipsis={{ rows: 2 }}
        style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}
      >
        {skill.description || '暂无详细描述。'}
      </Typography.Paragraph>

      <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--nb-card-subtle-border)' }}>
        {skill.author && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8, opacity: 0.7 }}>
            BY {getSkillAuthorLabel(skill.author)?.toUpperCase()}
          </Typography.Text>
        )}
        <Flex gap={6} wrap="wrap">
          {(skill.tags || []).slice(0, 3).map((tag) => (
            <Tag key={tag} bordered={false} style={{ margin: 0, fontSize: 11, borderRadius: 4, background: 'var(--nb-card-subtle-border)' }}>
              {tag}
            </Tag>
          ))}
        </Flex>
      </div>
    </motion.div>
  )
}

function InstalledSkillCard({
  skill,
  onDelete,
  deleting,
}: {
  skill: InstalledSkill
  onDelete: () => void
  deleting: boolean
}) {
  const { token } = theme.useToken()

  // Generate avatar color from skill name
  const avatarColor = `hsl(${(skill.name.charCodeAt(0) || 65) * 137 % 360}, 65%, 55%)`

  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.06)' }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--nb-spacing-md)',
        borderRadius: 'var(--nb-radius-card)',
        background: 'var(--nb-card-subtle-bg)',
        border: '1px solid var(--nb-card-subtle-border)',
        height: '100%',
        transition: 'all 0.2s ease',
      }}
    >
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-3" style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: avatarColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 18,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {skill.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text strong style={{ fontSize: 15, display: 'block', letterSpacing: '-0.01em' }}>
              {skill.name}
            </Typography.Text>
            <Flex gap={6} style={{ marginTop: 4 }} wrap="wrap">
              <Tag bordered={false} style={{ margin: 0, borderRadius: 6, fontSize: 11 }}>
                V{skill.version || '1.0.0'}
              </Tag>
              <Tag
                color={skill.source === 'workspace' ? 'green' : 'blue'}
                bordered={false}
                style={{ margin: 0, borderRadius: 6, fontSize: 11 }}
              >
                {skill.source === 'workspace' ? 'LOCAL' : 'CORE'}
              </Tag>
            </Flex>
          </div>
        </div>
        {skill.isDeletable ? (
          <Popconfirm title="确定删除这个技能吗？" onConfirm={onDelete} okButtonProps={{ danger: true }}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={deleting} />
          </Popconfirm>
        ) : (
          <Tag bordered={false} style={{ fontSize: 11, background: 'var(--nb-card-subtle-border)' }}>BUILTIN</Tag>
        )}
      </Flex>

      <Typography.Paragraph
        type="secondary"
        ellipsis={{ rows: 2 }}
        style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}
      >
        {skill.description || '暂无详细描述。'}
      </Typography.Paragraph>

      <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--nb-card-subtle-border)' }}>
        {skill.author && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8, opacity: 0.6 }}>
            DEVELOPED BY {getSkillAuthorLabel(skill.author)?.toUpperCase()}
          </Typography.Text>
        )}
        <Flex gap={6} wrap="wrap">
          {(skill.tags || []).slice(0, 3).map((tag) => (
            <Tag key={tag} bordered={false} style={{ margin: 0, fontSize: 11, borderRadius: 4, background: 'var(--nb-card-subtle-border)' }}>
              {tag}
            </Tag>
          ))}
        </Flex>
      </div>
    </motion.div>
  )
}

function MarketplaceSkillCard({
  skill,
  alreadyInstalled,
  onInstall,
  installing,
}: {
  skill: MarketplaceSkill
  alreadyInstalled: boolean
  onInstall: (force?: boolean) => void
  installing: boolean
}) {
  // Generate avatar color from skill name
  const avatarColor = `hsl(${(skill.name.charCodeAt(0) || 65) * 137 % 360}, 65%, 55%)`

  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.06)' }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--nb-spacing-md)',
        borderRadius: 'var(--nb-radius-card)',
        background: alreadyInstalled ? 'var(--nb-card-selected-bg)' : 'var(--nb-card-subtle-bg)',
        border: alreadyInstalled ? '1px solid var(--nb-accent)' : '1px solid var(--nb-card-subtle-border)',
        height: '100%',
        transition: 'all 0.2s ease',
      }}
    >
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-3" style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: avatarColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 18,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {skill.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text strong style={{ fontSize: 15, display: 'block', letterSpacing: '-0.01em' }}>
              {skill.name}
            </Typography.Text>
            <Flex gap={6} style={{ marginTop: 4 }} wrap="wrap">
              <Tag bordered={false} style={{ margin: 0, borderRadius: 6, fontSize: 11 }}>
                V{skill.version}
              </Tag>
              <Tag
                color={MARKET_COMPATIBILITY_META[skill.compatibility]?.color || 'default'}
                bordered={false}
                style={{ margin: 0, borderRadius: 6, fontSize: 11 }}
              >
                {skill.compatibilityLabel.toUpperCase()}
              </Tag>
            </Flex>
          </div>
        </div>
        <Button
          type={alreadyInstalled ? 'default' : 'primary'}
          icon={<CloudDownloadOutlined />}
          loading={installing}
          onClick={() => onInstall(alreadyInstalled)}
          size="small"
          style={{ borderRadius: 8 }}
        >
          {alreadyInstalled ? '更新' : '安装'}
        </Button>
      </Flex>

      <Typography.Paragraph
        type="secondary"
        ellipsis={{ rows: 2 }}
        style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}
      >
        {skill.description || '暂无详细描述。'}
      </Typography.Paragraph>

      <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--nb-card-subtle-border)' }}>
        <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
           <Typography.Text type="secondary" style={{ fontSize: 12, opacity: 0.6 }}>
            {skill.downloads} 次下载
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, opacity: 0.6 }}>
            {skill.updatedAt ? formatDateTimeZh(skill.updatedAt).split(' ')[0] : '-'}
          </Typography.Text>
        </Flex>
        <Flex gap={6} wrap="wrap">
          {(skill.tags || []).slice(0, 3).map((tag) => (
            <Tag key={tag} bordered={false} style={{ margin: 0, fontSize: 11, borderRadius: 4, background: 'var(--nb-card-subtle-border)' }}>
              {tag}
            </Tag>
          ))}
        </Flex>
      </div>
    </motion.div>
  )
}

export default function SkillsPage() {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const folderInputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([])
  const [marketplaceTotal, setMarketplaceTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [marketLoading, setMarketLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
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

  async function loadMarketplaceSkills(nextQuery: string, append = false) {
    const offset = append ? marketplaceSkills.length : 0
    try {
      if (append) {
        setLoadingMore(true)
      } else {
        setMarketLoading(true)
      }
      const data = await api.searchMarketplaceSkills(nextQuery, PAGE_SIZE, offset)
      if (append) {
        setMarketplaceSkills((prev) => [...prev, ...data.skills])
      } else {
        setMarketplaceSkills(data.skills)
      }
      setMarketplaceTotal(data.total)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 SkillHub 市场失败')
    } finally {
      if (append) {
        setLoadingMore(false)
      } else {
        setMarketLoading(false)
      }
    }
  }

  async function handleMarketplaceSearch(value?: string) {
    const nextQuery = (value ?? marketQuery).trim()
    setMarketQuery(nextQuery)
    await loadMarketplaceSkills(nextQuery, false)
  }

  async function handleLoadMore() {
    await loadMarketplaceSkills(marketQuery, true)
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
      message.success(`技能"${uploaded.name}"上传成功`)
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
      message.success(`技能"${uploaded.name}"上传成功`)
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
      message.success(force ? `技能"${installed.name}"已覆盖安装` : `技能"${installed.name}"安装成功`)
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
    <div style={{ padding: 'var(--nb-spacing-xs) 0' }}>
      <Flex justify="space-between" align="center" gap={16} wrap="wrap" style={{ marginBottom: 24 }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
          placeholder="搜索已安装技能..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ maxWidth: 400, borderRadius: 12, border: 'none', background: 'var(--nb-card-subtle-bg)' }}
          size="large"
        />
        <Button
          size="large"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void loadSkills()}
          style={{ borderRadius: 12 }}
        />
      </Flex>

      <div className="overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center" style={{ padding: 'var(--nb-spacing-2xl)' }}>
            <Spin size="large" />
          </div>
        ) : filteredSkills.length === 0 ? (
          <Empty
            image={false}
            description={skills.length === 0 ? '还没有安装技能' : '没有匹配结果'}
            style={{ padding: 'var(--nb-spacing-2xl)' }}
          />
        ) : (
          <Row gutter={[16, 16]}>
            {filteredSkills.map((skill) => (
              <Col xs={24} sm={12} md={8} lg={8} xl={6} key={skill.id}>
                <InstalledSkillCard
                  skill={skill}
                  onDelete={() => void handleDelete(skill.id)}
                  deleting={deletingId === skill.id}
                />
              </Col>
            ))}
          </Row>
        )}
      </div>
    </div>
  )

  const renderMarketView = () => (
    <div style={{ padding: 'var(--nb-spacing-sm) 0' }}>
      <div className="flex flex-wrap gap-4 items-center" style={{ marginBottom: 24 }}>
        <Input.Search
          allowClear
          enterButton="搜索市场"
          prefix={<SearchOutlined />}
          placeholder="搜索 SkillHub 市场..."
          value={marketQuery}
          onChange={(event) => setMarketQuery(event.target.value)}
          onSearch={(value) => void handleMarketplaceSearch(value)}
          style={{ maxWidth: 400, flex: 1 }}
          size="large"
        />
        <Space size="middle">
          <Button size="large" icon={<ReloadOutlined />} loading={marketLoading} onClick={() => void handleMarketplaceSearch(marketQuery)}>
            刷新
          </Button>
          <Button size="large" href="https://skillhub.tencent.com/" target="_blank" rel="noreferrer">
            SkillHub 官网
          </Button>
        </Space>
      </div>

      <div className="overflow-auto">
        {marketLoading ? (
          <div className="flex items-center justify-center" style={{ padding: 'var(--nb-spacing-2xl)' }}>
            <Spin size="large" />
          </div>
        ) : marketplaceSkills.length === 0 ? (
          <Empty description="没有找到匹配的技能" style={{ padding: 'var(--nb-spacing-2xl)' }} />
        ) : (
          <>
            <Row gutter={[16, 16]}>
              {marketplaceSkills.map((skill) => (
                <Col xs={24} sm={12} md={8} lg={8} xl={6} key={skill.slug}>
                  <MarketplaceSkillCard
                    skill={skill}
                    alreadyInstalled={installedSkillIds.has(skill.slug)}
                    onInstall={(force) => void handleInstallMarketplaceSkill(skill, force)}
                    installing={installingId === skill.slug}
                  />
                </Col>
              ))}
            </Row>
            {marketplaceSkills.length < marketplaceTotal && (
              <div className="text-center" style={{ marginTop: 24 }}>
                <Button
                  type="default"
                  icon={loadingMore ? <LoadingOutlined /> : <DownloadOutlined />}
                  loading={loadingMore}
                  onClick={() => void handleLoadMore()}
                  style={{ minWidth: 160 }}
                >
                  {loadingMore ? '加载中...' : `加载更多 (${marketplaceSkills.length}/${marketplaceTotal})`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="page-stack">
      <PageHeader
        title="技能中心"
        subtitle="管理已安装技能和技能市场"
        actions={
          <Space size={8}>
            <Button
              size="large"
              icon={<FolderOpenOutlined />}
              loading={uploading}
              onClick={() => folderInputRef.current?.click()}
              style={{ borderRadius: 12 }}
            >
              上传文件夹
            </Button>
            <Button
              size="large"
              icon={<UploadOutlined />}
              loading={uploading}
              onClick={() => zipInputRef.current?.click()}
              style={{ borderRadius: 12 }}
            >
              上传 ZIP
            </Button>
          </Space>
        }
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

      <div className="page-content-wrapper px-[var(--nb-layout-gutter)]">
        <Tabs
          className="skills-page-tabs"
          activeKey={activeTab}
          onChange={setActiveTab}
          type="line"
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
                  技能市场 ({marketplaceTotal})
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
