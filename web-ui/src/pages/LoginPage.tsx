import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Alert, Button, Card, Input, Typography, theme } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PLATFORM_BRAND_ICON_SRC, PLATFORM_BRAND_NAME } from '../branding'
import { MotionPanel } from '../components/MotionSurface'
import { testIds } from '../testIds'

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
  const { token } = theme.useToken()
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
    <div
      className="min-h-screen flex items-center justify-center p-8 overflow-hidden relative"
      style={{
        background: `linear-gradient(180deg, ${token.colorBgLayout} 0%, ${token.colorBgContainer} 100%)`,
      }}
    >
      {/* 背景装饰 */}
      <div
        className="fixed pointer-events-none z-0"
        style={{
          inset: '-8% auto auto -6%',
          width: 420,
          height: 420,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${token.colorPrimary}20 0%, transparent 68%)`,
          filter: 'blur(12px)',
        }}
      />
      <div
        className="fixed pointer-events-none z-0"
        style={{
          inset: 'auto -10% 6% auto',
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${token.colorInfo}18 0%, transparent 64%)`,
          filter: 'blur(12px)',
        }}
      />

      <MotionPanel hover={false}>
        <Card
          className="relative z-10 w-full max-w-[480px] overflow-hidden"
          styles={{
            body: { padding: '48px 40px' },
          }}
          style={{
            borderRadius: 32,
            border: 'none',
            background: 'var(--nb-card-bg)',
            boxShadow: '0 32px 128px -16px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--nb-card-subtle-border)',
          }}
          variant="borderless"
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <div 
              style={{ 
                width: 140, 
                height: 140, 
                padding: 12,
                borderRadius: 28,
                background: 'var(--nb-card-subtle-bg)',
                border: '1px solid var(--nb-card-subtle-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                className="w-full h-full object-contain"
                src={PLATFORM_BRAND_ICON_SRC}
                alt={PLATFORM_BRAND_NAME}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Typography.Title
                level={1}
                style={{
                  margin: 0,
                  fontSize: 48,
                  letterSpacing: '-0.05em',
                  fontWeight: 900,
                  color: 'var(--nb-ink)',
                }}
              >
                {PLATFORM_BRAND_NAME}
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 16, opacity: 0.8 }}>
                {initializing ? '欢迎来到您的 AI 工作站。' : '请输入凭据以继续工作。'}
              </Typography.Text>
            </div>
          </div>

          <form className="flex flex-col gap-4 mt-5" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">账号</span>
              <Input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                data-testid={testIds.auth.username}
                size="large"
                style={{ borderRadius: 12 }}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">{initializing ? '设置密码' : '密码'}</span>
              <Input.Password
                autoComplete={initializing ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                data-testid={testIds.auth.password}
                size="large"
                style={{ borderRadius: 12 }}
              />
            </label>

            {initializing ? (
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">确认密码</span>
                <Input.Password
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  data-testid={testIds.auth.confirmPassword}
                  size="large"
                  style={{ borderRadius: 12 }}
                />
              </label>
            ) : null}

            {formError || error ? (
              <Alert
                type="error"
                showIcon
                message={formError || error}
                className="rounded-xl"
              />
            ) : null}

            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              block
              size="large"
              style={{
                borderRadius: 14,
                height: 52,
                fontSize: 16,
                fontWeight: 600,
                marginTop: 12,
                background: 'var(--nb-accent)',
                border: 'none',
                boxShadow: '0 12px 32px -8px color-mix(in srgb, var(--nb-accent) 45%, transparent)',
              }}
              data-testid={testIds.auth.submit}
            >
              {initializing ? '初始化并进入' : '即刻登录'}
            </Button>
          </form>
        </Card>
      </MotionPanel>
    </div>
  )
}
