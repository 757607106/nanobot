export const PLATFORM_BRAND_NAME = 'NanoCrew'
export const PLATFORM_ASSISTANT_NAME = 'NanoCrew'
export const PLATFORM_BRAND_MARK = 'N'
export const PLATFORM_BADGE_LABEL = 'SELF-HOSTED CONSOLE'
export const PLATFORM_SUBTITLE = 'Console'
export const PLATFORM_CONSOLE_LABEL = `${PLATFORM_BRAND_NAME} 控制台`
export const PLATFORM_BRAND_LOGO_SRC = '/unnamed.png'
export const PLATFORM_BRAND_ICON_SRC = '/unnamed.png'

export function replaceBrandText(value: string) {
  return value
    .replace(/FlexiBot/gi, PLATFORM_BRAND_NAME)
    .replace(/群策/g, PLATFORM_BRAND_NAME)
    .replace(/nanobot Web Console/gi, PLATFORM_CONSOLE_LABEL)
    .replace(/nanobot Web UI/gi, PLATFORM_BRAND_NAME)
    .replace(/nanobot\s+技能加载器/gi, `${PLATFORM_BRAND_NAME}技能加载器`)
    .replace(/\bnanobot\b/gi, PLATFORM_BRAND_NAME)
}
