import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Collapse, Empty, Flex, Input, Space, Spin, Tabs, Tag, Typography, theme } from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import SectionCard from '../../components/console/SectionCard'
import { formatDateTimeZh } from '../../locale'
import type { AgentDefinition, AgentMemorySnapshot } from '../../types'
import { MarkdownBubble } from '../../chat/chatPresentation'

interface MemoryTabProps {
  currentAgent: AgentDefinition | null
  agentMemory: AgentMemorySnapshot | null
  loadingMemory: boolean
  memoryError: string | null
  onRefresh: (agentId: string) => void
  onSaveMemory: (agentId: string, files: Record<string, string>) => void
}

const FILE_ORDER = ['AGENTS.md', 'SOUL.md', 'PROFILE.md', 'MEMORY.md'] as const

const FILE_DESCRIPTIONS: Record<(typeof FILE_ORDER)[number], string> = {
  'AGENTS.md': '定义这个 Agent 应该如何使用长期记忆。',
  'SOUL.md': '定义这个 Agent 的身份、边界和稳定行为方式。',
  'PROFILE.md': '沉淀关于用户的长期画像、偏好和背景。',
  'MEMORY.md': '沉淀项目事实、关键决策和未闭环事项。',
}

function buildDraftFiles(snapshot: AgentMemorySnapshot | null): Record<string, string> {
  return Object.fromEntries(
    FILE_ORDER.map((fileName) => [fileName, snapshot?.files?.[fileName]?.content || '']),
  )
}

export default function MemoryTab({
  currentAgent,
  agentMemory,
  loadingMemory,
  memoryError,
  onRefresh,
  onSaveMemory,
}: MemoryTabProps) {
  const { token } = theme.useToken()
  const [activeFile, setActiveFile] = useState<(typeof FILE_ORDER)[number]>('AGENTS.md')
  const [draftFiles, setDraftFiles] = useState<Record<string, string>>(() => buildDraftFiles(agentMemory))

  useEffect(() => {
    setDraftFiles(buildDraftFiles(agentMemory))
  }, [agentMemory, currentAgent?.agentId])

  const fileItems = useMemo(
    () =>
      FILE_ORDER.map((fileName) => {
        const snapshot = agentMemory?.files?.[fileName]
        return {
          key: fileName,
          label: fileName,
          children: (
            <Flex vertical gap={token.marginMD}>
              <Typography.Text type="secondary">
                {FILE_DESCRIPTIONS[fileName]}
              </Typography.Text>
              <div
                style={{
                  display: 'grid',
                  gap: token.marginLG,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                }}
              >
                <div
                  style={{
                    padding: '2px',
                    borderRadius: token.borderRadiusLG,
                    background: token.colorBgContainer,
                  }}
                >
                  <Input.TextArea
                    value={draftFiles[fileName] || ''}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      setDraftFiles((current) => ({ ...current, [fileName]: nextValue }))
                    }}
                    rows={14}
                    placeholder={`编辑 ${fileName}`}
                    aria-label={fileName}
                    style={{
                      borderRadius: token.borderRadiusLG,
                      border: 'none',
                      background: 'transparent',
                      lineHeight: 1.7,
                    }}
                  />
                </div>
                <div
                  style={{
                    padding: token.margin,
                    borderRadius: token.borderRadiusLG,
                    background: token.colorBgContainer,
                    minHeight: 320,
                  }}
                >
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: token.marginXS }}>
                    Markdown 预览
                  </Typography.Text>
                  <MarkdownBubble content={draftFiles[fileName] || '*(暂无内容)*'} isStreaming={false} />
                </div>
              </div>
              <Typography.Text type="secondary">
                {snapshot?.updatedAt ? `最后更新：${formatDateTimeZh(snapshot.updatedAt)}` : '尚未记录更新时间'}
              </Typography.Text>
            </Flex>
          ),
        }
      }),
    [agentMemory?.files, draftFiles, token],
  )

  const latestNotes = agentMemory?.dailyNotes || []

  return (
    <Flex vertical gap={token.marginLG} align="stretch">
      <SectionCard
        title="长期记忆骨架"
        action={(
          <Space wrap size={[8, 8]}>
            {currentAgent ? <Tag color="blue" style={{ borderRadius: token.borderRadiusLG, border: 'none' }}>Agent Workspace</Tag> : null}
            {agentMemory?.updatedAt ? (
              <Tag style={{ borderRadius: token.borderRadiusLG, border: 'none' }}>
                {formatDateTimeZh(agentMemory.updatedAt)}
              </Tag>
            ) : null}
          </Space>
        )}
      >
        <Flex vertical gap={token.marginMD}>
          {memoryError ? (
            <Alert type="error" message={memoryError} showIcon style={{ borderRadius: token.borderRadiusLG }} />
          ) : null}
          <Alert
            type="info"
            showIcon
            style={{ borderRadius: token.borderRadiusLG }}
            message="这四个文件会作为 Agent 的长期记忆骨架参与运行；daily notes 仅作为 Dream 整理输入，不直接当作主提示词。"
          />

          {!currentAgent ? (
            <Alert type="info" message="未保存员工，无法编辑长期记忆。" showIcon style={{ borderRadius: token.borderRadiusLG }} />
          ) : (
            <>
              <Tabs
                activeKey={activeFile}
                onChange={(key) => setActiveFile(key as (typeof FILE_ORDER)[number])}
                items={fileItems}
              />
              <Space wrap size={[8, 8]}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => currentAgent && onRefresh(currentAgent.agentId)}
                  loading={loadingMemory}
                  style={{ borderRadius: token.borderRadiusLG }}
                >
                  刷新
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={() => currentAgent && onSaveMemory(currentAgent.agentId, draftFiles)}
                  style={{ borderRadius: token.borderRadiusLG }}
                >
                  保存四文件
                </Button>
              </Space>
            </>
          )}
        </Flex>
      </SectionCard>

      <SectionCard title="Daily Notes">
        {loadingMemory && latestNotes.length === 0 ? (
          <Flex justify="center" align="center" style={{ minHeight: 160 }}>
            <Spin tip="正在加载 daily notes..." size="large"><div /></Spin>
          </Flex>
        ) : latestNotes.length === 0 ? (
          <Empty image={false} className="minimal-empty" description="暂无 daily notes。" />
        ) : (
          <Collapse
            items={latestNotes.map((note) => ({
              key: note.fileName,
              label: (
                <Flex justify="space-between" align="center" style={{ width: '100%', paddingRight: token.marginSM }}>
                  <Typography.Text strong>{note.fileName}</Typography.Text>
                  <Typography.Text type="secondary">
                    {note.updatedAt ? formatDateTimeZh(note.updatedAt) : '未记录时间'}
                  </Typography.Text>
                </Flex>
              ),
              children: <MarkdownBubble content={note.content || '*(暂无内容)*'} isStreaming={false} />,
            }))}
          />
        )}
      </SectionCard>
    </Flex>
  )
}
