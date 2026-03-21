export const PLATFORM_BRAND_NAME = 'Nanobot'
export const PLATFORM_ASSISTANT_NAME = 'Nanobot'
export const PLATFORM_BRAND_MARK = 'N'
export const PLATFORM_BADGE_LABEL = 'SELF-HOSTED CONSOLE'
export const PLATFORM_SUBTITLE = '多智能体管理面板'
export const PLATFORM_CONSOLE_LABEL = `${PLATFORM_BRAND_NAME} 控制台`
export const PLATFORM_BRAND_LOGO_SRC = '/nanobot-logo.png'
export const PLATFORM_BRAND_ICON_SRC = '/nanobot-icon.png'

export function replaceBrandText(value: string) {
  return value
    .replace(/FlexiTeam/gi, PLATFORM_BRAND_NAME)
    .replace(/群策/g, PLATFORM_BRAND_NAME)
    .replace(/nanobot Web Console/gi, PLATFORM_CONSOLE_LABEL)
    .replace(/nanobot Web UI/gi, PLATFORM_BRAND_NAME)
    .replace(/nanobot\s+技能加载器/gi, `${PLATFORM_BRAND_NAME}技能加载器`)
    .replace(/\bnanobot\b/gi, PLATFORM_BRAND_NAME)
}
