import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, InputHTMLAttributes } from 'react'
import {
  App,
  Button,
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
  Dropdown,
  theme,
} from 'antd'
import { motion } from 'framer-motion'
import {
  AppstoreOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import { PLATFORM_BRAND_NAME, replaceBrandText } from '../branding'
import PageHeader from '../components/console/PageHeader'
import MetricCard from '../components/console/MetricCard'
import SectionCard from '../components/console/SectionCard'
import { formatDateTimeZh } from '../locale'
import type { InstalledSkill, MarketplaceSkill } from '../types'
import { useToast } from '../toast'

const PAGE_SIZE = 18

const MARKET_COMPATIBILITY_META: Record<string, { color: string }> = {
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
  type,
  installed,
  actionLoading,
  onAction,
}: {
  skill: InstalledSkill | MarketplaceSkill
  type: 'installed' | 'marketplace'
  installed?: boolean
  actionLoading?: boolean
  onAction?: () => void
}) {
  const isWorkspace = 'source' in skill && skill.source === 'workspace'
  const isDeletable = 'isDeletable' in skill ? skill.isDeletable : false
  const compatibility = 'compatibility' in skill ? skill.compatibility : undefined
  const compatibilityLabel = 'compatibilityLabel' in skill ? skill.compatibilityLabel : undefined

  const avatarColor = `hsl(${(skill.name.charCodeAt(0) || 65) * 137 % 360}, 65%, 55%)`

  const bg = type === 'marketplace' && installed ? 'var(--nb-card-selected-bg)' : 'var(--nb-card-subtle-bg)'
  const border = type === 'marketplace' && installed ? '1px solid var(--nb-accent)' : '1px solid var(--nb-card-subtle-border)'

  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.06)' }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        borderRadius: 16,
        background: bg,
        border: border,
        height: '100%',
        transition: 'all 0.2s ease',
      }}
    >
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
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
              fontSize: 'var(--nb-title-xs)',
              fontWeight: 'var(--nb-font-weight-strong)',
              flexShrink: 0,
            }}
          >
            {skill.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text strong style={{ fontSize: 'var(--nb-text-lg)', display: 'block', letterSpacing: '-0.01em' }}>
              {skill.name}
            </Typography.Text>
            <Flex gap={6} style={{ marginTop: 4 }} wrap="wrap">
              <Tag bordered={false} style={{ margin: 0, borderRadius: 6, fontSize: 'var(--nb-text-2xs)' }}>
                V{skill.version || '1.0.0'}
              </Tag>
              {type === 'installed' && (
                <Tag
                  color={isWorkspace ? 'green' : 'blue'}
                  bordered={false}
                  style={{ margin: 0, borderRadius: 6, fontSize: 'var(--nb-text-2xs)' }}
                >
                  {isWorkspace ? 'LOCAL' : 'CORE'}
                </Tag>
              )}
              {type === 'marketplace' && compatibility && (
                <Tag
                  color={MARKET_COMPATIBILITY_META[compatibility]?.color || 'default'}
                  bordered={false}
                  style={{ margin: 0, borderRadius: 6, fontSize: 'var(--nb-text-2xs)' }}
                >
                  {compatibilityLabel?.toUpperCase()}
                </Tag>
              )}
            </Flex>
          </div>
        </div>

        {/* Actions */}
        {type === 'installed' ? (
          isDeletable ? (
            <Popconfirm title="确定删除这个技能吗？" onConfirm={onAction} okButtonProps={{ danger: true }}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={actionLoading} />
            </Popconfirm>
          ) : (
            <Tag bordered={false} style={{ fontSize: 'var(--nb-text-2xs)', background: 'var(--nb-card-subtle-border)' }}>BUILTIN</Tag>
          )
        ) : (
          <Button
            type={installed ? 'default' : 'primary'}
            icon={<CloudDownloadOutlined />}
            loading={actionLoading}
            onClick={onAction}
            size="small"
            style={{ borderRadius: 8 }}
          >
            {installed ? '更新' : '安装'}
          </Button>
        )}
      </Flex>

      <Typography.Paragraph
        type="secondary"
        ellipsis={{ rows: 2 }}
        style={{ fontSize: 'var(--nb-text-sm)', lineHeight: 1.6, marginBottom: 20 }}
      >
        {skill.description || '—'}
      </Typography.Paragraph>

      <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--nb-card-subtle-border)' }}>
        {type === 'installed' ? (
          <>
            {'author' in skill && skill.author && (
              <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', display: 'block', marginBottom: 8, opacity: 0.6 }}>
                DEVELOPED BY {getSkillAuthorLabel(skill.author as string)?.toUpperCase()}
              </Typography.Text>
            )}
          </>
        ) : (
          <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', opacity: 0.6 }}>
              {('downloads' in skill ? skill.downloads : 0)} 次下载
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', opacity: 0.6 }}>
              {'updatedAt' in skill && skill.updatedAt ? formatDateTimeZh(skill.updatedAt).split(' ')[0] : '-'}
            </Typography.Text>
          </Flex>
        )}
        <Flex gap={6} wrap="wrap">
          {(skill.tags || []).slice(0, 3).map((tag) => (
            <Tag key={tag} bordered={false} style={{ margin: 0, fontSize: 'var(--nb-text-2xs)', borderRadius: 4, background: 'var(--nb-card-subtle-border)' }}>
              {tag}
            </Tag>
          ))}
        </Flex>
      </div>
    </motion.div>
  )
}

