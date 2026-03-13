export type FieldKind = 'text' | 'password' | 'number' | 'switch' | 'list' | 'textarea' | 'select'

export interface FieldOption {
  label: string
  value: string
}

export interface FieldMeta {
  path: string[]
  label: string
  kind: FieldKind
  placeholder?: string
  description?: string
  min?: number
  max?: number
  step?: number
  options?: FieldOption[]
}

export interface ChannelMeta {
  name: string
  label: string
  category: 'Social' | 'Enterprise' | 'Collaboration' | 'Inbox'
  description: string
  primaryFields: FieldMeta[]
}

export const providerDescriptions: Record<string, string> = {
  custom: '用于私有网关或内部模型服务的 OpenAI 兼容端点。',
  azure_openai: 'Azure 托管的 OpenAI 部署，模型名通常对应 deployment 名称。',
  anthropic: 'Claude 模型供应商，支持原生路由与提示词缓存能力。',
  openai: '直接连接 OpenAI，适合 GPT 系列与兼容 OpenAI API 的模型。',
  openrouter: '聚合型网关，可在一个账号下路由多个模型家族。',
  deepseek: 'DeepSeek 官方托管模型，使用 provider 前缀进行路由。',
  groq: '主打低延迟推理的托管供应商。',
  zhipu: '智谱 / GLM 系列托管模型。',
  dashscope: '阿里云百炼 / 通义千问托管模型。',
  vllm: '自托管 vLLM 服务，适合私有部署模型推理。',
  gemini: 'Google Gemini 托管模型。',
  moonshot: 'Moonshot / Kimi 托管模型。',
  minimax: 'MiniMax 托管模型。',
  aihubmix: '兼容 OpenAI 的聚合网关，可路由多个第三方模型。',
  ollama: '本地 Ollama 运行时，通常只需要配置 API Base。',
  siliconflow: '硅基流动网关，提供 OpenAI 兼容接口。',
  volcengine: '火山引擎 Ark 网关，用于托管模型访问。',
  openai_codex: '基于 OAuth 的 Codex 集成，认证不在本页配置。',
  github_copilot: '基于 OAuth 的 GitHub Copilot 集成，认证不在本页配置。',
}

export const providerCategoryLabels: Record<string, string> = {
  direct: '直连端点',
  gateway: '聚合网关',
  local: '本地 / 自托管',
  oauth: 'OAuth 接入',
  standard: '托管供应商',
}

export const channelCategoryLabels: Record<ChannelMeta['category'], string> = {
  Social: '社交通道',
  Collaboration: '协作平台',
  Enterprise: '企业平台',
  Inbox: '邮箱收件',
}

const allowFromPlaceholder = '每行一个值；填 * 允许所有人'

