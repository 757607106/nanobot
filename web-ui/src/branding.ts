export const PLATFORM_BRAND_NAME = '群策'
export const PLATFORM_ASSISTANT_NAME = '群策'
export const PLATFORM_BRAND_MARK = '群'
export const PLATFORM_BADGE_LABEL = 'MULTI AGENT'
export const PLATFORM_SUBTITLE = '多Agent协作平台'
export const PLATFORM_CONSOLE_LABEL = `${PLATFORM_BRAND_NAME}控制台`

export function replaceBrandText(value: string) {
  return value
    .replace(/nanobot Web Console/gi, PLATFORM_CONSOLE_LABEL)
    .replace(/nanobot Web UI/gi, PLATFORM_BRAND_NAME)
    .replace(/nanobot\s+技能加载器/gi, `${PLATFORM_BRAND_NAME}技能加载器`)
    .replace(/\bnanobot\b/gi, PLATFORM_BRAND_NAME)
}
