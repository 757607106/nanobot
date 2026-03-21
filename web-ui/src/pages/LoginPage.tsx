import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Alert, Button, Card, Input, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PLATFORM_BRAND_ICON_SRC, PLATFORM_BRAND_NAME, PLATFORM_SUBTITLE } from '../branding'
import { MotionPanel } from '../components/MotionSurface'
import { testIds } from '../testIds'
import { useThemeMode } from '../themeMode'
interface LoginLocationState {
  from?: {
    pathname?: string
  }
}

function resolveNextPath(state: LoginLocationState | null | undefined) {
  const nextPath = state?.from?.pathname
  if (!nextPath || nextPath === '/login') {
    return '/dashboard'
  }
  return nextPath
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { resolvedTheme } = useThemeMode()
  const { bootstrap, error, login, status, submitting } = useAuth()
  const initializing = !status?.initialized
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const nextPath = useMemo(
    () => resolveNextPath(location.state as LoginLocationState | null | undefined),
    [location.state],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const cleanUsername = username.trim()
    if (cleanUsername.length < 3) {
      setFormError('管理员名称至少需要 3 个字符。')
      return
    }
    if (password.length < 8) {
      setFormError('密码至少需要 8 个字符。')
      return
    }
    if (initializing && password !== confirmPassword) {
      setFormError('两次输入的密码不一致。')
      return
    }

    setFormError(null)
    if (initializing) {
      await bootstrap(cleanUsername, password)
    } else {
      await login(cleanUsername, password)
    }
    navigate(nextPath, { replace: true })
  }

  const statusLabel = initializing ? '首次初始化' : '账号登录'
  const title = initializing ? `创建 ${PLATFORM_BRAND_NAME} 管理员` : `登录 ${PLATFORM_BRAND_NAME}`
  const description = initializing
    ? '当前实例还没有管理员账号。先完成创建，再继续初始化流程。'
    : '登录后即可回到仪表板、对话、协作和系统管理页面。'

  return (
    <div className={`auth-screen theme-${resolvedTheme}`}>
      <div className="auth-shell auth-shell-compact">
        <MotionPanel hover={false}>
          <Card className="auth-card auth-card-compact" variant="borderless">
            <div className="auth-brand-lockup">
              <div className="auth-brand-icon-shell">
                <img className="auth-brand-icon" src={PLATFORM_BRAND_ICON_SRC} alt={PLATFORM_BRAND_NAME} />
              </div>
              <div className="auth-card-head auth-card-head-centered">
                <Typography.Title level={2}>{PLATFORM_BRAND_NAME}</Typography.Title>
                <Typography.Text className="auth-brand-subtitle">{PLATFORM_SUBTITLE}</Typography.Text>
                <Typography.Paragraph>{statusLabel}</Typography.Paragraph>
              </div>
            </div>

            <div className="auth-inline-note">
              <strong>{title}</strong>
              <span>{description}</span>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-field">
                <span>管理员名称</span>
                <Input
                  autoComplete="username"
                  placeholder="例如 admin、owner 或 teamlead"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  data-testid={testIds.auth.username}
                />
              </label>

              <label className="auth-field">
                <span>{initializing ? '设置密码' : '登录密码'}</span>
                <Input.Password
                  autoComplete={initializing ? 'new-password' : 'current-password'}
                  placeholder="至少 8 个字符"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  data-testid={testIds.auth.password}
                />
              </label>

              {initializing ? (
                <label className="auth-field">
                  <span>确认密码</span>
                  <Input.Password
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    data-testid={testIds.auth.confirmPassword}
                  />
                </label>
              ) : null}

              {formError || error ? (
                <Alert
                  type="error"
                  showIcon
                  message={formError || error}
                  className="auth-alert"
                />
              ) : null}

              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                className="auth-submit-button"
                block
                data-testid={testIds.auth.submit}
              >
                {initializing ? '创建管理员并进入工作台' : '登录并继续'}
              </Button>
            </form>

            <div className="auth-helper-grid auth-helper-grid-compact">
              <div className="auth-helper-card">
                <strong>{initializing ? '首次启动实例' : '受保护访问'}</strong>
                <span>{initializing ? '创建管理员后会继续初始化向导。' : '登录后会优先返回你刚才准备访问的页面。'}</span>
              </div>
            </div>
          </Card>
        </MotionPanel>
      </div>
    </div>
  )
}
