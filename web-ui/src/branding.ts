export const PLATFORM_BRAND_NAME = 'FlexiTeam'
export const PLATFORM_ASSISTANT_NAME = 'FlexiTeam'
export const PLATFORM_BRAND_MARK = 'F'
export const PLATFORM_BADGE_LABEL = 'MULTI AGENT'
export const PLATFORM_SUBTITLE = 'AI 团队协作中枢'
export const PLATFORM_CONSOLE_LABEL = `${PLATFORM_BRAND_NAME} 控制台`

export function replaceBrandText(value: string) {
  return value
    .replace(/群策/g, PLATFORM_BRAND_NAME)
    .replace(/nanobot Web Console/gi, PLATFORM_CONSOLE_LABEL)
    .replace(/nanobot Web UI/gi, PLATFORM_BRAND_NAME)
    .replace(/nanobot\s+技能加载器/gi, `${PLATFORM_BRAND_NAME}技能加载器`)
    .replace(/\bnanobot\b/gi, PLATFORM_BRAND_NAME)
}
