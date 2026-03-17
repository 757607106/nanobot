import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Alert, Button, Card, Divider, Input, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PLATFORM_BADGE_LABEL, PLATFORM_BRAND_NAME, PLATFORM_SUBTITLE } from '../branding'
import { MotionGroup, MotionPanel } from '../components/MotionSurface'
import { testIds } from '../testIds'
import { useThemeMode } from '../themeMode'

interface LoginLocationState {
  from?: {
    pathname?: string
  }
}

const authMetrics = [
  { value: '01', label: '统一入口', detail: '聊天、团队、知识与系统配置共用一套访问控制。' },
  { value: '24h', label: '会话保护', detail: '退出或实例重启后重新认证，减少旧会话残留。' },
  { value: '3步', label: '快速进入', detail: '首次创建管理员后即可继续初始化和进入工作台。' },
]

const authFeatures = [
  { label: '协作工作台', detail: '把 AI 员工、团队编排、运行记录与知识库放到一个操作面里。' },
  { label: '配置中枢', detail: '模型、技能、渠道和系统偏好保持统一的控制台节奏。' },
  { label: '安全登录', detail: '受保护页面与接口在未登录状态下保持锁定。' },
]

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

  const statusLabel = initializing ? '首次初始化' : '安全登录'
  const title = initializing ? '创建 FlexiTeam 管理员' : `登录 ${PLATFORM_BRAND_NAME}`
  const description = initializing
    ? '先创建当前实例的管理员账号，再进入后续的初始化步骤和协作工作台。'
    : '登录后即可继续使用聊天、员工协作、配置和系统页面。'

  return (
    <div className={`auth-screen theme-${resolvedTheme}`}>
      <MotionGroup className="auth-shell">
        <MotionPanel hover={false}>
          <section className="auth-showcase">
            <div className="auth-badge-row">
              <div className="auth-badge">{PLATFORM_BADGE_LABEL}</div>
              <div className="auth-badge auth-badge-soft">Secure Console</div>
            </div>
            <div className="auth-showcase-copy">
              <Typography.Title level={1}>{PLATFORM_BRAND_NAME}</Typography.Title>
              <Typography.Paragraph>
                {PLATFORM_SUBTITLE}。把 AI 员工协作、会话处理、知识管理和系统配置收拢到同一个入口。
              </Typography.Paragraph>
            </div>

            <div className="auth-metric-grid">
              {authMetrics.map((item) => (
                <div className="auth-metric-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <p>{item.detail}</p>
                </div>
              ))}
            </div>

            <MotionGroup className="auth-feature-grid">
              {authFeatures.map((item) => (
                <MotionPanel className="auth-feature-motion" hover={false} key={item.label}>
                  <div className="auth-feature-card">
                    <span>{item.label}</span>
                    <strong>{item.detail}</strong>
                  </div>
                </MotionPanel>
              ))}
            </MotionGroup>
          </section>
        </MotionPanel>

        <MotionPanel hover={false}>
          <Card className="auth-card" variant="borderless">
            <div className="auth-card-head">
              <span className="auth-kicker">{statusLabel}</span>
              <Typography.Title level={3}>{title}</Typography.Title>
              <Typography.Paragraph>{description}</Typography.Paragraph>
            </div>

            <div className="auth-inline-note">
              <strong>{initializing ? '首次进入当前实例' : '继续当前工作区'}</strong>
              <span>{initializing ? '创建管理员后，将继续完成初始化并进入控制台。' : '认证完成后，会回到你刚才准备打开的页面。'}</span>
            </div>

            <Divider className="auth-divider" />

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

            <div className="auth-helper-grid">
              <div className="auth-helper-card">
                <strong>{initializing ? '先创建管理员' : '受保护访问'}</strong>
                <span>{initializing ? '当前实例还没有管理员账号。' : '未登录状态下不会放行系统页和配置接口。'}</span>
              </div>
              <div className="auth-helper-card">
                <strong>{initializing ? '继续初始化' : '返回原页面'}</strong>
                <span>{initializing ? '完成后会直接继续初始化步骤。' : '登录后会优先返回你之前准备访问的页面。'}</span>
              </div>
            </div>
          </Card>
        </MotionPanel>
      </MotionGroup>
    </div>
  )
}
