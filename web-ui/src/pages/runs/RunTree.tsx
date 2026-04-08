import { Badge, Card, Empty, Space, Tag, Typography } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { AgentRunTreeNode } from '../../types'
import { statusBadgeStatus, statusLabel, controlScopeTag } from './utils'

const { Text } = Typography

interface RunTreeProps {
  tree: AgentRunTreeNode | null
  selectedRunId: string | null
}

interface TreeNodeProps {
  node: AgentRunTreeNode
  selectedRunId: string | null
  navigate: ReturnType<typeof useNavigate>
}

function TreeNode({ node, selectedRunId, navigate }: TreeNodeProps) {
  const children = node.children || []
  const active = node.runId === selectedRunId

  return (
    <div
      style={{
        marginLeft: children.length > 0 ? 16 : 0,
        borderLeft: children.length > 0 ? '2px solid var(--nb-border)' : 'none',
      }}
    >
      <div
        onClick={() => navigate(`/studio/runs/${node.runId}`)}
        style={{
          padding: '12px 16px',
          marginLeft: children.length > 0 ? 12 : 0,
          marginBottom: 8,
          borderRadius: 8,
          cursor: 'pointer',
          background: active ? 'var(--ant-color-primary-bg)' : 'var(--nb-surface)',
          border: `1px solid ${active ? 'var(--ant-color-primary)' : 'var(--nb-border)'}`,
          transition: 'all 0.2s',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <Space>
            <RobotOutlined />
            <Text strong>{node.label}</Text>
            {controlScopeTag(node.controlScope) && (
              <Tag bordered={false}>{controlScopeTag(node.controlScope)}</Tag>
            )}
          </Space>
          <Badge status={statusBadgeStatus(node.status)} text={statusLabel(node.status)} />
        </div>
        {node.resultSummary?.content && (
          <Text type="secondary" ellipsis style={{ fontSize: 'var(--nb-text-xs)' }}>
            {node.resultSummary.content}
          </Text>
        )}
      </div>
      {children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.runId}
              node={child}
              selectedRunId={selectedRunId}
              navigate={navigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function RunTree({ tree, selectedRunId }: RunTreeProps) {
  const navigate = useNavigate()

  if (!tree) {
    return (
      <Card className="page-card" variant="borderless" title="任务层级">
        <Empty />
      </Card>
    )
  }

  return (
    <Card className="page-card" variant="borderless" title="任务层级">
      <TreeNode node={tree} selectedRunId={selectedRunId} navigate={navigate} />
    </Card>
  )
}
