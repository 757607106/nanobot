import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Alert, Button, Input, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { motion, useReducedMotion } from 'framer-motion'
import { PLATFORM_BRAND_NAME } from '../branding'
import { testIds } from '../testIds'
import { AnimatedCats } from './AnimatedCats'
import './login.css'

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

const EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94]
const stagger = {
  container: {
    hidden: {},
    visible: { transition: { staggerChildren: 0.08, delayChildren: 0.3 } },
  },
  item: {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
  },
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const shouldReduceMotion = useReducedMotion()
  const { bootstrap, error, login, status, submitting } = useAuth()
  const initializing = !status?.initialized
  
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  
  const [isTyping, setIsTyping] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)

  const nextPath = useMemo(
    () => resolveNextPath(location.state as LoginLocationState | null | undefined),
    [location.state],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanUsername = username.trim()
    if (cleanUsername.length < 3) { setFormError('账号至少需要 3 个字符。'); return }
    if (password.length < 8) { setFormError('密码至少需要 8 个字符。'); return }
    if (initializing && password !== confirmPassword) { setFormError('两次输入的密码不一致。'); return }

    setFormError(null)
    if (initializing) {
      await bootstrap(cleanUsername, password)
    } else {
      await login(cleanUsername, password)
    }
    navigate(nextPath, { replace: true })
  }

  return (
    <div className="login-shell">
      <div className="login-stage">
        <div className="login-cats" aria-hidden="true">
          <AnimatedCats isTyping={isTyping} showPassword={passwordVisible} passwordLength={password.length} />
        </div>

        <motion.div
          className="login-card"
          variants={stagger.container}
          initial={shouldReduceMotion ? undefined : 'hidden'}
          animate="visible"
        >
          <motion.div className="login-brand" variants={stagger.item}>
            <Typography.Text strong className="login-brand-title">
              {PLATFORM_BRAND_NAME}
            </Typography.Text>
            {initializing ? (
              <Typography.Text type="secondary" className="login-brand-subtitle">
                请先设置初始管理员账号与密码
              </Typography.Text>
            ) : null}
          </motion.div>

          <form onSubmit={handleSubmit} className="login-form">
            <motion.div className="login-field" variants={stagger.item}>
              <label className="login-label">账号</label>
              <Input
                autoComplete="username"
                value={username}
                placeholder="admin"
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                data-testid={testIds.auth.username}
                className="login-input"
              />
            </motion.div>

            <motion.div className="login-field" variants={stagger.item}>
              <label className="login-label">{initializing ? '设置密码' : '密码'}</label>
              <Input.Password
                autoComplete={initializing ? 'new-password' : 'current-password'}
                value={password}
                placeholder="••••••••"
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                visibilityToggle={{ visible: passwordVisible, onVisibleChange: setPasswordVisible }}
                data-testid={testIds.auth.password}
                className="login-input"
              />
            </motion.div>

            {initializing ? (
              <motion.div
                className="login-field"
                initial={shouldReduceMotion ? undefined : { opacity: 0, y: 10 }}
                animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={shouldReduceMotion ? undefined : { duration: 0.32, ease: EASE }}
              >
                <label className="login-label">确认密码</label>
                <Input.Password
                  autoComplete="new-password"
                  value={confirmPassword}
                  placeholder="••••••••"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={() => setIsTyping(true)}
                  onBlur={() => setIsTyping(false)}
                  data-testid={testIds.auth.confirmPassword}
                  className="login-input"
                />
              </motion.div>
            ) : null}

            {formError || error ? (
              <motion.div variants={stagger.item}>
                <Alert type="error" message={formError || error} className="login-alert" />
              </motion.div>
            ) : null}

            <motion.div variants={stagger.item}>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                block
                data-testid={testIds.auth.submit}
                className="login-submit"
              >
                {initializing ? '开始初始化' : '登录系统'}
              </Button>
            </motion.div>
          </form>
        </motion.div>
      </div>
    </div>
  )
}
