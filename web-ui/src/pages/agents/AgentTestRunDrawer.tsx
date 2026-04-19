import { useState } from 'react'
import {
  Button,
  Drawer,
  Flex,
  Input,
  Typography,
} from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { AgentTestRunResult } from '../../types'
import { useToast } from '../../toast'
import { designTokens } from '../../ui/design/tokens'
import { MarkdownBubble } from '../../chat/chatPresentation'

interface Props {
  open: boolean
  onClose: () => void
  agentId: string
  agentName: string
}

export default function AgentTestRunDrawer({ open, onClose, agentId, agentName }: Props) {
  const message = useToast()
  
  const [content, setContent] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<AgentTestRunResult | null>(null)

  async function handleTest() {
    if (!content.trim()) {
      message.error('请输入测试内容')
      return
    }
    try {
      setTesting(true)
      setResult(null)
      const res = await api.testRunAgent(agentId, content)
      setResult(res)
      message.success('测试运行完成')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试运行失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Drawer
      title={`沙盒试运行 - ${agentName}`}
      width={600}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      <Flex vertical gap={16} style={{ height: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          这里的试运行不会写入正式会话历史，将按当前员工配置执行并返回结果。
        </Typography.Paragraph>

        <div>
          <Input.TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="输入要测试的问题或指令…"
            rows={4}
            disabled={testing}
          />
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => void handleTest()}
              loading={testing}
            >
              发送测试
            </Button>
          </div>
        </div>

        {testing && (
          <Flex justify="center" align="center" style={{ flex: 1 }}>
            <Typography.Text type="secondary">正在运行…</Typography.Text>
          </Flex>
        )}

        {!testing && result && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: designTokens.space.md, background: 'var(--nb-surface)', borderRadius: 8, border: '1px solid var(--nb-border)' }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                回答内容:
              </Typography.Text>
              <MarkdownBubble content={result.assistantMessage?.content || '*(无文本回答)*'} isStreaming={false} />
            </div>
            
            {result.run && (
              <div style={{ marginTop: designTokens.space.md }}>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8, fontSize: 'var(--nb-text-xs)', color: 'var(--nb-text-primary)' }}>
                  执行消耗概览
                </Typography.Text>
                
                <Flex gap={12} wrap style={{ marginBottom: 16 }}>
                  {(result.run.provider || result.run.model) && (
                    <div style={{ padding: '8px 12px', background: 'var(--nb-surface)', borderRadius: 6, border: '1px solid var(--nb-border)' }}>
                      <Typography.Text type="secondary" style={{ fontSize: '11px', display: 'block', marginBottom: 2, letterSpacing: 0.2 }}>模型</Typography.Text>
                      <Typography.Text strong style={{ fontSize: '13px' }}>{result.run.provider || 'default'} {result.run.model ? `· ${result.run.model}` : ''}</Typography.Text>
                    </div>
                  )}
                  {result.run.totalTokens !== undefined && result.run.totalTokens > 0 && (
                    <div style={{ padding: '8px 12px', background: 'var(--nb-surface)', borderRadius: 6, border: '1px solid var(--nb-border)' }}>
                      <Typography.Text type="secondary" style={{ fontSize: '11px', display: 'block', marginBottom: 2, letterSpacing: 0.2 }}>Token 消耗</Typography.Text>
                      <Typography.Text strong style={{ fontSize: '13px', color: '#1677ff' }}>{result.run.totalTokens}</Typography.Text>
                      <Typography.Text style={{ fontSize: '11px', color: 'var(--nb-text-secondary)', marginLeft: 6 }}>
                        （输入 {result.run.promptTokens || 0} · 输出 {result.run.completionTokens || 0}）
                      </Typography.Text>
                    </div>
                  )}
                </Flex>

                {result.run.resultSummary && (
                  <Flex vertical gap={8} style={{ marginBottom: 16 }}>
                    {Object.keys(result.run.resultSummary.tools_call_counts || {}).length > 0 && (
                       <Flex gap={8} align="center" wrap>
                          <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', width: 65 }}>工具：</Typography.Text>
                          {Object.entries(result.run.resultSummary.tools_call_counts!).map(([k, v]) => (
                            <div key={k} style={{ fontSize: '12px', border: '1px solid var(--nb-border)', padding: '2px 8px', borderRadius: 4, background: 'var(--nb-surface)', color: 'var(--nb-text-primary)' }}>
                              {k} <span style={{ color: '#1677ff', fontWeight: 600, marginLeft: 4 }}>×{v as any}</span>
                            </div>
                          ))}
                       </Flex>
                    )}
                    {Object.keys(result.run.resultSummary.mcps_call_counts || {}).length > 0 && (
                       <Flex gap={8} align="center" wrap>
                          <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', width: 65 }}>MCP：</Typography.Text>
                          {Object.entries(result.run.resultSummary.mcps_call_counts!).map(([k, v]) => (
                            <div key={k} style={{ fontSize: '12px', border: '1px solid var(--nb-border)', padding: '2px 8px', borderRadius: 4, background: 'var(--nb-surface)', color: 'var(--nb-text-primary)' }}>
                              {k} <span style={{ color: '#1677ff', fontWeight: 600, marginLeft: 4 }}>×{v as any}</span>
                            </div>
                          ))}
                       </Flex>
                    )}
                    {Object.keys(result.run.resultSummary.knowledge_call_counts || {}).length > 0 && (
                       <Flex gap={8} align="center" wrap>
                          <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)', width: 65 }}>知识库：</Typography.Text>
                          {Object.entries(result.run.resultSummary.knowledge_call_counts!).map(([k, v]) => (
                            <div key={k} style={{ fontSize: '12px', border: '1px solid var(--nb-border)', padding: '2px 8px', borderRadius: 4, background: 'var(--nb-surface)', color: 'var(--nb-text-primary)' }}>
                              {k} <span style={{ color: '#1677ff', fontWeight: 600, marginLeft: 4 }}>×{v as any}</span>
                            </div>
                          ))}
                       </Flex>
                    )}
                  </Flex>
                )}
                
                <Typography.Text type="secondary" style={{ fontSize: 'var(--nb-text-xs)' }}>
                  状态：{result.run.status} · 耗时：{(result.run as any).durationMs || '-'} ms
                </Typography.Text>
              </div>
            )}
          </div>
        )}
      </Flex>
    </Drawer>
  )
}
