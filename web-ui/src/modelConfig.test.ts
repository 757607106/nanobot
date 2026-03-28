import { describe, expect, it } from 'vitest'

import { normalizeModelConfig } from './modelConfig'
import type { ConfigData, ConfigMeta } from './types'

function makeMeta(): ConfigMeta {
  return {
    providers: [
      {
        name: 'dashscope',
        label: 'DashScope',
        category: 'standard',
        keywords: ['dashscope', 'qwen'],
        defaultApiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        supportsPromptCaching: false,
        isGateway: false,
        isLocal: false,
        isOauth: false,
        isDirect: false,
      },
    ],
    resolvedProvider: 'dashscope',
    resolvedBinding: 'qwen-max',
  }
}

function makeConfig(): ConfigData {
  return {
    agents: {
      defaults: {
        workspace: '/tmp/workspace',
        model: 'qwen-max',
        binding: 'qwen-max',
        provider: 'dashscope',
        maxTokens: 4096,
        contextWindowTokens: 128000,
        temperature: 0.1,
        maxToolIterations: 12,
        reasoningEffort: null,
      },
    },
    providers: {
      dashscope: {
        apiKey: 'sk-provider-key',
        apiBase: 'https://dashscope.example.com/compatible-mode/v1',
        extraHeaders: { 'X-Test': 'provider' },
      },
    },
    modelBindings: {
      'qwen-max': {
        provider: 'dashscope',
        label: 'Qwen Max',
        model: 'qwen-max',
        capabilityType: 'text_chat',
        apiKey: '',
        apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        extraHeaders: {},
      },
    },
    channels: {
      sendProgress: true,
      sendToolHints: false,
    },
    gateway: {
      host: '127.0.0.1',
      port: 18790,
    },
    tools: {
      restrictToWorkspace: true,
    },
  }
}

describe('normalizeModelConfig', () => {
  it('preserves explicit provider credentials when bindings inherit them', () => {
    const normalized = normalizeModelConfig(makeConfig(), makeMeta())

    expect(normalized.providers.dashscope.apiKey).toBe('sk-provider-key')
    expect(normalized.providers.dashscope.apiBase).toBe('https://dashscope.example.com/compatible-mode/v1')
    expect(normalized.providers.dashscope.extraHeaders).toEqual({ 'X-Test': 'provider' })
  })
})