export default function SkillsPage() {
  const message = useToast()
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
  const workspaceSkillCount = useMemo(
    () => skills.filter((skill) => skill.source === 'workspace').length,
    [skills],
  )
  const builtinSkillCount = useMemo(
    () => skills.filter((skill) => skill.source !== 'workspace').length,
    [skills],
  )
  const nativeMarketCount = useMemo(
    () => marketplaceSkills.filter((skill) => skill.compatibility === 'native').length,
    [marketplaceSkills],
  )
  const partialMarketCount = useMemo(
    () => marketplaceSkills.filter((skill) => skill.compatibility === 'partial').length,
    [marketplaceSkills],
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
      <SectionCard
        title="已安装能力目录"
        action={(
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void loadSkills()}
          />
        )}
      >
        <Flex vertical gap={16}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
            placeholder="搜索已安装技能..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ maxWidth: 420, borderRadius: 12, border: 'none', background: 'var(--nb-card-subtle-bg)' }}
            size="large"
          />

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--nb-spacing-2xl)' }}>
              <Spin size="large" />
            </div>
          ) : filteredSkills.length === 0 ? (
            <Empty
              image={false}
              description={skills.length === 0 ? '暂无数据' : '无匹配项'}
              style={{ padding: 'var(--nb-spacing-2xl)' }}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {filteredSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  type="installed"
                  onAction={() => void handleDelete(skill.id)}
                  actionLoading={deletingId === skill.id}
                />
              ))}
            </div>
          )}

        </Flex>
      </SectionCard>
    </div>
  )

  const renderMarketView = () => (
    <div style={{ padding: 'var(--nb-spacing-sm) 0' }}>
      <SectionCard
        title="市场能力目录"
        action={(
          <Space size="middle">
            <Button icon={<ReloadOutlined />} loading={marketLoading} onClick={() => void handleMarketplaceSearch(marketQuery)}>
              刷新
            </Button>
            <Button href="https://skillhub.tencent.com/" target="_blank" rel="noreferrer">
              SkillHub 官网
            </Button>
          </Space>
        )}
      >
        <Flex vertical gap={16}>
          <Input.Search
            allowClear
            enterButton="搜索官方市场"
            prefix={<SearchOutlined />}
            placeholder="搜索 SkillHub 市场..."
            value={marketQuery}
            onChange={(event) => setMarketQuery(event.target.value)}
            onSearch={(value) => void handleMarketplaceSearch(value)}
            style={{ maxWidth: 420, flex: 1 }}
            size="large"
          />

          {marketLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--nb-spacing-2xl)' }}>
              <Spin size="large" />
            </div>
          ) : marketplaceSkills.length === 0 ? (
            <Empty description="无匹配项" style={{ padding: 'var(--nb-spacing-2xl)' }} />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {marketplaceSkills.map((skill) => (
                  <SkillCard
                    key={skill.slug}
                    skill={skill}
                    type="marketplace"
                    installed={installedSkillIds.has(skill.slug)}
                    onAction={() => void handleInstallMarketplaceSkill(skill, installedSkillIds.has(skill.slug))}
                    actionLoading={installingId === skill.slug}
                  />
                ))}
              </div>
              {marketplaceSkills.length < marketplaceTotal && (
                <div style={{ textAlign: 'center', marginTop: 24, paddingBottom: 24 }}>
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

        </Flex>
      </SectionCard>
    </div>
  )

  return (
    <div className="page-stack">
      <PageHeader
        title="技能中心"
        actions={
          <Dropdown
            menu={{
              items: [
                {
                  key: 'folder',
                  icon: <FolderOpenOutlined />,
                  label: '上传文件夹',
                  onClick: () => folderInputRef.current?.click(),
                },
                {
                  key: 'zip',
                  icon: <UploadOutlined />,
                  label: '上传 ZIP.包',
                  onClick: () => zipInputRef.current?.click(),
                },
              ],
            }}
            placement="bottomRight"
          >
            <Button
              type="primary"
              size="large"
              loading={uploading}
              style={{ borderRadius: 12 }}
            >
              本地安装 <DownOutlined />
            </Button>
          </Dropdown>
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

      {/* 动态显示的头部 Metric 卡片 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        {activeTab === 'installed' ? (
          <>
            <MetricCard label="已安装合计" value={skills.length} icon={<AppstoreOutlined />} tone="neutral" />
            <MetricCard label="本地开发加载" value={workspaceSkillCount} icon={<FolderOpenOutlined />} tone="success" />
            <MetricCard label="内置能力引擎" value={builtinSkillCount} icon={<AppstoreOutlined />} tone="primary" />
          </>
        ) : (
          <>
            <MetricCard label="官方市场总收录" value={marketplaceTotal} icon={<CloudDownloadOutlined />} tone="primary" />
            <MetricCard label="原生完美兼容" value={nativeMarketCount} icon={<DownloadOutlined />} tone="success" />
            <MetricCard label="API 部分兼容" value={partialMarketCount} icon={<DownloadOutlined />} tone="warning" />
          </>
        )}
      </div>

      <div className="page-content-wrapper" style={{ paddingInline: 'var(--nb-layout-gutter)' }}>
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
                  已安装技能
                </span>
              ),
              children: renderInstalledView(),
            },
            {
              key: 'market',
              label: (
                <span>
                  <CloudDownloadOutlined />
                  官方技能市场
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
