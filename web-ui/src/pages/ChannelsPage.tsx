import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd'
import {
  DownOutlined,
  LinkOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import {
  channelCategoryLabels,
  channelMetas,
  type ChannelMeta,
  type FieldMeta,
} from '../configMeta'
import { testIds } from '../testIds'
import type {
  ChannelDeliverySettings,
  ChannelDetailResponse,
  ChannelListResponse,
  ChannelProbeResult,
  ChannelStateItem,
} from '../types'

const { Text } = Typography

const channelIcons: Record<string, string> = {
  telegram: '✈️',
  whatsapp: '🟢',
  discord: '🎮',
  qq: '🐧',
  slack: '💬',
  matrix: '🔷',
  feishu: '🪽',
  dingtalk: '📘',
  wecom: '🧩',
  mochat: '🧠',
  email: '✉️',
}

const statusColorMap: Record<ChannelStateItem['status'], string> = {
  unconfigured: 'default',
  configured: 'blue',
  enabled: 'green',
  incomplete: 'orange',
}

const probeColorMap: Record<ChannelProbeResult['status'], string> = {
  passed: 'green',
  warning: 'orange',
  failed: 'red',
  manual: 'blue',
}

function parseList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getFieldValue(root: Record<string, unknown>, path: string[]) {
  return path.reduce<unknown>((cursor, segment) => {
    if (cursor && typeof cursor === 'object') {
      return (cursor as Record<string, unknown>)[segment]
    }
    return undefined
  }, root)
}

function updateNestedValue(root: Record<string, unknown>, path: string[], value: unknown) {
  const next = structuredClone(root) as Record<string, unknown>
  let cursor: Record<string, unknown> = next

  path.slice(0, -1).forEach((segment) => {
    const existing = cursor[segment]
    if (!existing || typeof existing !== 'object') {
      cursor[segment] = {}
    }
    cursor = cursor[segment] as Record<string, unknown>
  })

  cursor[path[path.length - 1]] = value
  return next
}

function getMissingFieldLabels(channelName: string, fields: string[]) {
  const meta = channelMetas.find((item) => item.name === channelName)
  if (!meta) {
    return fields
  }
  return fields.map((field) => meta.primaryFields.find((item) => item.path[0] === field)?.label || field)
}

export default function ChannelsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [data, setData] = useState<ChannelListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [deliveryDraft, setDeliveryDraft] = useState<ChannelDeliverySettings>({
    sendProgress: true,
    sendToolHints: false,
  })
  const [expandedNames, setExpandedNames] = useState<string[]>([])
  const [detailMap, setDetailMap] = useState<Record<string, ChannelDetailResponse>>({})
  const [draftMap, setDraftMap] = useState<Record<string, Record<string, unknown>>>({})
  const [probeMap, setProbeMap] = useState<Record<string, ChannelProbeResult | null>>({})
  const [loadingDetailName, setLoadingDetailName] = useState<string | null>(null)
  const [savingChannelName, setSavingChannelName] = useState<string | null>(null)
  const [testingChannelName, setTestingChannelName] = useState<string | null>(null)
  const [togglingChannelName, setTogglingChannelName] = useState<string | null>(null)

  useEffect(() => {
    void loadChannels()
  }, [])

  const itemsByName = useMemo(
    () => new Map((data?.items ?? []).map((item) => [item.name, item])),
    [data?.items],
  )

  const orderedChannels = useMemo(() => {
    const known = channelMetas
      .filter((meta) => itemsByName.has(meta.name))
      .map((meta) => ({
        meta,
        state: itemsByName.get(meta.name),
      }))

    const extras = (data?.items ?? [])
      .filter((item) => !channelMetas.some((meta) => meta.name === item.name))
      .map((item) => ({
        meta: {
          name: item.name,
          label: item.name,
          category: 'Collaboration' as ChannelMeta['category'],
          description: item.statusDetail || '未登记的渠道元数据。',
          primaryFields: [],
        },
        state: item,
      }))

    return [...known, ...extras]
  }, [data?.items, itemsByName])

  const stats = useMemo(() => {
    const items = data?.items ?? []
    return {
      enabled: items.filter((item) => item.status === 'enabled').length,
      configured: items.filter((item) => item.status === 'configured' || item.status === 'enabled').length,
      incomplete: items.filter((item) => item.status === 'incomplete').length,
      total: items.length,
    }
  }, [data?.items])

  async function loadChannels() {
    try {
      setLoading(true)
      const result = await api.getChannels()
      setData(result)
      setDeliveryDraft(result.delivery)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载渠道列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadChannelDetail(channelName: string, force = false) {
    if (!force && detailMap[channelName]) {
      return detailMap[channelName]
    }
    try {
      setLoadingDetailName(channelName)
      const result = await api.getChannel(channelName)
      setDetailMap((current) => ({ ...current, [channelName]: result }))
      setDraftMap((current) => ({ ...current, [channelName]: result.config }))
      return result
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载渠道详情失败')
      return null
    } finally {
      setLoadingDetailName((current) => (current === channelName ? null : current))
    }
  }

  function syncChannelState(nextChannel: ChannelStateItem) {
    setData((current) => {
      if (!current) {
        return current
      }
      return {
        ...current,
        items: current.items.map((item) => (item.name === nextChannel.name ? nextChannel : item)),
      }
    })
  }

  async function saveDelivery() {
    try {
      setSavingDelivery(true)
      const result = await api.updateChannelDelivery(deliveryDraft)
      setData(result)
      setDeliveryDraft(result.delivery)
      message.success('投递行为已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存投递行为失败')
    } finally {
      setSavingDelivery(false)
    }
  }

  async function toggleExpand(channelName: string) {
    const expanded = expandedNames.includes(channelName)
    setExpandedNames((current) =>
      expanded ? current.filter((item) => item !== channelName) : [...current, channelName],
    )
    if (!expanded) {
      await loadChannelDetail(channelName)
    }
  }

  function updateDraft(channelName: string, path: string[], value: unknown) {
    setDraftMap((current) => ({
      ...current,
      [channelName]: updateNestedValue(current[channelName] || {}, path, value),
    }))
  }

  async function handleSaveChannel(channelName: string) {
    const draft = draftMap[channelName]
    if (!draft) {
      return
    }
    try {
      setSavingChannelName(channelName)
      const result = await api.updateChannel(channelName, draft)
      setDetailMap((current) => ({ ...current, [channelName]: result }))
      setDraftMap((current) => ({ ...current, [channelName]: result.config }))
      syncChannelState(result.channel)
      message.success('渠道配置已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存渠道配置失败')
    } finally {
      setSavingChannelName((current) => (current === channelName ? null : current))
    }
  }

  async function handleTestChannel(channelName: string) {
    const draft = draftMap[channelName]
    if (!draft) {
      return
    }
    try {
      setTestingChannelName(channelName)
      const result = await api.testChannel(channelName, draft)
      setProbeMap((current) => ({ ...current, [channelName]: result }))
      message.success(result.status === 'passed' ? '渠道测试通过' : '渠道测试已完成')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试渠道失败')
    } finally {
      setTestingChannelName((current) => (current === channelName ? null : current))
    }
  }

  async function handleToggleEnabled(channelName: string, enabled: boolean) {
    try {
      setTogglingChannelName(channelName)
      const detail = (detailMap[channelName] || (await loadChannelDetail(channelName, true))) as ChannelDetailResponse | null
      if (!detail) {
        return
      }
      const payload = { ...(draftMap[channelName] || detail.config), enabled }
      const result = await api.updateChannel(channelName, payload)
      setDetailMap((current) => ({ ...current, [channelName]: result }))
      setDraftMap((current) => ({ ...current, [channelName]: result.config }))
      syncChannelState(result.channel)
      message.success(enabled ? '渠道已启用' : '渠道已停用')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新渠道状态失败')
    } finally {
      setTogglingChannelName((current) => (current === channelName ? null : current))
    }
  }

  function renderField(channelName: string, field: FieldMeta) {
    const draft = draftMap[channelName] || {}
    const value = getFieldValue(draft, field.path)

    if (field.kind === 'switch') {
      return (
        <div className="channel-inline-field" key={field.path.join('.')}>
          <div className="channel-inline-field-copy">
            <span>{field.label}</span>
            {field.description ? <small>{field.description}</small> : null}
          </div>
          <Switch checked={Boolean(value)} onChange={(checked) => updateDraft(channelName, field.path, checked)} />
        </div>
      )
    }

    if (field.kind === 'number') {
      return (
        <label className="channel-inline-field" key={field.path.join('.')}>
          <div className="channel-inline-field-copy">
            <span>{field.label}</span>
          </div>
          <InputNumber
            min={field.min}
            max={field.max}
            step={field.step}
            value={typeof value === 'number' ? value : undefined}
            style={{ width: '100%' }}
            onChange={(next) => updateDraft(channelName, field.path, next ?? 0)}
          />
        </label>
      )
    }

    if (field.kind === 'list') {
      return (
        <label className="channel-inline-field" key={field.path.join('.')}>
          <div className="channel-inline-field-copy">
            <span>{field.label}</span>
          </div>
          <Input.TextArea
            rows={4}
            value={Array.isArray(value) ? value.join('\n') : ''}
            placeholder={field.placeholder}
            onChange={(event) => updateDraft(channelName, field.path, parseList(event.target.value))}
          />
        </label>
      )
    }

    if (field.kind === 'textarea') {
      return (
        <label className="channel-inline-field" key={field.path.join('.')}>
          <div className="channel-inline-field-copy">
            <span>{field.label}</span>
          </div>
          <Input.TextArea
            rows={4}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            onChange={(event) => updateDraft(channelName, field.path, event.target.value)}
          />
        </label>
      )
    }

    if (field.kind === 'select') {
      return (
        <label className="channel-inline-field" key={field.path.join('.')}>
          <div className="channel-inline-field-copy">
            <span>{field.label}</span>
          </div>
          <Select
            value={typeof value === 'string' ? value : undefined}
            options={field.options}
            style={{ width: '100%' }}
            onChange={(next) => updateDraft(channelName, field.path, next)}
          />
        </label>
      )
    }

    const sharedProps = {
      value: String(value ?? ''),
      placeholder: field.placeholder,
      onChange: (event: ChangeEvent<HTMLInputElement>) => updateDraft(channelName, field.path, event.target.value),
    }

    return (
      <label className="channel-inline-field" key={field.path.join('.')}>
        <div className="channel-inline-field-copy">
          <span>{field.label}</span>
        </div>
        {field.kind === 'password' ? <Input.Password {...sharedProps} /> : <Input {...sharedProps} />}
      </label>
    )
  }

  if (loading) {
    return (
      <div className="center-box page-card">
        <Spin />
      </div>
    )
  }

  if (!data) {
    return <Empty description="当前无法读取渠道列表" className="page-card" />
  }

  return (
    <section className="channels-registry-shell">
      <div className="channels-registry-topbar">
        <div className="channels-registry-title-chip">渠道管理</div>
        <div className="channels-registry-topbar-actions">
          <Button icon={<ReloadOutlined />} onClick={() => void loadChannels()}>
            刷新
          </Button>
          <Button icon={<LinkOutlined />} onClick={() => navigate('/channels/bindings')}>
            消息路由
          </Button>
        </div>
      </div>

      <div className="channels-registry-summary">
        <div className="channels-registry-summary-card">
          <span>已启用</span>
          <strong>{stats.enabled}</strong>
        </div>
        <div className="channels-registry-summary-card">
          <span>已配置</span>
          <strong>{stats.configured}</strong>
        </div>
        <div className="channels-registry-summary-card">
          <span>待补全</span>
          <strong>{stats.incomplete}</strong>
        </div>
        <div className="channels-registry-summary-card">
          <span>总数</span>
          <strong>{stats.total}</strong>
        </div>
      </div>

      <div className="channels-delivery-card">
        <div className="channels-delivery-copy">
          <strong>消息投递设置</strong>
          <span>保留当前项目的全局投递能力，用于控制渠道内是否显示执行进度和工具提示。</span>
        </div>
        <div className="channels-delivery-actions">
          <div className="channels-delivery-flag">
            <div>
              <span>推送执行进度</span>
              <small>把执行进度同步到消息渠道</small>
            </div>
            <Switch
              checked={deliveryDraft.sendProgress}
              onChange={(checked) => setDeliveryDraft((current) => ({ ...current, sendProgress: checked }))}
            />
          </div>
          <div className="channels-delivery-flag">
            <div>
              <span>推送操作提示</span>
              <small>在渠道里显示工具调用提示</small>
            </div>
            <Switch
              checked={deliveryDraft.sendToolHints}
              onChange={(checked) => setDeliveryDraft((current) => ({ ...current, sendToolHints: checked }))}
            />
          </div>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={savingDelivery}
            onClick={() => void saveDelivery()}
            data-testid={testIds.channels.deliverySave}
          >
            保存投递设置
          </Button>
        </div>
      </div>

      <div className="channels-registry-list">
        {orderedChannels.map(({ meta, state }) => {
          const expanded = expandedNames.includes(meta.name)
          const detail = detailMap[meta.name]
          const probeResult = probeMap[meta.name]
          const missingLabels = getMissingFieldLabels(meta.name, state?.missingRequiredFields || [])
          const isInlineLoading = loadingDetailName === meta.name

          return (
            <article key={meta.name} className={`channels-registry-row ${expanded ? 'is-expanded' : ''}`}>
              <div className="channels-registry-row-head">
                <button
                  type="button"
                  className="channels-registry-row-trigger"
                  onClick={() => void toggleExpand(meta.name)}
                >
                  <span className="channels-registry-row-icon">{channelIcons[meta.name] || '📡'}</span>
                  <div className="channels-registry-row-copy">
                    <div className="channels-registry-row-title">
                      <strong>{meta.label}</strong>
                      <Tag color={statusColorMap[state?.status || 'unconfigured']}>
                        {state?.statusLabel || '未配置'}
                      </Tag>
                      <Tag>{channelCategoryLabels[meta.category]}</Tag>
                    </div>
                    <div className="channels-registry-row-subtitle">
                      {meta.description}
                    </div>
                    <div className="channels-registry-row-hint">
                      {state?.statusDetail || '尚未读取运行状态。'}
                    </div>
                  </div>
                </button>

                <div className="channels-registry-row-meta">
                  <div className="channels-registry-row-badges">
                    {missingLabels.length > 0 ? (
                      <Tag color="orange">{`${missingLabels.length} 个字段待补全`}</Tag>
                    ) : (
                      <Tag color={state?.enabled ? 'green' : 'default'}>
                        {state?.enabled ? '已接入运行时' : '可继续启用'}
                      </Tag>
                    )}
                  </div>
                  <div className="channels-registry-row-actions">
                    <Switch
                      checked={Boolean(draftMap[meta.name]?.enabled ?? state?.enabled)}
                      loading={togglingChannelName === meta.name}
                      onChange={(checked) => void handleToggleEnabled(meta.name, checked)}
                    />
                    <Button
                      size="small"
                      onClick={() => navigate(`/channels/${meta.name}`)}
                      data-testid={`${testIds.channels.detailLinkPrefix}${meta.name}`}
                    >
                      详情页
                    </Button>
                    <Button
                      size="small"
                      type="text"
                      icon={expanded ? <DownOutlined /> : <RightOutlined />}
                      onClick={() => void toggleExpand(meta.name)}
                    />
                  </div>
                </div>
              </div>

              {expanded ? (
                <div className="channels-registry-row-body">
                  {isInlineLoading && !detail ? (
                    <div className="channels-inline-loading">
                      <Spin />
                    </div>
                  ) : detail ? (
                    <>
                      {missingLabels.length > 0 ? (
                        <Alert
                          showIcon
                          type={state?.enabled ? 'warning' : 'info'}
                          message="当前配置仍未完成"
                          description={`缺少：${missingLabels.join('、')}。补齐后建议立即测试。`}
                        />
                      ) : null}

                      <div className="channels-inline-grid">
                        {meta.primaryFields.map((field) => renderField(meta.name, field))}
                      </div>

                      {probeResult ? (
                        <div className="channels-inline-probe">
                          <div className="channels-inline-probe-head">
                            <Tag color={probeColorMap[probeResult.status]}>{probeResult.statusLabel}</Tag>
                            {probeResult.bindingRequired ? <Tag color="orange">仍需绑定</Tag> : null}
                          </div>
                          <strong>{probeResult.summary}</strong>
                          {probeResult.detail ? <span>{probeResult.detail}</span> : null}
                        </div>
                      ) : null}

                      <div className="channels-inline-footer">
                        <Text type="secondary">
                          参考项目采用行内维护方式；当前项目的完整调试能力仍然保留在详情页。
                        </Text>
                        <div className="channels-inline-footer-actions">
                          <Button
                            icon={<SearchOutlined />}
                            loading={testingChannelName === meta.name}
                            onClick={() => void handleTestChannel(meta.name)}
                          >
                            测试连接
                          </Button>
                          <Button
                            type="primary"
                            icon={<SaveOutlined />}
                            loading={savingChannelName === meta.name}
                            onClick={() => void handleSaveChannel(meta.name)}
                          >
                            保存配置
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
