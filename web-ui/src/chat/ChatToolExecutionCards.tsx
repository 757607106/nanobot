import { Tag } from 'antd'
import { ToolOutlined } from '@ant-design/icons'

export interface ToolExecutionResult {
  key: string
  name: string
  content: string
  createdAt?: string
}

export interface ToolExecutionEntry {
  key: string
  callId?: string
  name: string
  args?: string
  results: ToolExecutionResult[]
  status: 'pending' | 'running' | 'success' | 'error'
}

const STATUS_META: Record<ToolExecutionEntry['status'], { label: string; color?: 'success' | 'processing' | 'error' | 'default' }> = {
  pending: { label: '待返回', color: 'default' },
  running: { label: '执行中', color: 'processing' },
  success: { label: '已完成', color: 'success' },
  error: { label: '失败', color: 'error' },
}

function formatPayload(raw?: string) {
  if (!raw) {
    return ''
  }

  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function summarizeResult(content: string) {
  const trimmed = content.trim()
  if (trimmed.length <= 140) {
    return trimmed || '工具未返回文本内容'
  }
  return `${trimmed.slice(0, 140)}...`
}

interface ChatToolExecutionCardsProps {
  entries: ToolExecutionEntry[]
}

export default function ChatToolExecutionCards({ entries }: ChatToolExecutionCardsProps) {
  if (!entries.length) {
    return null
  }

  return (
    <div className="chat-tool-execution-list">
      {entries.map((entry) => {
        const statusMeta = STATUS_META[entry.status]
        const latestResult = entry.results[entry.results.length - 1]

        return (
          <div className="chat-tool-execution-card" key={entry.key}>
            <div className="chat-tool-execution-head">
              <span className="chat-tool-execution-title">
                <ToolOutlined />
                <span>{entry.name}</span>
              </span>
              <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
            </div>

            <div className="chat-tool-execution-summary">
              {latestResult
                ? summarizeResult(latestResult.content)
                : entry.status === 'running'
                  ? '工具已发起，正在等待返回结果。'
                  : '工具调用已记录，暂未关联到返回结果。'}
            </div>

            {entry.args ? (
              <details className="chat-tool-execution-details">
                <summary>查看参数</summary>
                <pre>{formatPayload(entry.args)}</pre>
              </details>
            ) : null}

            {entry.results.length ? (
              <details className="chat-tool-execution-details">
                <summary>{entry.results.length === 1 ? '查看结果' : `查看结果（${entry.results.length} 条）`}</summary>
                <div className="chat-tool-execution-result-list">
                  {entry.results.map((result) => (
                    <div className="chat-tool-execution-result" key={result.key}>
                      <div className="chat-tool-execution-result-head">
                        <span>{result.name || entry.name}</span>
                        <span>{result.createdAt || '刚刚'}</span>
                      </div>
                      <pre>{formatPayload(result.content)}</pre>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
