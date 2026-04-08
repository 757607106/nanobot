import { Card, Col, Descriptions, Empty, Row, Space, Tag, Typography } from 'antd'
import type { RunBoundaryAudit } from '../../types'
import { formatDateTimeZh } from '../../locale'
import { artifactLifecycleColor, artifactLifecycleLabel, artifactRetentionSummary } from './utils'

const { Text } = Typography

interface RunBoundaryAuditProps {
  audit: RunBoundaryAudit | null
  devMode: boolean
}

function renderBoundaryList(values: string[] | undefined) {
  if (!values?.length) {
    return <Text type="secondary">-</Text>
  }
  return (
    <Space wrap size={[6, 6]}>
      {values.map((value) => (
        <Tag key={value} bordered={false}>
          {value}
        </Tag>
      ))}
    </Space>
  )
}

export default function RunBoundaryAuditPanel({ audit, devMode }: RunBoundaryAuditProps) {
  if (!audit) {
    return (
      <Card className="page-card" variant="borderless">
        <Empty description="暂无边界审计数据" image={false} />
      </Card>
    )
  }

  const routing = audit.channel.routing || null

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card title="租户与主体" className="page-card" variant="borderless" size="small">
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="middle">
          <Descriptions.Item label="Tenant">
            <Text code copyable>
              {audit.tenantId}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Instance">
            <Text code copyable>
              {audit.instanceId}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Principal">
            <Text>{audit.principal.label || audit.principal.principalId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Agent ID">
            {audit.principal.agentId ? (
              <Text code copyable>
                {audit.principal.agentId}
              </Text>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <Card title="渠道入口" className="page-card" variant="borderless" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Channel">
                {audit.channel.originChannel ? (
                  <Tag bordered={false}>{audit.channel.originChannel}</Tag>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Chat ID">
                {audit.channel.originChatId ? (
                  <Text code copyable>
                    {audit.channel.originChatId}
                  </Text>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              {routing?.bindingId ? (
                <Descriptions.Item label="Binding">
                  <Text code copyable>
                    {String(routing.bindingId)}
                  </Text>
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="执行环境" className="page-card" variant="borderless" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Workspace">
                {audit.environment.workspaceScope ? (
                  <Tag bordered={false}>{audit.environment.workspaceScope}</Tag>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Sandbox">
                {audit.environment.sandboxKind ? (
                  <Tag bordered={false}>{audit.environment.sandboxKind}</Tag>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <Card title="治理边界" className="page-card" variant="borderless" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Memory Scope">
                {audit.governance.memoryScope ? (
                  <Tag bordered={false}>{audit.governance.memoryScope}</Tag>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Knowledge Scope">
                {audit.governance.knowledgeScope ? (
                  <Tag bordered={false}>{audit.governance.knowledgeScope}</Tag>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Tools">
                {renderBoundaryList(audit.governance.toolAllowlist)}
              </Descriptions.Item>
              <Descriptions.Item label="Knowledge">
                {renderBoundaryList(audit.governance.knowledgeBindingIds)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="产物治理" className="page-card" variant="borderless" size="small">
            {!audit.artifact ? (
              <Empty description="无归档产物" image={false} />
            ) : (
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Storage">
                  <Tag bordered={false}>{audit.artifact.storageScope || 'unknown'}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Lifecycle">
                  <Tag
                    color={artifactLifecycleColor(audit.artifact.lifecycleStatus)}
                    bordered={false}
                  >
                    {artifactLifecycleLabel(audit.artifact.lifecycleStatus)}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Storage Key">
                  {audit.artifact.storageKey ? (
                    <Text code copyable>
                      {audit.artifact.storageKey}
                    </Text>
                  ) : (
                    <Text type="secondary">-</Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Retention">
                  <Text>{artifactRetentionSummary(audit.artifact)}</Text>
                </Descriptions.Item>
                {audit.artifact.retentionPolicy?.nextAction &&
                  audit.artifact.retentionPolicy.nextAction !== 'none' && (
                    <Descriptions.Item label="Next Action">
                      <Text>{`${audit.artifact.retentionPolicy.nextAction} @ ${formatDateTimeZh(
                        audit.artifact.retentionPolicy.nextActionAt
                      )}`}</Text>
                    </Descriptions.Item>
                  )}
              </Descriptions>
            )}
          </Card>
        </Col>
      </Row>

      {devMode && audit.eventRefs && (
        <Card title="审计事件" className="page-card" variant="borderless" size="small">
          <pre
            style={{
              margin: 0,
              padding: 16,
              background: 'var(--nb-surface-strong)',
              borderRadius: 8,
              fontSize: 'var(--nb-text-xs)',
              overflow: 'auto',
            }}
          >
            {JSON.stringify(audit.eventRefs, null, 2)}
          </pre>
        </Card>
      )}
    </Space>
  )
}
