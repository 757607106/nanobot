import type { ReactNode } from 'react'
import { Button, Flex, Input, Space, Tag, Typography, theme } from 'antd'
import { ExperimentOutlined, SyncOutlined, SafetyCertificateOutlined, LinkOutlined, AppstoreOutlined } from '@ant-design/icons'
import SectionCard from '../../components/console/SectionCard'
import MetricCard from '../../components/console/MetricCard'
import ProviderAvatar from './ProviderAvatar'
import { hasCredentialMaterial } from './utils'
import type { ConfigData, ConfigMeta, ModelBinding } from '../../types'
import { providerCategoryLabels } from '../../configMeta'

interface FieldGroupProps {
  label: string
  children: ReactNode
}

function FieldGroup({ label, children }: FieldGroupProps) {
  return (
    <Flex vertical gap={6}>
      <Typography.Text strong style={{ fontSize: 'var(--nb-text-sm)' }}>
        {label}
      </Typography.Text>
      {children}
    </Flex>
  )
}

interface ProviderConfigProps {
  providerName: string
  providerMeta: NonNullable<ConfigMeta['providers'][number]>
  providerConfig: ConfigData['providers'][string] | undefined
  defaultBindingName: string | null
  bindings: Record<string, ModelBinding>
  loadingRemoteModels: boolean
  onUpdateCredential: (field: 'apiKey' | 'apiBase', value: string) => void
  onTestConnection: () => void
  onFetchRemoteModels: () => void
}

export default function ProviderConfig({
  providerName,
  providerMeta,
  providerConfig,
  defaultBindingName,
  bindings,
  loadingRemoteModels,
  onUpdateCredential,
  onTestConnection,
  onFetchRemoteModels,
}: ProviderConfigProps) {
  const { token } = theme.useToken()

  const isConfigured = hasCredentialMaterial(providerConfig?.apiKey, providerConfig?.apiBase)

  return (
    <SectionCard
      title="供应商配置"
      action={(
        <Space wrap>
          <Button icon={<ExperimentOutlined />} onClick={onTestConnection}>
            测试连接
          </Button>
          <Button
            icon={<SyncOutlined spin={loadingRemoteModels} />}
            onClick={onFetchRemoteModels}
            disabled={loadingRemoteModels}
          >
            拉取模型
          </Button>
        </Space>
      )}
    >
      <Flex vertical gap={16}>
        <Flex justify="space-between" align="center" gap={16} wrap="wrap">
          <Flex align="center" gap={14} style={{ minWidth: 0 }}>
            <ProviderAvatar providerName={providerName} label={providerMeta.label} size={52} />
            <div style={{ minWidth: 0 }}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {providerMeta.label}
              </Typography.Title>
            </div>
          </Flex>
          <Space size={8} wrap>
            <Tag color="blue">{providerCategoryLabels[providerMeta.category] || providerMeta.category}</Tag>
            {isConfigured ? <Tag color="green">已配置凭据</Tag> : <Tag color="gold">待补齐凭据</Tag>}
          </Space>
        </Flex>

        <div className="console-metrics-grid" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <MetricCard
            label="接入方式"
            value={providerMeta.isOauth ? 'OAuth' : 'API Key'}
            icon={<SafetyCertificateOutlined />}
            tone="neutral"
          />
          <MetricCard
            label="默认地址"
            value={providerMeta.defaultApiBase ? '已提供' : '自定义'}
            icon={<LinkOutlined />}
            tone="neutral"
          />
          <MetricCard
            label="当前默认绑定"
            value={bindings[defaultBindingName ?? '']?.provider === providerName
                ? bindings[defaultBindingName ?? '']?.label || defaultBindingName
                : '未占用'}
            icon={<AppstoreOutlined />}
            tone={bindings[defaultBindingName ?? '']?.provider === providerName ? 'primary' : 'neutral'}
          />
        </div>


        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          {!providerMeta.isOauth ? (
            <FieldGroup label="API Key">
              <Input.Password
                size="large"
                variant="filled"
                aria-label="API Key"
                value={providerConfig?.apiKey || ''}
                onChange={(e) => onUpdateCredential('apiKey', e.target.value)}
                style={{ borderRadius: 12, background: 'var(--nb-card-subtle-bg)' }}
              />
            </FieldGroup>
          ) : null}

          {(!providerMeta.isDirect || providerMeta.isLocal) ? (
            <FieldGroup label="API Base URL">
              <Input
                size="large"
                variant="filled"
                aria-label="API Base URL"
                value={providerConfig?.apiBase || ''}
                onChange={(e) => onUpdateCredential('apiBase', e.target.value)}
                placeholder={providerMeta.defaultApiBase || undefined}
                style={{ borderRadius: 12, background: 'var(--nb-card-subtle-bg)' }}
              />
            </FieldGroup>
          ) : null}
        </div>
      </Flex>
    </SectionCard>
  )
}
