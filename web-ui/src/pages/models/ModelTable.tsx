import { useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Flex, Segmented, Space, Table, Tag, Tooltip, Typography, theme } from 'antd'
import type { TableColumnsType } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  MoreOutlined,
  StarOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import ProviderAvatar from './ProviderAvatar'
import { capabilityLabel } from './utils'
import type { BindingRow, CapabilityType } from './types'

const CAPABILITY_TABS = [
  { label: '全部', value: 'all' },
  { label: '文本对话', value: 'text_chat' },
  { label: '向量嵌入', value: 'embedding' },
  { label: '多模态', value: 'multimodal' },
]

function capabilityColor(type: CapabilityType) {
  if (type === 'embedding') return 'gold'
  if (type === 'rerank') return 'cyan'
  if (type === 'multimodal') return 'purple'
  return 'blue'
}

interface ModelTableProps {
  bindings: BindingRow[]
  defaultBindingName: string | null
  providerLabels: Record<string, string>
  searchQuery: string
  onTest: (bindingName: string, model: string) => void
  onSetDefault: (bindingName: string) => void
  onDelete: (bindingName: string) => void
  onCapabilityChange?: (bindingName: string, capabilityType: CapabilityType) => void
  onOpenProviderDrawer: (providerName: string) => void
}

export default function ModelTable({
  bindings,
  defaultBindingName,
  providerLabels,
  searchQuery,
  onTest,
  onSetDefault,
  onDelete,
  onCapabilityChange,
  onOpenProviderDrawer,
}: ModelTableProps) {
  const { token } = theme.useToken()
  const [capabilityFilter, setCapabilityFilter] = useState('all')

  const filteredBindings = useMemo(() => {
    let items = bindings

    // Filter by capability type
    if (capabilityFilter !== 'all') {
      items = items.filter((b) => b.capabilityType === capabilityFilter)
    }

    // Filter by search query
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      items = items.filter((b) => {
        const haystack = [
          b.model || '',
          b.label || '',
          b.bindingName,
          b.provider || '',
          providerLabels[b.provider || ''] || '',
        ].join(' ').toLowerCase()
        return haystack.includes(q)
      })
    }

    return items
  }, [bindings, capabilityFilter, searchQuery, providerLabels])

  // Count by capability
  const counts = useMemo(() => {
    const c = { all: bindings.length, text_chat: 0, embedding: 0, multimodal: 0 }
    for (const b of bindings) {
      if (b.capabilityType === 'text_chat') c.text_chat++
      else if (b.capabilityType === 'embedding') c.embedding++
      else if (b.capabilityType === 'multimodal') c.multimodal++
    }
    return c
  }, [bindings])

  const tabOptions = CAPABILITY_TABS.map((tab) => ({
    ...tab,
    label: `${tab.label} (${counts[tab.value as keyof typeof counts] ?? 0})`,
  }))

  const columns: TableColumnsType<BindingRow> = [
    {
      title: '模型 ID',
      key: 'model',
      width: 280,
      sorter: (a, b) => (a.model || '').localeCompare(b.model || ''),
      render: (_value, record) => {
        const hasModel = Boolean(record.model?.trim())
        const isDefault = record.bindingName === defaultBindingName
        return (
          <Flex align="center" gap={8}>
            {!hasModel && (
              <Tooltip title="模型 ID 未配置，无法使用">
                <WarningOutlined style={{ color: token.colorWarning, fontSize: 'var(--nb-text-sm)' }} />
              </Tooltip>
            )}
            <Flex vertical gap={2} style={{ minWidth: 0 }}>
              <Flex align="center" gap={6}>
                <Typography.Text
                  strong
                  ellipsis={{ tooltip: record.model || '未配置' }}
                  style={{
                    fontSize: 'var(--nb-text-sm)',
                    fontFamily: hasModel ? 'var(--font-mono, monospace)' : undefined,
                    color: hasModel ? undefined : token.colorTextQuaternary,
                  }}
                >
                  {record.model || '未配置模型 ID'}
                </Typography.Text>
                {isDefault && (
                  <Tag color="success" bordered={false} style={{ margin: 0, borderRadius: 6, fontSize: 'var(--nb-text-2xs)', lineHeight: '18px', padding: '0 6px' }}>
                    DEFAULT
                  </Tag>
                )}
              </Flex>
              {record.label && record.label !== record.model && (
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                  {record.label}
                </Typography.Text>
              )}
            </Flex>
          </Flex>
        )
      },
    },
    {
      title: '供应商',
      key: 'provider',
      width: 160,
      sorter: (a, b) => (a.provider || '').localeCompare(b.provider || ''),
      render: (_value, record) => {
        const providerName = record.provider || ''
        const label = providerLabels[providerName] || providerName
        return (
          <Flex
            align="center"
            gap={8}
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenProviderDrawer(providerName)}
          >
            <ProviderAvatar providerName={providerName} label={label} size={28} />
            <Typography.Text style={{ fontSize: 'var(--nb-text-sm)' }}>{label}</Typography.Text>
          </Flex>
        )
      },
    },
    {
      title: '能力',
      key: 'capability',
      width: 110,
      filters: [
        { text: '文本对话', value: 'text_chat' },
        { text: '向量嵌入', value: 'embedding' },
        { text: '多模态', value: 'multimodal' },
      ],
      onFilter: (value, record) => record.capabilityType === value,
      render: (_value, record) => (
        <Tag
          color={capabilityColor(record.capabilityType)}
          bordered={false}
          style={{ borderRadius: 6, fontSize: 'var(--nb-text-xs)', cursor: onCapabilityChange ? 'pointer' : undefined }}
          onClick={onCapabilityChange ? () => {
            const types: CapabilityType[] = ['text_chat', 'embedding', 'multimodal']
            const currentIndex = types.indexOf(record.capabilityType)
            const nextType = types[(currentIndex + 1) % types.length]
            onCapabilityChange(record.bindingName, nextType)
          } : undefined}
        >
          {capabilityLabel(record.capabilityType)}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      align: 'right',
      render: (_value, record) => {
        const isDefault = record.bindingName === defaultBindingName
        const isEmbedding = record.capabilityType === 'embedding'
        const menuItems = [
          ...(!isDefault && !isEmbedding ? [{
            key: 'default',
            icon: <StarOutlined />,
            label: '设为默认',
            onClick: () => onSetDefault(record.bindingName),
          }] : []),
          {
            key: 'copy',
            icon: <CopyOutlined />,
            label: '复制模型 ID',
            onClick: () => {
              void navigator.clipboard.writeText(record.model || record.bindingName)
            },
          },
          { type: 'divider' as const },
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: '删除',
            danger: true,
            onClick: () => onDelete(record.bindingName),
          },
        ]

        return (
          <Space size={4}>
            <Button
              type="text"
              size="small"
              icon={<ExperimentOutlined />}
              onClick={() => onTest(record.bindingName, record.model || '')}
            >
              测试
            </Button>
            <Dropdown menu={{ items: menuItems }} trigger={['click']}>
              <Button type="text" size="small" icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  return (
    <Flex vertical gap={16}>
      <Segmented
        value={capabilityFilter}
        onChange={setCapabilityFilter}
        options={tabOptions}
        style={{ alignSelf: 'flex-start' }}
      />

      <Table
        rowKey="bindingName"
        columns={columns}
        dataSource={filteredBindings}
        pagination={false}
        size="small"
        scroll={{ x: 680 }}
        locale={{
          emptyText: (
            <Empty
              image={false}
              className="minimal-empty"
              description={searchQuery ? '无匹配模型' : '暂无已注册模型'}
            />
          ),
        }}
      />
    </Flex>
  )
}
