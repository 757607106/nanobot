/**
 * Design Tokens
 *
 * 本文件包含用于 Tailwind 类和内联样式的通用设计常量。
 * 这些值与 index.css 中的 CSS 变量保持一致。
 *
 * 注意：这些常量用于非 Ant Design 组件的样式场景。
 * Ant Design 组件的样式应通过 theme.ts 中的 Token 配置管理。
 */

// ==================== 间距梯度 ====================
// 对应 CSS 变量: --nb-spacing-xs, --nb-spacing-sm 等
// 统一 8px 网格: 8 / 12 / 16 / 24 / 32 / 48
export const SPACING = {
  /** 8px - 极小间距 (对应 --nb-spacing-xs) */
  xs: 8,
  /** 12px - 小间距 (对应 --nb-spacing-sm) */
  sm: 12,
  /** 16px - 中间距 (对应 --nb-spacing-md) */
  md: 16,
  /** 24px - 大间距 (对应 --nb-spacing-lg) */
  lg: 24,
  /** 32px - 极大间距 (对应 --nb-spacing-xl) */
  xl: 32,
  /** 48px - 超大间距 (对应 --nb-spacing-2xl) */
  xxl: 48,
} as const

// ==================== 圆角梯度 ====================
// 对应 CSS 变量: --nb-radius-card, --nb-radius-button 等
export const BORDER_RADIUS = {
  /** 6px - 极小圆角 */
  xs: 6,
  /** 10px - 小圆角 */
  sm: 10,
  /** 12px - 按钮/输入框圆角 (对应 --nb-radius-button, --nb-radius-input) */
  md: 12,
  /** 16px - 卡片圆角 (对应 --nb-radius-card) */
  lg: 16,
  /** 20px - 大圆角 (对应 --nb-radius-xl) */
  xl: 20,
  /** 24px - 模态框圆角 (对应 --nb-radius-modal) */
  '2xl': 24,
  /** 28px - 超大圆角 */
  '3xl': 28,
  /** 999px - 全圆角 (Tag/Pill 等) */
  full: 999,
  /** 卡片圆角 (对应 --nb-radius-card) */
  card: 16,
  /** 按钮圆角 (对应 --nb-radius-button) */
  button: 12,
  /** 输入框圆角 (对应 --nb-radius-input) */
  input: 12,
  /** 模态框圆角 (对应 --nb-radius-modal) */
  modal: 24,
} as const

// ==================== 阴影层级 ====================
// 对应 CSS 变量: --nb-shadow, --nb-shadow-soft 等
export const SHADOWS = {
  /** 小阴影 - 用于按钮、小卡片等 */
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 3px 0 rgba(0, 0, 0, 0.06)',
  /** 中阴影 - 用于下拉菜单、浮层等 */
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.03)',
  /** 大阴影 - 用于模态框、抽屉等 */
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.03)',
  /** 品牌阴影 - 带主色调的柔和阴影 */
  brand: '0 4px 20px -2px rgba(99, 102, 241, 0.06)',
  /** 品牌强阴影 - 用于高强调元素 */
  brandStrong: '0 20px 40px -10px rgba(99, 102, 241, 0.08), 0 10px 20px -5px rgba(0, 0, 0, 0.04)',
} as const

// ==================== 过渡曲线 ====================
export const TRANSITIONS = {
  /** 快速过渡 - 用于按钮反馈等 */
  fast: '150ms ease',
  /** 标准过渡 - 用于一般状态变化 */
  normal: '200ms ease',
  /** 慢速过渡 - 用于复杂动画 */
  slow: '300ms ease',
  /** 弹性过渡 - 用于需要弹性的动画 */
  bounce: '300ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
} as const

// ==================== 布局常量 ====================
// 对应 CSS 变量: --nb-content-max-width, --nb-layout-gutter 等
export const LAYOUT = {
  /** 侧边栏宽度 - 288px */
  siderWidth: 288,
  /** 头部高度 - 56px */
  headerHeight: 56,
  /** 内容最大宽度 - 1600px */
  contentMaxWidth: 1600,
  /** 布局间距 - 24px (对应 --nb-layout-gutter) */
  gutterSize: 24,
  /** 移动端布局间距 - 16px (对应 --nb-layout-gutter-mobile) */
  gutterSizeMobile: 16,
  /** 面板内边距 - 24px (对应 --nb-panel-padding, --nb-card-padding) */
  panelPadding: 24,
  /** 移动端面板内边距 - 16px (对应 --nb-panel-padding-mobile, --nb-card-padding-mobile) */
  panelPaddingMobile: 16,
  /** 区块间距 - 24px (对应 --nb-section-gap) */
  sectionGap: 24,
  /** 卡片内边距 - 24px (对应 --nb-card-padding) */
  cardPadding: 24,
  /** 移动端卡片内边距 - 16px (对应 --nb-card-padding-mobile) */
  cardPaddingMobile: 16,
} as const

// ==================== 字体大小 ====================
// 对应 CSS 变量: --nb-text-sm, --nb-title-md 等
export const FONT_SIZE = {
  /** 11px - 极小文字 */
  '2xs': 11,
  /** 12px - 小文字 */
  xs: 12,
  /** 14px - 标准文字 */
  sm: 14,
  /** 15px - 中文字 */
  md: 15,
  /** 16px - 大文字 */
  lg: 16,
  /** 18px - 极小标题 */
  'title-xs': 18,
  /** 20px - 小标题 */
  'title-sm': 20,
  /** 24px - 中标题 */
  'title-md': 24,
  /** 28px - 大标题 */
  'title-lg': 28,
  /** 36px - 超大标题 */
  'title-xl': 36,
  /** 48px - 英雄标题 */
  'title-hero': 48,
} as const

// ==================== 字重 ====================
// 对应 CSS 变量: --nb-font-weight-regular 等
export const FONT_WEIGHT = {
  /** 400 - 常规 */
  regular: 400,
  /** 500 - 中等 */
  medium: 500,
  /** 600 - 加粗 */
  strong: 600,
  /** 700 - 标题 */
  title: 700,
} as const

// ==================== 行高 ====================
// 对应 CSS 变量: --nb-line-tight, --nb-line-body 等
export const LINE_HEIGHT = {
  /** 1.2 - 紧凑 */
  tight: 1.2,
  /** 1.5 - 标准 */
  body: 1.5,
  /** 1.6 - 宽松 */
  relaxed: 1.6,
} as const

// ==================== 组件尺寸 ====================
// 对应 CSS 变量: --nb-control-height, --nb-control-height-sm 等
export const COMPONENT_SIZE = {
  /** 32px - 小尺寸 */
  sm: 32,
  /** 40px - 标准尺寸 */
  md: 40,
  /** 48px - 大尺寸 */
  lg: 48,
} as const

// ==================== Z-Index 层级 ====================
export const Z_INDEX = {
  /** 基础层级 */
  base: 0,
  /** 浮动元素 */
  float: 10,
  /** 下拉菜单 */
  dropdown: 100,
  /** 固定头部 */
  sticky: 200,
  /** 模态框遮罩 */
  modal: 1000,
  /** 通知 */
  notification: 1100,
  /** 消息提示 */
  message: 1200,
} as const
