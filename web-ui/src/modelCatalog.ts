const providerModelCatalog: Record<string, string[]> = {
  openrouter: ['anthropic/claude-opus-4-5', 'openai/gpt-5', 'google/gemini-2.5-pro'],
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-6'],
  openai: ['gpt-4.1', 'gpt-4o', 'gpt-5'],
  openai_codex: ['openai-codex/gpt-5.1-codex'],
  github_copilot: ['github_copilot/gpt-4o'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  dashscope: ['qwen-max', 'qwen-plus', 'qwen3-coder-plus'],
  moonshot: ['kimi-k2.5', 'kimi-k2-turbo-preview'],
  zhipu: ['glm-4.5', 'glm-4.5-air'],
  minimax: ['MiniMax-M2', 'MiniMax-Text-01'],
  groq: ['llama-3.3-70b-versatile', 'llama3-8b-8192'],
  siliconflow: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
  volcengine: ['deepseek-v3-250324', 'doubao-1-5-pro-32k-250115'],
  ollama: ['llama3.2', 'qwen2.5-coder:7b'],
  vllm: ['meta-llama/Llama-3.1-8B-Instruct'],
  azure_openai: ['your-deployment-name'],
  aihubmix: ['openai/gpt-4o', 'claude-sonnet-4-6', 'deepseek-chat'],
}

export function getModelSuggestions(providerName: string, currentModel?: string | null) {
  const suggestions = providerModelCatalog[providerName] ?? []
  const values = currentModel?.trim() ? [currentModel.trim(), ...suggestions] : suggestions
  return Array.from(new Set(values.filter(Boolean)))
}