export const channelMetas: ChannelMeta[] = [
  {
    name: 'telegram',
    label: 'Telegram',
    category: 'Social',
    description: 'Telegram 机器人接入，支持白名单、代理和群聊回复策略。',
    primaryFields: [
      { path: ['token'], label: '机器人 Token', kind: 'password' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
      { path: ['proxy'], label: '代理地址', kind: 'text', placeholder: 'http://127.0.0.1:7890' },
      {
        path: ['groupPolicy'],
        label: '群聊策略',
        kind: 'select',
        options: [
          { label: '仅提及时响应', value: 'mention' },
          { label: '全部消息响应', value: 'open' },
        ],
      },
      { path: ['replyToMessage'], label: '引用原消息回复', kind: 'switch' },
    ],
  },
  {
    name: 'whatsapp',
    label: 'WhatsApp',
    category: 'Social',
    description: '通过桥接服务接入 WhatsApp，支持共享令牌和发送者白名单。',
    primaryFields: [
      { path: ['bridgeUrl'], label: '桥接地址', kind: 'text' },
      { path: ['bridgeToken'], label: '桥接令牌', kind: 'password' },
      { path: ['allowFrom'], label: '允许号码', kind: 'list', placeholder: allowFromPlaceholder },
    ],
  },
  {
    name: 'discord',
    label: 'Discord',
    category: 'Social',
    description: 'Discord 机器人接入，包含网关参数与群组策略控制。',
    primaryFields: [
      { path: ['token'], label: '机器人 Token', kind: 'password' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
      { path: ['gatewayUrl'], label: '网关地址', kind: 'text' },
      { path: ['intents'], label: 'Intents', kind: 'number', min: 0 },
      {
        path: ['groupPolicy'],
        label: '群聊策略',
        kind: 'select',
        options: [
          { label: '仅提及时响应', value: 'mention' },
          { label: '全部消息响应', value: 'open' },
        ],
      },
    ],
  },
  {
    name: 'qq',
    label: 'QQ',
    category: 'Social',
    description: 'QQ 机器人接入，支持 AppID、密钥和发送者白名单。',
    primaryFields: [
      { path: ['appId'], label: 'App ID', kind: 'text' },
      { path: ['secret'], label: '密钥', kind: 'password' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
    ],
  },
  {
    name: 'slack',
    label: 'Slack',
    category: 'Collaboration',
    description: 'Slack Socket 模式接入，支持线程回复、DM 策略和频道允许列表。',
    primaryFields: [
      { path: ['botToken'], label: 'Bot Token', kind: 'password' },
      { path: ['appToken'], label: 'App Token', kind: 'password' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
      { path: ['groupAllowFrom'], label: '允许频道', kind: 'list' },
      { path: ['replyInThread'], label: '在线程中回复', kind: 'switch' },
      {
        path: ['groupPolicy'],
        label: '频道策略',
        kind: 'select',
        options: [
          { label: '仅提及时响应', value: 'mention' },
          { label: '全部消息响应', value: 'open' },
          { label: '仅允许列表', value: 'allowlist' },
        ],
      },
    ],
  },
  {
    name: 'matrix',
    label: 'Matrix',
    category: 'Collaboration',
    description: 'Matrix / Element 接入，支持 Homeserver、E2EE 与房间策略。',
    primaryFields: [
      { path: ['homeserver'], label: 'Homeserver', kind: 'text' },
      { path: ['accessToken'], label: '访问令牌', kind: 'password' },
      { path: ['userId'], label: '用户 ID', kind: 'text' },
      { path: ['deviceId'], label: '设备 ID', kind: 'text' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
      { path: ['groupAllowFrom'], label: '允许房间', kind: 'list' },
      { path: ['e2eeEnabled'], label: '启用 E2EE', kind: 'switch' },
      {
        path: ['groupPolicy'],
        label: '群聊策略',
        kind: 'select',
        options: [
          { label: '全部消息响应', value: 'open' },
          { label: '仅提及时响应', value: 'mention' },
          { label: '仅允许列表', value: 'allowlist' },
        ],
      },
    ],
  },
  {
    name: 'feishu',
    label: '飞书 / Lark',
    category: 'Enterprise',
    description: '飞书应用接入，支持 open_id 白名单和表情反馈。',
    primaryFields: [
      { path: ['appId'], label: 'App ID', kind: 'text' },
      { path: ['appSecret'], label: 'App Secret', kind: 'password' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
      { path: ['reactEmoji'], label: '反馈表情', kind: 'text' },
      { path: ['verificationToken'], label: '校验 Token', kind: 'password' },
      { path: ['encryptKey'], label: '加密 Key', kind: 'password' },
    ],
  },
  {
    name: 'dingtalk',
    label: '钉钉',
    category: 'Enterprise',
    description: '钉钉 Stream 模式接入，支持企业凭证和员工白名单。',
    primaryFields: [
      { path: ['clientId'], label: 'Client ID', kind: 'text' },
      { path: ['clientSecret'], label: 'Client Secret', kind: 'password' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
    ],
  },
  {
    name: 'wecom',
    label: '企业微信',
    category: 'Enterprise',
    description: '企业微信 AI Bot 接入，支持欢迎语与用户白名单。',
    primaryFields: [
      { path: ['botId'], label: 'Bot ID', kind: 'text' },
      { path: ['secret'], label: '密钥', kind: 'password' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
      { path: ['welcomeMessage'], label: '欢迎语', kind: 'textarea' },
    ],
  },
  {
    name: 'mochat',
    label: 'Mochat',
    category: 'Enterprise',
    description: 'Mochat 运行时接入，支持 panel/session 绑定和延迟回复策略。',
    primaryFields: [
      { path: ['baseUrl'], label: '服务地址', kind: 'text' },
      { path: ['clawToken'], label: 'Claw Token', kind: 'password' },
      { path: ['agentUserId'], label: 'Agent 用户 ID', kind: 'text' },
      { path: ['sessions'], label: 'Sessions', kind: 'list' },
      { path: ['panels'], label: 'Panels', kind: 'list' },
      { path: ['allowFrom'], label: '允许用户', kind: 'list', placeholder: allowFromPlaceholder },
      {
        path: ['replyDelayMode'],
        label: '延迟回复模式',
        kind: 'select',
        options: [
          { label: '关闭', value: 'off' },
          { label: '仅非提及时延迟', value: 'non-mention' },
        ],
      },
      { path: ['replyDelayMs'], label: '延迟回复毫秒数', kind: 'number', min: 0, step: 1000 },
    ],
  },
  {
    name: 'email',
    label: '邮箱',
    category: 'Inbox',
    description: '通过 IMAP + SMTP 处理邮件收发，支持显式授权与自动回复。',
    primaryFields: [
      { path: ['consentGranted'], label: '已授予权限', kind: 'switch' },
      { path: ['imapHost'], label: 'IMAP Host', kind: 'text' },
      { path: ['imapPort'], label: 'IMAP Port', kind: 'number', min: 1 },
      { path: ['imapUsername'], label: 'IMAP 用户名', kind: 'text' },
      { path: ['imapPassword'], label: 'IMAP 密码', kind: 'password' },
      { path: ['smtpHost'], label: 'SMTP Host', kind: 'text' },
      { path: ['smtpPort'], label: 'SMTP Port', kind: 'number', min: 1 },
      { path: ['smtpUsername'], label: 'SMTP 用户名', kind: 'text' },
      { path: ['smtpPassword'], label: 'SMTP 密码', kind: 'password' },
      { path: ['fromAddress'], label: '发件地址', kind: 'text' },
      { path: ['allowFrom'], label: '允许发件人', kind: 'list', placeholder: allowFromPlaceholder },
      { path: ['autoReplyEnabled'], label: '启用自动回复', kind: 'switch' },
    ],
  },
]

export const channelCategoryOrder: ChannelMeta['category'][] = [
  'Social',
  'Collaboration',
  'Enterprise',
  'Inbox',
]

export function toLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
