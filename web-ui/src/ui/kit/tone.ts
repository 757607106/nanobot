export type SemanticTone = 'primary' | 'info' | 'success' | 'warning' | 'error' | 'neutral'

type TokenLike = {
  colorPrimary: string
  colorPrimaryBg: string
  colorPrimaryBorder: string
  colorInfo: string
  colorInfoBg: string
  colorInfoBorder: string
  colorSuccess: string
  colorSuccessBg: string
  colorSuccessBorder: string
  colorWarning: string
  colorWarningBg: string
  colorWarningBorder: string
  colorError: string
  colorErrorBg: string
  colorErrorBorder: string
  colorFillQuaternary: string
  colorBorderSecondary: string
  colorTextSecondary: string
}

export function resolveToneColor(token: TokenLike, tone: SemanticTone): string {
  switch (tone) {
    case 'success':
      return token.colorSuccess
    case 'warning':
      return token.colorWarning
    case 'error':
      return token.colorError
    case 'info':
      return token.colorInfo
    case 'neutral':
      return token.colorTextSecondary
    default:
      return token.colorPrimary
  }
}

export function resolveToneBg(token: TokenLike, tone: SemanticTone): string {
  switch (tone) {
    case 'success':
      return token.colorSuccessBg
    case 'warning':
      return token.colorWarningBg
    case 'error':
      return token.colorErrorBg
    case 'info':
      return token.colorInfoBg
    case 'neutral':
      return token.colorFillQuaternary
    default:
      return token.colorPrimaryBg
  }
}

export function resolveToneBorder(token: TokenLike, tone: SemanticTone): string {
  switch (tone) {
    case 'success':
      return token.colorSuccessBorder
    case 'warning':
      return token.colorWarningBorder
    case 'error':
      return token.colorErrorBorder
    case 'info':
      return token.colorInfoBorder
    case 'neutral':
      return token.colorBorderSecondary
    default:
      return token.colorPrimaryBorder
  }
}
