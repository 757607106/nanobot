import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Flex, Input, Space, Spin, Tag, Typography, theme } from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import SectionCard from '../../components/console/SectionCard'
import { formatDateTimeZh } from '../../locale'
import type { AgentDefinition, AgentMemorySnapshot, MemoryCandidate } from '../../types'
import MemoryCandidateCard from './MemoryCandidateCard'
import { memoryScopeLabel } from './utils'
import { MarkdownBubble } from '../../chat/chatPresentation'

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

  const { token } = theme.useToken()
  const pendingCount = agentMemoryCandidates.filter((item) => item.status === 'proposed').length

  useEffect(() => {
    setDraft(agentMemory?.content || '')
  }, [agentMemory?.content, currentAgent?.agentId])

  return (
    <Flex vertical gap={token.marginLG} align="stretch">
      <Flex vertical gap={token.marginLG}>
        <SectionCard
          title="长期核心记忆"
          action={(
            <Space wrap size={[8, 8]}>
              {currentAgent ? <Tag color="blue" style={{ borderRadius: token.borderRadiusLG, border: 'none' }}>{memoryScopeLabel(formMemoryScope)}</Tag> : null}
              <Tag color="purple" style={{ borderRadius: token.borderRadiusLG, border: 'none' }}>{`${pendingCount} 待处理`}</Tag>
            </Space>
          )}
        >
          <Flex vertical gap={token.marginMD}>
            {memoryError ? <Alert type="error" message={memoryError} showIcon style={{ borderRadius: token.borderRadiusLG }} /> : null}

            {!currentAgent ? (
              <Alert type="info" message="未保存员工，无法编辑记忆" showIcon style={{ borderRadius: token.borderRadiusLG }} />
            ) : (
              <>
                <div style={{ padding: '2px', borderRadius: token.borderRadiusLG, background: token.colorBgContainer }}>
                  <Input.TextArea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={8}
                    placeholder="在此编辑员工长期的记忆、偏好与专属规范..."
                    aria-label="员工长期记忆"
                    style={{ borderRadius: token.borderRadiusLG, border: 'none', background: 'transparent', lineHeight: 1.6 }}
                  />
                </div>
                <div style={{ padding: token.margin, borderRadius: token.borderRadiusLG, background: token.colorBgContainer }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: token.marginXS }}>
                    Markdown 预览
                  </Typography.Text>
                  <MarkdownBubble content={draft || '*(暂无内容)*'} isStreaming={false} />
                </div>
                <Space wrap size={[8, 8]}>
                  <Button icon={<ReloadOutlined />} onClick={() => currentAgent && onRefresh(currentAgent.agentId)} loading={loadingMemory} style={{ borderRadius: token.borderRadiusLG }}>
                    刷新提取
                  </Button>
                  <Button type="primary" icon={<SaveOutlined />} onClick={() => currentAgent && onSaveMemory(currentAgent.agentId, draft)} style={{ borderRadius: token.borderRadiusLG }}>
                    覆写记忆
                  </Button>
                  <Button onClick={() => currentAgent && navigate(`/studio/memory/agents/${currentAgent.agentId}`)} style={{ borderRadius: token.borderRadiusLG }}>
                    全局记忆审计
                  </Button>
                </Space>
              </>
            )}
          </Flex>
        </SectionCard>

        <SectionCard title="候选记忆队列">
          <Flex vertical gap={token.marginLG}>
            <div style={{ padding: '2px', borderRadius: token.borderRadiusLG, background: token.colorBgContainer }}>
              <Input.TextArea
                value={candidateDraft}
                onChange={(event) => setCandidateDraft(event.target.value)}
                rows={3}
                placeholder="在此粘贴测试文本来生成并提交流水线候选记忆..."
                aria-label="提交候选"
                style={{ borderRadius: token.borderRadiusLG, border: 'none', background: 'transparent', lineHeight: 1.6 }}
              />
            </div>
            <div>
              <Button onClick={() => currentAgent && onCreateCandidate(currentAgent.agentId, candidateDraft)} disabled={!currentAgent} style={{ borderRadius: token.borderRadiusLG }}>
                人工提交候选
              </Button>
            </div>

            {loadingMemory && agentMemoryCandidates.length === 0 ? (
              <Flex justify="center" align="center" style={{ minHeight: 180 }}>
                <Spin tip="正在同步候选记录..." size="large"><div /></Spin>
              </Flex>
            ) : agentMemoryCandidates.length === 0 ? (
              <Empty image={false} className="minimal-empty" description="已清空" style={{ marginTop: 24, marginBottom: 24 }} />
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 16
              }}>
                {agentMemoryCandidates.map((candidate) => (
                  <MemoryCandidateCard
                    key={candidate.candidateId}
                    candidate={candidate}
                    onApply={() => currentAgent && onApplyCandidate(currentAgent.agentId, candidate.candidateId)}
                    onReject={() => currentAgent && onRejectCandidate(currentAgent.agentId, candidate.candidateId)}
                  />
                ))}
              </div>
            )}
          </Flex>
        </SectionCard>
      </Flex>
    </Flex>
  )
}
