import { Avatar, theme } from 'antd'
import type { ProviderIconAsset } from './types'

const providerIcons: Record<string, ProviderIconAsset> = {
  anthropic: { src: '/provider-logos/Anthropic.png', fallback: 'A' },
  openai: { src: '/provider-logos/openai.png', fallback: 'O' },
  openrouter: { fallback: 'R' },
  deepseek: { src: '/provider-logos/DeepSeek.png', fallback: 'D' },
  volcengine: { src: '/provider-logos/volcengine-color.png', fallback: 'V' },
  volcengine_coding_plan: { src: '/provider-logos/volcengine-color.png', fallback: 'V' },
  groq: { fallback: 'G' },
  zhipu: { src: '/provider-logos/qingyan-color.png', fallback: 'Z' },
  dashscope: { src: encodeURI('/provider-logos/百炼.png'), fallback: 'Q' },
  vllm: { fallback: 'L' },
  ollama: { src: '/provider-logos/ollama.png', fallback: 'O' },
  gemini: { src: '/provider-logos/Gemini.png', fallback: 'G' },
  moonshot: { fallback: 'M' },
  minimax: { fallback: 'M' },
  aihubmix: { fallback: 'H' },
  azure_openai: { src: '/provider-logos/openai.png', fallback: 'A' },
  siliconflow: { src: '/provider-logos/stability-color.png', fallback: 'S' },
  openai_codex: { src: '/provider-logos/codex-color.png', fallback: 'C' },
  custom: { fallback: 'C' },
}

interface ProviderAvatarProps {
  providerName: string
  label: string
  size?: number
}

export default function ProviderAvatar({ providerName, label, size = 44 }: ProviderAvatarProps) {
  const { token } = theme.useToken()
  const icon = providerIcons[providerName] ?? { fallback: label.slice(0, 1).toUpperCase() }

  return (
    <Avatar
      alt={label}
      src={icon.src}
      size={size}
      shape="square"
      style={{
        background: `${token.colorPrimary}16`,
        color: token.colorPrimary,
        fontWeight: 'var(--nb-font-weight-title)',
        flexShrink: 0,
      }}
    >
      {!icon.src ? icon.fallback : null}
    </Avatar>
  )
}
