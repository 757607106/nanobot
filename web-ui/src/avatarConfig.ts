/**
 * 数字员工头像配置系统
 *
 * 双层机制：预设关键词自动匹配 + localStorage 自定义存储
 *
 * 头像风格混合使用 flat（扁平）和 chibi（Q版）两套风格。
 * 每个角色分配一个语义色系（用于卡片色带等）。
 */

export interface AvatarPreset {
  /** 预设唯一标识 */
  key: string
  /** 角色标签（中文） */
  label: string
  /** 头像文件路径（相对 /public） */
  src: string
  /** 匹配关键词列表 */
  keywords: string[]
  /** 主色（用于色带 / 标签底色） */
  color: string
  /** 渐变色（用于卡片色带背景） */
  gradient: string
}

const AVATAR_PRESETS: AvatarPreset[] = [
  {
    key: 'service-rep',
    label: '客服专员',
    src: '/avatars/chibi-service-rep.png',
    keywords: ['客服', '售后', '售前', '服务', 'service', 'support', 'customer'],
    color: '#FF6B6B',
    gradient: 'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)',
  },
  {
    key: 'ops-engineer',
    label: '运维工程师',
    src: '/avatars/chibi-ops-engineer.png',
    keywords: ['运维', '故障', '排查', '监控', 'ops', 'devops', 'sre', 'infra', '基础设施'],
    color: '#20C997',
    gradient: 'linear-gradient(135deg, #43E97B 0%, #38F9D7 100%)',
  },
  {
    key: 'sales-expert',
    label: '销售精英',
    src: '/avatars/chibi-sales-expert.png',
    keywords: ['销售', '商务', '报价', 'sales', 'business', '营销'],
    color: '#FFD93D',
    gradient: 'linear-gradient(135deg, #F6D365 0%, #FDA085 100%)',
  },
  {
    key: 'detective',
    label: '分析侦探',
    src: '/avatars/chibi-detective.png',
    keywords: ['分析', '排查', '线索', '筛选', 'detect', 'analyze', 'investigate'],
    color: '#845EF7',
    gradient: 'linear-gradient(135deg, #A18CD1 0%, #FBC2EB 100%)',
  },
  {
    key: 'consultant',
    label: '专家顾问',
    src: '/avatars/chibi-consultant.png',
    keywords: ['顾问', '咨询', '方案', '推荐', 'consult', 'advisor', '建议'],
    color: '#12B886',
    gradient: 'linear-gradient(135deg, #84FAB0 0%, #8FD3F4 100%)',
  },
  {
    key: 'inspector',
    label: '质检审核员',
    src: '/avatars/chibi-inspector.png',
    keywords: ['审核', '质检', '检查', 'review', 'inspect', 'audit', '合规'],
    color: '#339AF0',
    gradient: 'linear-gradient(135deg, #A1C4FD 0%, #C2E9FB 100%)',
  },
  {
    key: 'release-mgr',
    label: '发布专员',
    src: '/avatars/chibi-release-mgr.png',
    keywords: ['发布', '变更', '部署', 'release', 'deploy', 'cicd', '上线'],
    color: '#FF922B',
    gradient: 'linear-gradient(135deg, #FCCB90 0%, #D57EEB 100%)',
  },
  {
    key: 'researcher',
    label: '调研员',
    src: '/avatars/chibi-researcher.png',
    keywords: ['调研', '研究', '收集', 'research', 'survey', '信息'],
    color: '#51CF66',
    gradient: 'linear-gradient(135deg, #D4FC79 0%, #96E6A1 100%)',
  },
  {
    key: 'content-writer',
    label: '内容创作',
    src: '/avatars/flat-content-writer.png',
    keywords: ['内容', '写作', '文案', '编辑', 'content', 'writer', 'copywriting', '文章'],
    color: '#F06595',
    gradient: 'linear-gradient(135deg, #F093FB 0%, #F5576C 100%)',
  },
  {
    key: 'data-analyst',
    label: '数据分析师',
    src: '/avatars/flat-data-analyst.png',
    keywords: ['数据', '报表', '统计', 'data', 'analytics', 'bi', 'dashboard', '可视化'],
    color: '#4C6EF5',
    gradient: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)',
  },
  {
    key: 'hr-people',
    label: '人事助理',
    src: '/avatars/flat-hr-people.png',
    keywords: ['人事', '招聘', 'hr', '入职', '员工', '人力', '面试'],
    color: '#E64980',
    gradient: 'linear-gradient(135deg, #FF9A9E 0%, #FAD0C4 100%)',
  },
  {
    key: 'security',
    label: '安全专家',
    src: '/avatars/flat-security.png',
    keywords: ['安全', '防护', '漏洞', 'security', 'firewall', '防火墙', '威胁'],
    color: '#495057',
    gradient: 'linear-gradient(135deg, #4B6CB7 0%, #182848 100%)',
  },
  {
    key: 'tech-support',
    label: '技术支持',
    src: '/avatars/flat-tech-support.png',
    keywords: ['技术', '工程', '开发', 'tech', 'engineer', 'developer', '编程', '代码'],
    color: '#228BE6',
    gradient: 'linear-gradient(135deg, #89F7FE 0%, #66A6FF 100%)',
  },
]

/**
 * 根据 Agent 的 name / description / tags 自动匹配最佳预设头像
 */
export function matchAvatarPreset(
  name: string,
  description?: string,
  tags?: string[],
): AvatarPreset {
  const haystack = [name, description ?? '', ...(tags ?? [])].join(' ').toLowerCase()

  let bestMatch: AvatarPreset | null = null
  let bestScore = 0

  for (const preset of AVATAR_PRESETS) {
    let score = 0
    for (const kw of preset.keywords) {
      if (haystack.includes(kw.toLowerCase())) {
        score += 1
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestMatch = preset
    }
  }

  // 如果没有匹配到任何关键词，使用基于 hash 的伪随机选择
  if (!bestMatch) {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    bestMatch = AVATAR_PRESETS[Math.abs(hash) % AVATAR_PRESETS.length]
  }

  return bestMatch
}

// ─── localStorage 自定义头像 ───

const AVATAR_STORAGE_KEY = 'nanobot-agent-avatars'

interface AvatarOverrides {
  [agentId: string]: string // avatarPresetKey or custom URL
}

function loadOverrides(): AvatarOverrides {
  try {
    const raw = localStorage.getItem(AVATAR_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveOverrides(overrides: AvatarOverrides) {
  localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(overrides))
}

export function setAgentAvatarOverride(agentId: string, presetKey: string) {
  const overrides = loadOverrides()
  overrides[agentId] = presetKey
  saveOverrides(overrides)
}

export function clearAgentAvatarOverride(agentId: string) {
  const overrides = loadOverrides()
  delete overrides[agentId]
  saveOverrides(overrides)
}

/**
 * 获取 Agent 的头像预设。
 * 优先使用 localStorage 中的自定义选择，fallback 到关键词自动匹配。
 */
export function getAgentAvatar(
  agentId: string,
  name: string,
  description?: string,
  tags?: string[],
): AvatarPreset {
  const overrides = loadOverrides()
  const overrideKey = overrides[agentId]

  if (overrideKey) {
    const found = AVATAR_PRESETS.find((p) => p.key === overrideKey)
    if (found) return found
  }

  return matchAvatarPreset(name, description, tags)
}

export { AVATAR_PRESETS }
