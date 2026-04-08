import { Button, Card, Empty, Space, Tag, Typography } from 'antd'
import {
  DownloadOutlined,
  SyncOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import type { AgentRunSummary, RunArtifactDetail, RunBoundaryAudit } from '../../types'
import { formatDateTimeZh } from '../../locale'
import { artifactLifecycleColor, artifactLifecycleLabel, artifactRetentionSummary } from './utils'

const { Text, Title } = Typography

interface RunArtifactProps {
  run: AgentRunSummary
  artifact: RunArtifactDetail | null
  boundaryAudit: RunBoundaryAudit | null
  loading: boolean
  action: string | null
  onDownload: () => void
  onLifecycle: (action: 'archive' | 'quarantine' | 'restore' | 'delete') => void
  onRetentionPolicy: (action: 'set' | 'clear' | 'apply') => void
}

export default function RunArtifactPanel({
  run,
  artifact,
  boundaryAudit,
  loading,
  action,
  onDownload,
  onLifecycle,
  onRetentionPolicy,
}: RunArtifactProps) {
  const artifactAudit = artifact?.audit || boundaryAudit?.artifact || null
  const lifecycleStatus = artifactAudit?.lifecycleStatus
  const retentionPolicy = artifactAudit?.retentionPolicy || null

  if (!run.artifactPath) {
    return (
      <Card className="page-card" variant="borderless" title="运行产物">
        <Empty description="无运行产物" image={false} />
      </Card>
    )
  }

  return (
    <Card className="page-card" variant="borderless" title="运行产物">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: '24px 0',
        }}
      >
        <FileTextOutlined style={{ fontSize: 48, color: 'var(--ant-color-primary)', marginBottom: 16 }} />
        <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
          {artifact?.fileName || artifactAudit?.fileName || '运行归档'}
        </Title>
        <Text type="secondary" style={{ marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 'var(--nb-text-xs)' }}>
          {artifact?.artifactPath || run.artifactPath}
        </Text>

        <Space wrap style={{ marginBottom: 16, justifyContent: 'center' }}>
          {artifactAudit?.storageScope && (
            <Tag bordered={false}>{artifactAudit.storageScope}</Tag>
          )}
          {artifactAudit?.lifecycleStatus && (
            <Tag color={artifactLifecycleColor(artifactAudit.lifecycleStatus)} bordered={false}>
              {artifactLifecycleLabel(artifactAudit.lifecycleStatus)}
            </Tag>
          )}
        </Space>

        <Text type="secondary" style={{ marginBottom: 8 }}>
          保留策略: {artifactRetentionSummary(artifactAudit)}
        </Text>

        {retentionPolicy?.nextAction && retentionPolicy.nextAction !== 'none' && (
          <Text type="secondary" style={{ marginBottom: 16 }}>
            下次动作: {retentionPolicy.nextAction}{' '}
            {retentionPolicy.nextActionAt ? `@ ${formatDateTimeZh(retentionPolicy.nextActionAt)}` : ''}
          </Text>
        )}

        <Space wrap style={{ marginTop: 16 }}>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={onDownload}
            size="large"
            disabled={!artifact || lifecycleStatus === 'deleted'}
          >
            下载
          </Button>

          {lifecycleStatus === 'active' && (
            <>
              <Button
                onClick={() => onLifecycle('archive')}
                loading={action === 'archive'}
              >
                归档
              </Button>
              <Button
                onClick={() => onLifecycle('quarantine')}
                loading={action === 'quarantine'}
              >
                隔离
              </Button>
              <Button
                danger
                onClick={() => onLifecycle('delete')}
                loading={action === 'delete'}
              >
                删除
              </Button>
            </>
          )}

          {(lifecycleStatus === 'archived' || lifecycleStatus === 'quarantined') && (
            <>
              <Button
                icon={<SyncOutlined />}
                onClick={() => onLifecycle('restore')}
                loading={action === 'restore'}
              >
                恢复
              </Button>
              <Button
                danger
                onClick={() => onLifecycle('delete')}
                loading={action === 'delete'}
              >
                删除
              </Button>
            </>
          )}

          {lifecycleStatus === 'deleted' && (
            <Button
              icon={<SyncOutlined />}
              onClick={() => onLifecycle('restore')}
              loading={action === 'restore'}
            >
              恢复
            </Button>
          )}

          <Button
            onClick={() => onRetentionPolicy('set')}
            loading={action === 'policy_set'}
          >
            保留策略
          </Button>

          {retentionPolicy?.enabled && (
            <>
              <Button
                onClick={() => onRetentionPolicy('apply')}
                loading={action === 'policy_apply'}
              >
                执行策略
              </Button>
              <Button
                onClick={() => onRetentionPolicy('clear')}
                loading={action === 'policy_clear'}
              >
                清除策略
              </Button>
            </>
          )}
        </Space>
      </div>
    </Card>
  )
}
