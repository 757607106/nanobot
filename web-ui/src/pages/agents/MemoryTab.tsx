import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Flex, Input, Space, Spin, Tag } from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import SectionCard from '../../components/console/SectionCard'
import { formatDateTimeZh } from '../../locale'
import type { AgentDefinition, AgentMemorySnapshot, MemoryCandidate } from '../../types'
import MemoryCandidateCard from './MemoryCandidateCard'
import { memoryScopeLabel } from './utils'

interface MemoryTabProps {
  currentAgent: AgentDefinition | null
  agentMemory: AgentMemorySnapshot | null
  agentMemoryCandidates: MemoryCandidate[]
  formMemoryScope: string
  loadingMemory: boolean
  memoryError: string | null
  onRefresh: (agentId: string) => void
  onSaveMemory: (agentId: string, content: string) => void
  onCreateCandidate: (agentId: string, content: string) => void
  onApplyCandidate: (agentId: string, candidateId: string) => void
  onRejectCandidate: (agentId: string, candidateId: string) => void
}

export default function MemoryTab({
  currentAgent,
  agentMemory,
  agentMemoryCandidates,
  formMemoryScope,
  loadingMemory,
  memoryError,
  onRefresh,
  onSaveMemory,
  onCreateCandidate,
  onApplyCandidate,
  onRejectCandidate,
}: MemoryTabProps) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState(agentMemory?.content || '')
  const [candidateDraft, setCandidateDraft] = useState('')

  const pendingCount = agentMemoryCandidates.filter((item) => item.status === 'proposed').length

  useEffect(() => {
    setDraft(agentMemory?.content || '')
  }, [agentMemory?.content, currentAgent?.agentId])

  return (
    <Flex vertical gap={6}>
      <SectionCard
        title="员工长期记忆"
        action={(
          <Space wrap size={[8, 8]}>
            {currentAgent ? <Tag color="blue">{memoryScopeLabel(formMemoryScope)}</Tag> : null}
            <Tag color="purple">{`${pendingCount} 待处理`}</Tag>
          </Space>
        )}
      >
        <Flex vertical gap={6}>
          {memoryError ? <Alert type="error" message={memoryError} showIcon /> : null}

          {!currentAgent ? (
            <Alert type="info" message="未保存员工" showIcon />
          ) : (
            <>
              <Input.TextArea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={8}
                placeholder="长期偏好与规范"
                aria-label="员工长期记忆"
              />
              <Space wrap size={[8, 8]}>
                <Button icon={<ReloadOutlined />} onClick={() => currentAgent && onRefresh(currentAgent.agentId)} loading={loadingMemory}>
                  刷新
                </Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => currentAgent && onSaveMemory(currentAgent.agentId, draft)}>
                  保存记忆
                </Button>
                <Button onClick={() => currentAgent && navigate(`/studio/memory/agents/${currentAgent.agentId}`)}>
                  统一审计
                </Button>
              </Space>
            </>
          )}
        </Flex>
      </SectionCard>

      <SectionCard title="提交候选">
        <Flex vertical gap={6}>
          <Input.TextArea
            value={candidateDraft}
            onChange={(event) => setCandidateDraft(event.target.value)}
            rows={5}
            placeholder="候选记忆"
            aria-label="提交候选"
          />
          <Space wrap size={[8, 8]}>
            <Button onClick={() => currentAgent && onCreateCandidate(currentAgent.agentId, candidateDraft)} disabled={!currentAgent}>
              提交候选
            </Button>
          </Space>
        </Flex>
      </SectionCard>

      <SectionCard title="候选记录">
        {loadingMemory && agentMemoryCandidates.length === 0 ? (
          <Flex justify="center" align="center" style={{ minHeight: 180 }}>
            <Spin tip="正在加载候选记录..." />
          </Flex>
        ) : agentMemoryCandidates.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无员工记忆候选。" />
        ) : (
          <Flex vertical gap={3}>
            {agentMemoryCandidates.map((candidate) => (
              <MemoryCandidateCard
                key={candidate.candidateId}
                candidate={candidate}
                onApply={() => currentAgent && onApplyCandidate(currentAgent.agentId, candidate.candidateId)}
                onReject={() => currentAgent && onRejectCandidate(currentAgent.agentId, candidate.candidateId)}
              />
            ))}
          </Flex>
        )}
      </SectionCard>
    </Flex>
  )
}
