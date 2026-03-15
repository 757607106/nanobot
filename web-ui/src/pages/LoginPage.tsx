import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Alert, Button, Card, Divider, Input, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PLATFORM_BADGE_LABEL, PLATFORM_BRAND_NAME, PLATFORM_SUBTITLE } from '../branding'
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
    return '/chat'
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

  const statusLabel = initializing ? '首次初始化' : '管理员登录'
  const title = initializing ? '初始化工作台管理员' : '登录到工作台'
  const description = initializing
    ? '先创建当前实例的管理员账号，再进入后续的配置向导与工作台。'
    : '登录后才会解锁聊天、配置、技能和系统页面。重启实例后需要重新登录。'

  return (
    <div className={`auth-screen theme-${resolvedTheme}`}>
      <div className="auth-shell">
        <section className="auth-showcase">
          <div className="auth-badge">{PLATFORM_BADGE_LABEL}</div>
          <div className="auth-showcase-copy">
            <Typography.Title level={1}>{PLATFORM_BRAND_NAME}</Typography.Title>
            <Typography.Paragraph>
              {PLATFORM_SUBTITLE}，把多Agent协作、会话、调度、技能、配置和系统运行状态收进统一入口。
            </Typography.Paragraph>
          </div>

          <div className="auth-feature-grid">
            <div className="auth-feature-card">
              <span>访问控制</span>
              <strong>未登录时阻断受保护页面与 API</strong>
            </div>
            <div className="auth-feature-card">
              <span>实例隔离</span>
              <strong>管理员账号跟随当前配置实例，不和工作区路径混绑</strong>
            </div>
            <div className="auth-feature-card">
              <span>会话策略</span>
              <strong>退出或重启后重新登录，避免旧会话长期悬挂</strong>
            </div>
          </div>
        </section>

        <Card className="auth-card" variant="borderless">
          <div className="auth-card-head">
            <span className="auth-kicker">{statusLabel}</span>
            <Typography.Title level={3}>{title}</Typography.Title>
            <Typography.Paragraph>{description}</Typography.Paragraph>
          </div>

          <Divider className="auth-divider" />

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              <span>管理员名称</span>
              <Input
                autoComplete="username"
                placeholder="例如 owner 或 admin"
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
        </Card>
      </div>
    </div>
  )
}
