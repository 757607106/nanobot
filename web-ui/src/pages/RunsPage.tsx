import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  List,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tabs,
  Tag,
  Typography,
  Tooltip,
} from 'antd'
import type { TableProps } from 'antd'
import {
  ClockCircleOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  FileTextOutlined,
  ApartmentOutlined,
  MessageOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import DevOnly from '../components/DevOnly'
import PageHero from '../components/PageHero'
import { useDevMode } from '../devMode'
import { formatDateTimeZh } from '../locale'
import type {
  AgentRunSummary,
  AgentRunTreeNode,
  ChatMessage,
  RunArtifactDetail,
  RunBoundaryAudit,
} from '../types'

const { Paragraph, Text, Title } = Typography

interface ChildTaskActivity {
  key: string
  handleId?: string | null
  runId?: string | null
  label: string
  task?: string | null
  status: string
  principalKind?: string | null
  principalId?: string | null
  agentId?: string | null
  teamId?: string | null
  originChannel?: string | null
  originChatId?: string | null
  timeoutSeconds?: number | null
  scheduledAt?: string | null
  updatedAt?: string | null
  completedAt?: string | null
  content?: string | null
  error?: string | null
  progressMessage?: string | null
  progressStage?: string | null
  childKind?: string | null
  childControlScope?: string | null
  childSummary?: string | null
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

function statusColor(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
      return 'processing'
    case 'cancel_requested':
      return 'warning'
    case 'cancelled':
      return 'default'
    default:
      return 'default'
  }
}

function statusBadgeStatus(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
      return 'processing'
    case 'cancel_requested':
      return 'warning'
    case 'cancelled':
      return 'default'
    default:
      return 'default'
  }
}

