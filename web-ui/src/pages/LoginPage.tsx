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
              </div>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-field">
                <span>账号</span>
                <Input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  data-testid={testIds.auth.username}
                />
              </label>

              <label className="auth-field">
                <span>{initializing ? '设置密码' : '密码'}</span>
                <Input.Password
                  autoComplete={initializing ? 'new-password' : 'current-password'}
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
          </Card>
        </MotionPanel>
      </div>
    </div>
  )
}
