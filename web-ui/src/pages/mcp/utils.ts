import type { McpServerTransport } from '../../types'

export type EditableTransport = 'stdio' | 'sse' | 'streamableHttp'

export interface ServerDraft {
  name: string
  displayName: string
  type: EditableTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  toolTimeout: number
}

export const transportLabels: Record<McpServerTransport, string> = {
  stdio: 'stdio',
  sse: 'SSE',
  streamableHttp: 'HTTP',
  unknown: '未识别',
}

export const transportOptions: Array<{ value: EditableTransport; label: string; description: string }> = [
  { value: 'stdio', label: 'stdio', description: '本地进程' },
  { value: 'streamableHttp', label: 'HTTP', description: '远程 HTTP' },
  { value: 'sse', label: 'SSE', description: '远程 SSE' },
]

export function createEmptyDraft(type: EditableTransport = 'stdio'): ServerDraft {
  return {
    name: '',
    displayName: '',
    type,
    command: '',
    argsText: '',
    envText: '',
    url: '',
    headersText: '',
    toolTimeout: 30,
  }
}

export function splitArgTokens(raw: string): string[] {
  const matches = raw.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return matches.map((item) => item.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean)
}

export function normalizeMappingObject(payload: Record<string, unknown>, label: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      const normalizedKey = key.trim()
      if (!normalizedKey) {
        throw new Error(`${label}中的键不能为空`)
      }
      return [normalizedKey, String(value ?? '').trim()]
    }),
  )
}

function parseLineMapping(raw: string, label: string, separator: '=' | ':'): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  for (const line of lines) {
    const index = line.indexOf(separator)
    if (index <= 0) {
      throw new Error(`${label}格式不正确，请按每行一条的方式填写`)
    }
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!key) {
      throw new Error(`${label}中的键不能为空`)
    }
    result[key] = value
  }

  return result
}

export function parseMappingInput(raw: string, label: string, separator: '=' | ':'): Record<string, string> {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {}
  }
  if (trimmed.startsWith('{')) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      throw new Error(`${label}格式不正确，请填写 JSON 对象或按每行一条的方式填写`)
    }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error(`${label}必须是 JSON 对象`)
    }
    return normalizeMappingObject(payload, label)
  }
  return parseLineMapping(raw, label, separator)
}

export function buildServerConfig(draft: {
  type: EditableTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  toolTimeout: number
}) {
  const isRemote = draft.type !== 'stdio'
  const timeout = Number(draft.toolTimeout || 30)
  if (timeout <= 0) {
    throw new Error('超时时间必须大于 0')
  }

  const command = draft.command.trim()
  const url = draft.url.trim()

  if (!isRemote && !command) {
    throw new Error('stdio 类型必须填写命令')
  }
  if (isRemote && !url) {
    throw new Error('远程类型必须填写远程地址')
  }

  return {
    type: draft.type,
    command: isRemote ? '' : command,
    args: isRemote ? [] : splitArgTokens(draft.argsText),
    env: isRemote ? {} : parseMappingInput(draft.envText, '环境变量', '='),
    url: isRemote ? url : '',
    headers: isRemote ? parseMappingInput(draft.headersText, '请求头', ':') : {},
    toolTimeout: timeout,
  }
}