function statusLabel(status: AgentRunSummary['status']) {
  switch (status) {
    case 'succeeded':
      return '成功'
    case 'failed':
      return '失败'
    case 'running':
      return '运行中'
    case 'queued':
      return '排队中'
    case 'cancel_requested':
      return '取消中'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

function isActiveStatus(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

function isCancelable(status: AgentRunSummary['status']) {
  return status === 'queued' || status === 'running'
}

function childTaskStatusColor(status: string) {
  switch (status) {
    case 'ok':
    case 'succeeded':
      return 'success'
    case 'timed_out':
    case 'cancel_requested':
      return 'warning'
    case 'cancelled':
      return 'default'
    case 'error':
    case 'failed':
      return 'error'
    case 'scheduled':
    case 'queued':
    case 'running':
      return 'processing'
    default:
      return 'default'
  }
}

function childTaskStatusLabel(status: string) {
  switch (status) {
    case 'ok':
    case 'succeeded':
      return '成功'
    case 'timed_out':
      return '超时'
    case 'cancel_requested':
      return '取消中'
    case 'cancelled':
      return '已取消'
    case 'error':
    case 'failed':
      return '失败'
    case 'scheduled':
      return '已派发'
    case 'queued':
      return '排队中'
    case 'running':
      return '运行中'
    default:
      return status || '未知'
  }
}

function compactText(value: string | null | undefined, fallback = '-') {
  const text = String(value || '').trim()
  if (!text) {
    return fallback
  }
  return text.length > 140 ? `${text.slice(0, 140)}...` : text
}

function childTaskActivityKey(payload?: Record<string, unknown>, fallback = 'child-task') {
  const handleId = String(payload?.handleId || '').trim()
  if (handleId) {
    return `handle:${handleId}`
  }
  const childRunId = String(payload?.childRunId || '').trim()
  if (childRunId) {
    return `run:${childRunId}`
  }
  const parts = [
    payload?.principalKind,
    payload?.principalId || payload?.agentId,
    payload?.label,
    payload?.task,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  return parts.length ? parts.join('::') : fallback
}

function buildChildTaskActivities(
  events?: AgentRunSummary['events'],
  children?: AgentRunSummary[],
): ChildTaskActivity[] {
  const items = new Map<string, ChildTaskActivity>()

  for (const child of children || []) {
    items.set(`run:${child.runId}`, {
      key: `run:${child.runId}`,
      runId: child.runId,
      label: child.label,
      task: child.taskPreview,
      status: child.status,
      principalKind: child.kind,
      principalId: child.agentId || child.teamId || child.runId,
      agentId: child.agentId,
      teamId: child.teamId,
      originChannel: child.originChannel,
      originChatId: child.originChatId,
      scheduledAt: child.createdAt,
      completedAt: child.finishedAt,
      childKind: child.kind,
      childControlScope: child.controlScope,
      childSummary: child.resultSummary?.content || null,
    })
  }

  for (const event of events || []) {
    if (
      event.eventType !== 'child_task_scheduled' &&
      event.eventType !== 'child_task_progress' &&
      event.eventType !== 'child_task_completed'
    ) {
      continue
    }
    const payload = event.payload || {}
    const key = childTaskActivityKey(payload, `${event.eventType}:${event.createdAt || ''}`)
    const childRunId = String(payload.childRunId || '').trim() || null
    const fallbackRunKey = childRunId ? `run:${childRunId}` : null
    const existingKey =
      items.has(key)
        ? key
        : fallbackRunKey && items.has(fallbackRunKey)
          ? fallbackRunKey
          : key
    const current = items.get(existingKey) || {
      key,
      runId: null,
      label: String(payload.label || '').trim() || '子任务',
      status: 'scheduled',
    }

    current.handleId = String(payload.handleId || current.handleId || '').trim() || null
    current.runId = String(payload.childRunId || current.runId || '').trim() || null
    current.label = String(payload.label || current.label || '').trim() || '子任务'
    current.task = String(payload.task || current.task || '').trim() || null
    current.principalKind = String(payload.principalKind || current.principalKind || '').trim() || null
    current.principalId = String(payload.principalId || current.principalId || '').trim() || null
    current.agentId = String(payload.agentId || current.agentId || '').trim() || null
    current.teamId = String(payload.teamId || current.teamId || '').trim() || null
    current.originChannel = String(payload.originChannel || current.originChannel || '').trim() || null
    current.originChatId = String(payload.originChatId || current.originChatId || '').trim() || null
    current.timeoutSeconds =
      payload.timeoutSeconds == null ? current.timeoutSeconds || null : Number(payload.timeoutSeconds)

    if (event.eventType === 'child_task_scheduled') {
      current.scheduledAt = event.createdAt || current.scheduledAt || null
      if (!current.status || current.status === 'queued') {
        current.status = 'scheduled'
      }
    } else if (event.eventType === 'child_task_progress') {
      current.updatedAt = event.createdAt || current.updatedAt || null
      current.status = String(payload.status || current.status || 'running').trim() || 'running'
      current.progressMessage = String(payload.message || current.progressMessage || '').trim() || null
      current.progressStage = String(payload.stage || current.progressStage || '').trim() || null
    } else {
      current.completedAt = event.createdAt || current.completedAt || null
      current.status = String(payload.status || current.status || 'ok').trim() || 'ok'
      current.content = String(payload.content || current.content || '').trim() || null
      current.error = String(payload.error || current.error || '').trim() || null
    }

    const nextKey = current.handleId
      ? `handle:${current.handleId}`
      : current.runId
        ? `run:${current.runId}`
        : key
    current.key = nextKey
    if (existingKey !== nextKey) {
      items.delete(existingKey)
    }
    items.set(nextKey, current)
  }

  return Array.from(items.values()).sort((left, right) =>
    String(left.scheduledAt || left.completedAt || '').localeCompare(String(right.scheduledAt || right.completedAt || '')),
  )
}

function eventLabel(eventType: string, devMode = true) {
  switch (eventType) {
    case 'queued':
      return '已排队'
    case 'started':
      return '开始执行'
    case 'completed':
      return '执行完成'
    case 'failed':
      return '执行失败'
    case 'cancel_requested':
      return '已请求取消'
    case 'cancelled':
      return '已取消'
    case 'bindings_resolved':
      return devMode ? '已装配绑定能力' : '准备就绪'
    case 'knowledge_retrieved':
      return devMode ? '已检索知识库' : '准备就绪'
    case 'team_run_requested':
      return '收到团队任务'
    case 'team_definition_resolved':
      return devMode ? '已解析 TeamDefinition' : '准备就绪'
    case 'team_knowledge_retrieved':
      return devMode ? '已检索团队共享知识' : '准备就绪'
    case 'retry_requested':
      return '已发起重跑'
    case 'memory_candidate_proposed':
      return '已生成记忆候选'
    case 'child_task_scheduled':
      return '子任务已派发'
    case 'child_task_progress':
      return '子任务执行中'
    case 'child_task_completed':
      return '子任务已完成'
    case 'member_scheduled':
      return '成员已派发'
    case 'member_completed':
      return '成员已完成'
    case 'leader_scheduled':
      return 'Leader 已开始汇总'
    case 'leader_completed':
      return 'Leader 已完成汇总'
    case 'team_completed':
      return '团队运行完成'
    case 'execution_context_materialized':
      return devMode ? '已物化执行上下文' : '执行边界已确认'
    case 'channel_dispatch_resolved':
      return devMode ? '已解析渠道路由' : '渠道入口已确认'
    case 'artifact_written':
      return devMode ? '已写入运行产物' : '产物已归档'
    case 'artifact_quarantined':
      return devMode ? '已隔离运行产物' : '产物已隔离'
    case 'artifact_archived':
      return devMode ? '已归档运行产物' : '产物已归档'
    case 'artifact_restored':
      return devMode ? '已恢复运行产物' : '产物已恢复'
    case 'artifact_deleted':
      return devMode ? '已删除运行产物' : '产物已删除'
    case 'artifact_retention_policy_set':
      return devMode ? '已更新产物保留策略' : '产物保留策略已更新'
    default:
      return eventType
  }
}

function eventPayloadSummary(eventType: string, payload?: Record<string, unknown>, devMode = true) {
  if (!payload) {
    return null
  }
  switch (eventType) {
    case 'progress':
      return String(payload.content || '')
    case 'team_run_requested':
      return String(payload.contentPreview || '')
    case 'bindings_resolved': {
      if (!devMode) {
        const total =
          (Array.isArray(payload.toolAllowlist) ? payload.toolAllowlist.length : 0) +
          (Array.isArray(payload.mcpServerIds) ? payload.mcpServerIds.length : 0) +
          (Array.isArray(payload.skillIds) ? payload.skillIds.length : 0) +
          (Array.isArray(payload.knowledgeBindingIds) ? payload.knowledgeBindingIds.length : 0)
        return `已加载 ${total} 项能力`
      }
      return [
        `tools: ${Array.isArray(payload.toolAllowlist) ? payload.toolAllowlist.length : 0}`,
        `mcp: ${Array.isArray(payload.mcpServerIds) ? payload.mcpServerIds.length : 0}`,
        `skills: ${Array.isArray(payload.skillIds) ? payload.skillIds.length : 0}`,
        `kb: ${Array.isArray(payload.knowledgeBindingIds) ? payload.knowledgeBindingIds.length : 0}`,
      ].join(' · ')
    }
    case 'knowledge_retrieved':
    case 'team_knowledge_retrieved':
      return `mode: ${payload.effectiveMode || payload.requestedMode || 'keyword'} · hits: ${payload.hitCount || 0}`
    case 'team_definition_resolved':
      return [
        `members: ${Array.isArray(payload.memberAgentIds) ? payload.memberAgentIds.length : 0}`,
        `shared KB: ${Array.isArray(payload.sharedKnowledgeBindingIds) ? payload.sharedKnowledgeBindingIds.length : 0}`,
      ].join(' · ')
    case 'retry_requested':
      return [
        `source: ${payload.sourceRunId || 'n/a'}`,
        payload.appendContextProvided ? 'with append context' : 'direct retry',
      ].join(' · ')
    case 'memory_candidate_proposed':
      return [payload.candidateId, payload.agentId, payload.runId].filter(Boolean).join(' · ')
    case 'child_task_scheduled':
      return [
        String(payload.label || payload.principalId || '子任务'),
        payload.timeoutSeconds != null ? `${payload.timeoutSeconds}s` : null,
        String(payload.childRunId || ''),
      ].filter(Boolean).join(' · ')
    case 'child_task_progress':
      return [
        String(payload.label || payload.principalId || '子任务'),
        childTaskStatusLabel(String(payload.status || 'running')),
        String(payload.stage || payload.message || ''),
      ].filter(Boolean).join(' · ')
    case 'child_task_completed':
      return [
        String(payload.label || payload.principalId || '子任务'),
        childTaskStatusLabel(String(payload.status || 'ok')),
        String(payload.error || payload.childRunId || ''),
      ].filter(Boolean).join(' · ')
    case 'member_scheduled':
    case 'member_completed':
    case 'leader_scheduled':
    case 'leader_completed':
      return [payload.agentName, payload.runId].filter(Boolean).join(' · ')
    case 'team_completed':
      return [
        `supervisor: ${payload.supervisorRunId || 'n/a'}`,
        `members: ${Array.isArray(payload.memberRunIds) ? payload.memberRunIds.length : 0}`,
      ].join(' · ')
    case 'execution_context_materialized':
      return [
        String(payload.principalKind || payload.principal_kind || 'agent'),
        `workspace: ${payload.workspaceScope || 'shared'}`,
        `sandbox: ${payload.sandboxKind || 'local'}`,
      ].join(' · ')
    case 'channel_dispatch_resolved':
      return [
        `${payload.channelName || 'channel'}:${payload.chatId || 'chat'}`,
        `${payload.targetType || 'target'} -> ${payload.targetId || 'unknown'}`,
        `tenant: ${payload.tenantId || 'default'}`,
      ].join(' · ')
    case 'artifact_written':
      return [
        `${payload.storageScope || 'scoped'}`,
        String(payload.fileName || payload.artifactPath || ''),
      ].filter(Boolean).join(' · ')
    case 'artifact_quarantined':
    case 'artifact_archived':
    case 'artifact_restored':
    case 'artifact_deleted':
      return [
        String(payload.lifecycleStatus || ''),
        String(payload.currentStorageScope || ''),
        String(payload.reason || ''),
      ].filter(Boolean).join(' · ')
    case 'artifact_retention_policy_set':
      return [
        payload.archiveAfterDays != null ? `archive: ${payload.archiveAfterDays}d` : 'archive: off',
        payload.deleteAfterDays != null ? `delete: ${payload.deleteAfterDays}d` : 'delete: off',
        String(payload.reason || ''),
      ].filter(Boolean).join(' · ')
    default:
      return JSON.stringify(payload, null, 2)
  }
}

function renderBoundaryList(values: string[] | undefined) {
  if (!values?.length) {
    return <Text type="secondary">-</Text>
  }
  return (
    <Space wrap size={[6, 6]}>
      {values.map((value) => (
        <Tag key={value} bordered={false}>{value}</Tag>
      ))}
    </Space>
  )
}

function artifactLifecycleColor(status: string | undefined) {
  switch (status) {
    case 'active':
      return 'green'
    case 'archived':
      return 'blue'
    case 'quarantined':
      return 'orange'
    case 'deleted':
      return 'red'
    case 'missing':
      return 'default'
    default:
      return 'default'
  }
}

function artifactLifecycleLabel(status: string | undefined) {
  switch (status) {
    case 'active':
      return '可用'
    case 'archived':
      return '已归档'
    case 'quarantined':
      return '已隔离'
    case 'deleted':
      return '已删除'
    case 'missing':
      return '缺失'
    default:
      return status || '未知'
  }
}

function artifactRetentionSummary(audit: RunBoundaryAudit['artifact'] | RunArtifactDetail['audit'] | null | undefined) {
  const policy = audit?.retentionPolicy || null
  if (!policy?.enabled) {
    return '未设置'
  }
  return [
    policy.archiveAfterDays != null ? `${policy.archiveAfterDays} 天后归档` : null,
    policy.deleteAfterDays != null ? `${policy.deleteAfterDays} 天后删除` : null,
  ].filter(Boolean).join(' · ')
}

function renderBoundaryAuditPanel(audit: RunBoundaryAudit | null, devMode: boolean) {
  if (!audit) {
    return <Empty description="暂无边界审计数据" image={false} />
  }

  const routing = audit.channel.routing || null

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card title="租户与主体边界" className="page-card" bordered={false} size="small">
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="middle">
          <Descriptions.Item label="Tenant">
            <Text code copyable>{audit.tenantId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Instance">
            <Text code copyable>{audit.instanceId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Principal">
            <Text>{audit.principal.label || audit.principal.principalId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="主体类型">
            <Tag bordered={false}>{audit.principal.principalKind || '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Agent ID">
            {audit.principal.agentId ? <Text code copyable>{audit.principal.agentId}</Text> : <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Team ID">
            {audit.principal.teamId ? <Text code copyable>{audit.principal.teamId}</Text> : <Text type="secondary">-</Text>}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <Card title="渠道入口" className="page-card" bordered={false} size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Origin Channel">
                {audit.channel.originChannel ? <Tag bordered={false}>{audit.channel.originChannel}</Tag> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Origin Chat">
                {audit.channel.originChatId ? <Text code copyable>{audit.channel.originChatId}</Text> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Routing Binding">
                {routing?.bindingId ? <Text code copyable>{String(routing.bindingId)}</Text> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Routing Target">
                {routing?.targetType || routing?.targetId ? (
                  <Text>{String(routing?.targetType || 'target')} / {String(routing?.targetId || '-')}</Text>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="执行环境" className="page-card" bordered={false} size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Workspace Scope">
                {audit.environment.workspaceScope ? <Tag bordered={false}>{audit.environment.workspaceScope}</Tag> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Workspace Path">
                {audit.environment.workspacePath ? <Text code copyable>{audit.environment.workspacePath}</Text> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Sandbox">
                {audit.environment.sandboxKind ? <Tag bordered={false}>{audit.environment.sandboxKind}</Tag> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Exec Working Dir">
                {audit.environment.execWorkingDir ? <Text code copyable>{audit.environment.execWorkingDir}</Text> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <Card title="治理边界" className="page-card" bordered={false} size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Memory Scope">
                {audit.governance.memoryScope ? <Tag bordered={false}>{audit.governance.memoryScope}</Tag> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Knowledge Scope">
                {audit.governance.knowledgeScope ? <Tag bordered={false}>{audit.governance.knowledgeScope}</Tag> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Knowledge Bindings">
                {renderBoundaryList(audit.governance.knowledgeBindingIds)}
              </Descriptions.Item>
              <Descriptions.Item label="Knowledge Names">
                {renderBoundaryList(audit.governance.knowledgeNames)}
              </Descriptions.Item>
              <Descriptions.Item label="Tools">
                {renderBoundaryList(audit.governance.toolAllowlist)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="产物治理" className="page-card" bordered={false} size="small">
            {!audit.artifact ? (
              <Empty description="当前运行没有归档产物" image={false} />
            ) : (
              <Descriptions column={1} size="small">
              <Descriptions.Item label="Storage Scope">
                <Tag bordered={false}>{audit.artifact.storageScope || 'unknown'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Lifecycle">
                <Tag color={artifactLifecycleColor(audit.artifact.lifecycleStatus)} bordered={false}>
                  {artifactLifecycleLabel(audit.artifact.lifecycleStatus)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Storage Key">
                {audit.artifact.storageKey ? <Text code copyable>{audit.artifact.storageKey}</Text> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Current Storage Key">
                {audit.artifact.currentStorageKey ? <Text code copyable>{audit.artifact.currentStorageKey}</Text> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Artifact Path">
                {audit.artifact.artifactPath ? <Text code copyable>{audit.artifact.artifactPath}</Text> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Governance Reason">
                {audit.artifact.governanceReason ? <Text>{audit.artifact.governanceReason}</Text> : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Retention Policy">
                <Text>{artifactRetentionSummary(audit.artifact)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Next Action">
                {audit.artifact.retentionPolicy?.nextAction && audit.artifact.retentionPolicy.nextAction !== 'none' ? (
                  <Text>{`${audit.artifact.retentionPolicy.nextAction} @ ${formatDateTimeZh(audit.artifact.retentionPolicy.nextActionAt)}`}</Text>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Legacy Fallback">
                <Tag color={audit.artifact.isLegacyFallback ? 'orange' : 'green'} bordered={false}>
                  {audit.artifact.isLegacyFallback ? 'legacy_root' : 'tenant_scoped'}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            )}
          </Card>
        </Col>
      </Row>

      {devMode && (
        <Card title="审计事件引用" className="page-card" bordered={false} size="small">
          <pre className="studio-run-pre">{JSON.stringify(audit.eventRefs, null, 2)}</pre>
        </Card>
      )}
    </Space>
  )
}

function controlScopeTag(scope: string) {
  switch (scope) {
    case 'leader':
      return <Tag color="purple" bordered={false}>Supervisor</Tag>
    case 'member':
      return <Tag color="cyan" bordered={false}>成员</Tag>
    case 'child':
      return <Tag color="orange" bordered={false}>子任务</Tag>
    default:
      return null
  }
}

function renderTreeNode(node: AgentRunTreeNode, selectedRunId: string | null, navigate: ReturnType<typeof useNavigate>) {
  const children = node.children || []
  const active = node.runId === selectedRunId
  
  return (
    <div key={node.runId} className={`studio-run-tree-node ${active ? 'is-active' : ''}`}>
      <div 
        className={`studio-run-tree-content ${active ? 'bg-primary-50 border-primary-200' : ''}`}
        onClick={() => navigate(`/studio/runs/${node.runId}`)}
        style={{ 
          cursor: 'pointer',
          padding: '12px',
          border: '1px solid var(--nb-border)',
          borderRadius: 8,
          marginBottom: 8,
          background: active ? 'var(--nb-conversation-active-bg)' : 'var(--nb-card-bg)',
          borderColor: active ? 'var(--nb-conversation-active-border)' : 'var(--nb-border)',
          transition: 'all 0.2s'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Space>
            <RobotOutlined />
            <Text strong>{node.label}</Text>
            {controlScopeTag(node.controlScope)}
          </Space>
          <Badge status={statusBadgeStatus(node.status)} text={statusLabel(node.status)} />
        </div>
        {node.resultSummary?.content && (
          <Paragraph type="secondary" ellipsis={{ rows: 1 }} style={{ margin: 0 }}>
            {node.resultSummary.content}
          </Paragraph>
        )}
      </div>
      {children.length > 0 && (
        <div style={{ paddingLeft: 24, borderLeft: '1px solid var(--nb-border)', marginLeft: 12 }}>
          {children.map((child) => renderTreeNode(child, selectedRunId, navigate))}
        </div>
      )}
    </div>
  )
}

export default function RunsPage() {
  const { devMode } = useDevMode()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { runId } = useParams()
  const selectedRunId = runId || null
  const threadFilter = (searchParams.get('threadId') || '').trim()

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [selectedRun, setSelectedRun] = useState<AgentRunSummary | null>(null)
  const [children, setChildren] = useState<AgentRunSummary[]>([])
  const [runTree, setRunTree] = useState<AgentRunTreeNode | null>(null)
  const [artifact, setArtifact] = useState<RunArtifactDetail | null>(null)
  const [boundaryAudit, setBoundaryAudit] = useState<RunBoundaryAudit | null>(null)

  const [loadingRuns, setLoadingRuns] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingArtifact, setLoadingArtifact] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [artifactAction, setArtifactAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Table columns for run list
  const columns: TableProps<AgentRunSummary>['columns'] = [
    {
      title: '任务名称/ID',
      dataIndex: 'label',
      key: 'label',
      render: (text, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{text}</Text>
          <Text type="secondary" style={{ fontFamily: 'var(--font-mono)' }}>{record.runId}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      key: 'kind',
      width: 120,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Tag bordered={false}>{record.kind === 'subagent' ? 'Subagent' : 'Agent'}</Tag>
          {record.controlScope && controlScopeTag(record.controlScope)}
        </Space>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_, record) => <Badge status={statusBadgeStatus(record.status)} text={statusLabel(record.status)} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (text) => <Text type="secondary">{formatDateTimeZh(text)}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => navigate(`/studio/runs/${record.runId}`)}>
          详情
        </Button>
      ),
    },
  ]

  useEffect(() => {
    void loadRuns()
  }, [statusFilter, kindFilter, threadFilter])

  useEffect(() => {
    if (loadingRuns) return
    
    // Don't auto-select first run if none selected, let user see the list
    if (!selectedRunId) {
      setSelectedRun(null)
      setChildren([])
      setRunTree(null)
      setArtifact(null)
      setBoundaryAudit(null)
      return
    }
    void loadRunDetail(selectedRunId)
  }, [loadingRuns, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || !selectedRun || !isActiveStatus(selectedRun.status)) {
      return
    }
    const timer = window.setInterval(() => {
      void loadRuns() // Refresh list status too
      void loadRunDetail(selectedRunId)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [selectedRun, selectedRunId])

  const activeCount = useMemo(
    () => runs.filter((item) => isActiveStatus(item.status)).length,
    [runs],
  )
  const failedCount = useMemo(
    () => runs.filter((item) => item.status === 'failed').length,
    [runs],
  )
  const childTaskActivities = useMemo(
    () => buildChildTaskActivities(selectedRun?.events, children),
    [children, selectedRun?.events],
  )

  async function loadRuns() {
    try {
      setLoadingRuns(true)
      const payload = await api.getRuns({
        status: statusFilter === 'all' ? undefined : statusFilter,
        kind: kindFilter === 'all' ? undefined : kindFilter,
        threadId: threadFilter || undefined,
        limit: 80,
      })
      setRuns(payload.items)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '加载运行列表失败'))
    } finally {
      setLoadingRuns(false)
    }
  }

  async function loadRunDetail(nextRunId: string) {
    try {
      setLoadingDetail(true)
      const [run, childPayload, tree] = await Promise.all([
        api.getRun(nextRunId),
        api.getRunChildren(nextRunId),
        api.getRunTree(nextRunId),
      ])
      setSelectedRun(run)
      setChildren(childPayload.items)
      setRunTree(tree)
      try {
        setBoundaryAudit(await api.getRunBoundaryAudit(nextRunId))
      } catch {
        setBoundaryAudit(null)
      }
      let artifactErrorMessage: string | null = null
      if (run.artifactPath) {
        setLoadingArtifact(true)
        try {
          const artifactDetail = await api.getRunArtifact(nextRunId)
          setArtifact(artifactDetail)
        } catch (artifactError) {
          setArtifact(null)
          if (!(artifactError instanceof ApiError && artifactError.code === 'RUN_ARTIFACT_NOT_FOUND')) {
            artifactErrorMessage = getErrorMessage(artifactError, '加载运行归档失败')
          }
        } finally {
          setLoadingArtifact(false)
        }
      } else {
        setArtifact(null)
      }
      setError(artifactErrorMessage)
    } catch (loadError) {
      setBoundaryAudit(null)
      setError(getErrorMessage(loadError, '加载运行详情失败'))
    } finally {
      setLoadingDetail(false)
    }
  }

  function handleDownloadArtifact() {
    if (!artifact) {
      return
    }
    const blob = new Blob([artifact.content], { type: artifact.contentType || 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = artifact.fileName || `${artifact.runId}.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  async function handleArtifactLifecycle(action: 'archive' | 'quarantine' | 'restore' | 'delete') {
    if (!selectedRun) {
      return
    }
    if (action !== 'restore') {
      const messageText =
        action === 'archive'
          ? '确认归档该运行产物？'
          : action === 'quarantine'
            ? '确认隔离该运行产物？'
            : '确认删除该运行产物？'
      const confirmed = window.confirm(messageText)
      if (!confirmed) {
        return
      }
    }
    try {
      setArtifactAction(action)
      if (action === 'archive') {
        await api.archiveRunArtifact(selectedRun.runId, 'RunsPage artifact governance')
        message.success('运行产物已归档')
      } else if (action === 'quarantine') {
        await api.quarantineRunArtifact(selectedRun.runId, 'RunsPage artifact governance')
        message.success('运行产物已隔离')
      } else if (action === 'restore') {
        await api.restoreRunArtifact(selectedRun.runId, 'RunsPage artifact governance')
        message.success('运行产物已恢复')
      } else {
        await api.deleteRunArtifact(selectedRun.runId, 'RunsPage artifact governance')
        message.success('运行产物已删除')
      }
      await loadRuns()
      await loadRunDetail(selectedRun.runId)
    } catch (artifactError) {
      setError(getErrorMessage(artifactError, '更新运行产物治理状态失败'))
    } finally {
      setArtifactAction(null)
    }
  }

  async function handleArtifactRetentionPolicy(action: 'set' | 'clear' | 'apply') {
    if (!selectedRun) {
      return
    }
    const artifactAudit = artifact?.audit || boundaryAudit?.artifact || null
    const currentPolicy = artifactAudit?.retentionPolicy || null
    try {
      setArtifactAction(`policy_${action}`)
      if (action === 'set') {
        const archiveInput = window.prompt(
          '设置归档天数，留空表示不自动归档。',
          currentPolicy?.archiveAfterDays != null ? String(currentPolicy.archiveAfterDays) : '',
        )
        if (archiveInput === null) {
          return
        }
        const deleteInput = window.prompt(
          '设置删除天数，留空表示不自动删除。',
          currentPolicy?.deleteAfterDays != null ? String(currentPolicy.deleteAfterDays) : '',
        )
        if (deleteInput === null) {
          return
        }
        const parseDays = (value: string) => {
          const trimmed = value.trim()
          if (!trimmed) {
            return null
          }
          const normalized = Number(trimmed)
          if (!Number.isInteger(normalized) || normalized < 0) {
            throw new Error('请输入 0 或正整数天数')
          }
          return normalized
        }
        await api.setRunArtifactRetentionPolicy(selectedRun.runId, {
          archiveAfterDays: parseDays(archiveInput),
          deleteAfterDays: parseDays(deleteInput),
          reason: 'RunsPage retention policy',
        })
        message.success('产物保留策略已更新')
      } else if (action === 'clear') {
        if (!window.confirm('确认清除该运行产物的保留策略？')) {
          return
        }
        await api.setRunArtifactRetentionPolicy(selectedRun.runId, {
          archiveAfterDays: null,
          deleteAfterDays: null,
          reason: 'RunsPage retention policy cleared',
        })
        message.success('产物保留策略已清除')
      } else {
        const result = await api.applyRunArtifactRetentionPolicy(selectedRun.runId, {
          reason: 'RunsPage retention policy apply',
        })
        if (result.applied) {
          message.success(result.action === 'archive' ? '已执行自动归档规则' : '已执行自动删除规则')
        } else {
          message.info('当前没有到期的保留策略动作')
        }
      }
      await loadRuns()
      await loadRunDetail(selectedRun.runId)
    } catch (artifactError) {
      setError(getErrorMessage(artifactError, '更新运行产物保留策略失败'))
    } finally {
      setArtifactAction(null)
    }
  }

  async function handleCancelRun() {
    if (!selectedRun) {
      return
    }
    try {
      setCancelling(true)
      const cancelled = await api.cancelRun(selectedRun.runId)
      message.success(cancelled.taskCancellationSent ? '已向运行时发送取消请求' : '已标记为取消请求')
      await loadRuns()
      await loadRunDetail(selectedRun.runId)
    } catch (cancelError) {
      setError(getErrorMessage(cancelError, '取消运行失败'))
    } finally {
      setCancelling(false)
    }
  }

  // Detail View
  if (selectedRunId && selectedRun) {
    const tabItems = [
      {
        key: 'overview',
        label: '概览',
        icon: <InfoCircleOutlined />,
        children: (
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
            {/* Result Card */}
            {selectedRun.resultSummary?.content ? (
              <Card title="执行结果" className="page-card" bordered={false}>
                <div className="markdown-body" style={{ background: 'var(--nb-surface-strong)', padding: 24, borderRadius: 8 }}>
                  <pre className="studio-run-pre">
                    {selectedRun.resultSummary.content}
                  </pre>
                </div>
              </Card>
            ) : (
              <Card className="page-card" bordered={false}>
                <Empty description="暂无执行结果" image={false} />
              </Card>
            )}
            
            <Row gutter={[24, 24]}>
              <Col span={24}>
                 <Card title="基础信息" className="page-card" bordered={false} size="small">
                  <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="middle">
                    <Descriptions.Item label="Run ID">
                      <Text copyable code>{selectedRun.runId}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Agent">
                      {selectedRun.agentId ? <Tag color="blue" bordered={false}>{selectedRun.agentId}</Tag> : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Team">
                      {selectedRun.teamId ? <Tag color="geekblue" bordered={false}>{selectedRun.teamId}</Tag> : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="创建时间">
                      {formatDateTimeZh(selectedRun.createdAt)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Thread ID">
                      {selectedRun.threadId ? <Text code copyable>{selectedRun.threadId}</Text> : '-'}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>
            </Row>
          </Space>
        )
      },
      {
        key: 'timeline',
        label: '时间轴',
        icon: <ClockCircleOutlined />,
        children: (
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
            {childTaskActivities.length > 0 ? (
              <Card
                className="page-card"
                bordered={false}
                title="子任务执行"
                extra={(
                  <Space wrap size={[8, 8]}>
                    <Tag bordered={false}>总计 {childTaskActivities.length}</Tag>
                    <Tag color="blue" bordered={false}>
                      活动中 {childTaskActivities.filter((item) => ['scheduled', 'queued', 'running', 'cancel_requested'].includes(item.status)).length}
                    </Tag>
                    <Tag color="green" bordered={false}>
                      成功 {childTaskActivities.filter((item) => ['ok', 'succeeded'].includes(item.status)).length}
                    </Tag>
                  </Space>
                )}
              >
                <List
                  dataSource={childTaskActivities}
                  renderItem={(item) => (
                    <List.Item key={item.key}>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                          <Space wrap>
                            <Text strong>{item.label}</Text>
                            <Tag color={childTaskStatusColor(item.status)} bordered={false}>
                              {childTaskStatusLabel(item.status)}
                            </Tag>
                            {item.principalKind ? <Tag bordered={false}>{item.principalKind}</Tag> : null}
                            {item.childControlScope ? controlScopeTag(item.childControlScope) : null}
                          </Space>
                          {item.runId ? (
                            <Button size="small" onClick={() => navigate(`/studio/runs/${item.runId}`)}>
                              查看运行
                            </Button>
                          ) : null}
                        </div>
                        <Space wrap size={[8, 8]} style={{ marginTop: 8 }}>
                          {item.runId ? <Text code copyable>{item.runId}</Text> : null}
                          {item.originChannel ? (
                            <Tag bordered={false}>{`${item.originChannel}:${item.originChatId || '-'}`}</Tag>
                          ) : null}
                          {item.progressStage ? <Tag color="processing" bordered={false}>{item.progressStage}</Tag> : null}
                          {item.timeoutSeconds ? <Tag color="orange" bordered={false}>{`${item.timeoutSeconds}s`}</Tag> : null}
                          {item.scheduledAt ? <Text type="secondary">派发 {formatDateTimeZh(item.scheduledAt)}</Text> : null}
                          {item.updatedAt && !item.completedAt ? <Text type="secondary">运行中 {formatDateTimeZh(item.updatedAt)}</Text> : null}
                          {item.completedAt ? <Text type="secondary">完成 {formatDateTimeZh(item.completedAt)}</Text> : null}
                        </Space>
                        {item.task ? (
                          <Paragraph style={{ marginTop: 8, marginBottom: 0 }} ellipsis={{ rows: 1 }}>
                            {item.task}
                          </Paragraph>
                        ) : null}
                        {item.error ? (
                          <Text type="danger">{compactText(item.error)}</Text>
                        ) : item.progressMessage && !item.completedAt ? (
                          <Text type="secondary">{compactText(item.progressMessage)}</Text>
                        ) : item.content || item.childSummary ? (
                          <Text type="secondary">{compactText(item.content || item.childSummary)}</Text>
                        ) : null}
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            ) : null}
            <Card className="page-card" bordered={false} title="执行过程">
              {!selectedRun.events?.length ? (
                <Empty description="暂无过程记录" />
              ) : (
                <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 0' }}>
                  <Steps
                    direction="vertical"
                    size="small"
                    current={selectedRun.events.length - 1}
                    status={selectedRun.status === 'failed' ? 'error' : 'process'}
                    items={selectedRun.events.map(event => ({
                      title: (
                        <Space>
                          <Text strong>{eventLabel(event.eventType, devMode)}</Text>
                          <Tag bordered={false}>{event.eventType}</Tag>
                          <Text type="secondary">{formatDateTimeZh(event.createdAt)}</Text>
                        </Space>
                      ),
                      description: eventPayloadSummary(event.eventType, event.payload, devMode) && (
                        <div className="studio-run-event-summary">
                          <Text type="secondary" style={{ fontFamily: 'var(--font-mono)' }}>
                            {eventPayloadSummary(event.eventType, event.payload, devMode)}
                          </Text>
                        </div>
                      ),
                      icon: event.eventType === 'failed' ? <CloseCircleOutlined style={{ color: 'var(--nb-error)' }} /> :
                            event.eventType === 'completed' ? <CheckCircleOutlined style={{ color: 'var(--nb-success)' }} /> : undefined
                    }))}
                  />
                </div>
              )}
            </Card>
          </Space>
        )
      },
      {
        key: 'boundary',
        label: '边界审计',
        icon: <InfoCircleOutlined />,
        children: (
          <Card className="page-card" bordered={false} title="租户边界审计">
            {renderBoundaryAuditPanel(boundaryAudit, devMode)}
          </Card>
        ),
      },
      {
        key: 'tree',
        label: '任务树',
        icon: <ApartmentOutlined />,
        children: (
          <Card className="page-card" bordered={false} title="任务层级结构">
            {runTree ? renderTreeNode(runTree, selectedRunId, navigate) : <Empty />}
          </Card>
        )
      }
    ]

    // Add artifact tab if applicable
    if (selectedRun.artifactPath) {
      const artifactAudit = artifact?.audit || boundaryAudit?.artifact || null
      const lifecycleStatus = artifactAudit?.lifecycleStatus
      const retentionPolicy = artifactAudit?.retentionPolicy || null
      tabItems.push({
        key: 'artifact',
        label: '产物',
        icon: <FileTextOutlined />,
        children: (
          <Card className="page-card" bordered={false} title="任务产出归档">
            <div className="studio-run-artifact-panel">
              <Space direction="vertical" size={14}>
                <FileTextOutlined className="studio-run-artifact-icon" />
                <Title level={4} style={{ margin: 0 }}>{artifact?.fileName || artifactAudit?.fileName || '运行归档'}</Title>
                <Text type="secondary" className="studio-run-artifact-path">
                  {artifact?.artifactPath || selectedRun.artifactPath}
                </Text>
                {artifactAudit?.storageScope && (
                  <Tag bordered={false}>{artifactAudit.storageScope}</Tag>
                )}
                {artifactAudit?.lifecycleStatus && (
                  <Tag color={artifactLifecycleColor(artifactAudit.lifecycleStatus)} bordered={false}>
                    {artifactLifecycleLabel(artifactAudit.lifecycleStatus)}
                  </Tag>
                )}
                {artifactAudit?.currentStorageKey && (
                  <Text type="secondary" style={{ fontFamily: 'var(--font-mono)' }}>{artifactAudit.currentStorageKey}</Text>
                )}
                {artifactAudit?.governanceReason ? (
                  <Text type="secondary">治理备注：{artifactAudit.governanceReason}</Text>
                ) : null}
                <Text type="secondary">保留策略：{artifactRetentionSummary(artifactAudit)}</Text>
                {retentionPolicy?.nextAction && retentionPolicy.nextAction !== 'none' ? (
                  <Text type="secondary">
                    下次动作：{retentionPolicy.nextAction} {retentionPolicy.nextActionAt ? `@ ${formatDateTimeZh(retentionPolicy.nextActionAt)}` : ''}
                  </Text>
                ) : null}
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={handleDownloadArtifact}
                    size="large"
                    disabled={!artifact || lifecycleStatus === 'deleted'}
                  >
                    下载结果
                  </Button>
                  {lifecycleStatus === 'active' && (
                    <>
                      <Button
                        onClick={() => void handleArtifactLifecycle('archive')}
                        loading={artifactAction === 'archive'}
                      >
                        归档产物
                      </Button>
                      <Button
                        onClick={() => void handleArtifactLifecycle('quarantine')}
                        loading={artifactAction === 'quarantine'}
                      >
                        隔离产物
                      </Button>
                      <Button
                        danger
                        onClick={() => void handleArtifactLifecycle('delete')}
                        loading={artifactAction === 'delete'}
                      >
                        删除产物
                      </Button>
                    </>
                  )}
                  {lifecycleStatus === 'archived' && (
                    <>
                      <Button
                        icon={<SyncOutlined />}
                        onClick={() => void handleArtifactLifecycle('restore')}
                        loading={artifactAction === 'restore'}
                      >
                        恢复产物
                      </Button>
                      <Button
                        danger
                        onClick={() => void handleArtifactLifecycle('delete')}
                        loading={artifactAction === 'delete'}
                      >
                        删除产物
                      </Button>
                    </>
                  )}
                  {lifecycleStatus === 'quarantined' && (
                    <>
                      <Button
                        icon={<SyncOutlined />}
                        onClick={() => void handleArtifactLifecycle('restore')}
                        loading={artifactAction === 'restore'}
                      >
                        恢复产物
                      </Button>
                      <Button
                        danger
                        onClick={() => void handleArtifactLifecycle('delete')}
                        loading={artifactAction === 'delete'}
                      >
                        删除产物
                      </Button>
                    </>
                  )}
                  {lifecycleStatus === 'deleted' && (
                    <Button
                      icon={<SyncOutlined />}
                      onClick={() => void handleArtifactLifecycle('restore')}
                      loading={artifactAction === 'restore'}
                    >
                      恢复产物
                    </Button>
                  )}
                  <Button
                    onClick={() => void handleArtifactRetentionPolicy('set')}
                    loading={artifactAction === 'policy_set'}
                  >
                    设置保留策略
                  </Button>
                  {retentionPolicy?.enabled ? (
                    <>
                      <Button
                        onClick={() => void handleArtifactRetentionPolicy('apply')}
                        loading={artifactAction === 'policy_apply'}
                      >
                        执行保留策略
                      </Button>
                      <Button
                        onClick={() => void handleArtifactRetentionPolicy('clear')}
                        loading={artifactAction === 'policy_clear'}
                      >
                        清除保留策略
                      </Button>
                    </>
                  ) : null}
                </Space>
              </Space>
            </div>
          </Card>
        )
      })
    }

    return (
      <div className="page-stack">
        <PageHero
          className="page-hero-compact studio-hero"
          title={selectedRun.label}
          actions={(
            <Space wrap>
              <Tooltip title="刷新状态">
                <Button onClick={() => void loadRunDetail(selectedRun.runId)} loading={loadingDetail} icon={<ReloadOutlined />} shape="circle" />
              </Tooltip>
              <Button
                icon={<PauseCircleOutlined />}
                danger
                onClick={() => void handleCancelRun()}
                loading={cancelling}
                disabled={!isCancelable(selectedRun.status)}
              >
                停止任务
              </Button>
            </Space>
          )}
        />

        <div className="page-content-wrapper" style={{ padding: '0 var(--nb-layout-gutter)' }}>
          <Tabs items={tabItems} defaultActiveKey="overview" type="card" className="commercial-tabs" />
        </div>
      </div>
    )
  }

  // List View
  return (
    <div className="page-stack">
      <PageHero
        className="page-hero-compact studio-hero"
        title="执行记录"
        actions={(
          <Button icon={<ReloadOutlined />} onClick={() => void loadRuns()} loading={loadingRuns}>
            刷新列表
          </Button>
        )}
      />

      {error && <Alert type="error" showIcon message={error} style={{ margin: '0 var(--nb-layout-gutter)' }} />}

      <div className="page-content-wrapper" style={{ padding: '0 var(--nb-layout-gutter)' }}>
        <Card className="page-card" bordered={false} styles={{ body: { padding: 0 } }}>
          <div className="studio-runs-toolbar">
            <Space className="studio-runs-toolbar-filters">
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'running', label: '运行中' },
                  { value: 'succeeded', label: '成功' },
                  { value: 'failed', label: '失败' },
                ]}
              />
              <Select
                value={kindFilter}
                onChange={setKindFilter}
                options={[
                  { value: 'all', label: '全部类型' },
                  { value: 'agent', label: 'Agent' },
                ]}
              />
            </Space>
            {threadFilter && (
              <Tag className="studio-runs-toolbar-thread-tag" closable onClose={() => {
                const next = new URLSearchParams(searchParams)
                next.delete('threadId')
                setSearchParams(next)
              }}>
                Thread: {threadFilter}
              </Tag>
            )}
          </div>

          <Table
            dataSource={runs}
            columns={columns}
            rowKey="runId"
            loading={loadingRuns}
            scroll={{ x: 'max-content' }}
            pagination={{ 
              pageSize: 15,
              showTotal: (total) => `共 ${total} 条记录`,
              showSizeChanger: false
            }}
            onRow={(record) => ({
              onClick: () => navigate(`/studio/runs/${record.runId}`),
              style: { cursor: 'pointer' }
            })}
          />
        </Card>
      </div>
    </div>
  )
}
