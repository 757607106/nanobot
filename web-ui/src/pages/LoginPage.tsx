import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Alert, Button, Input, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { AnimatePresence, motion } from 'framer-motion'
import { PLATFORM_BRAND_ICON_SRC, PLATFORM_BRAND_NAME } from '../branding'
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

/* ───── Animated Soft Orb ───── */
function GlowOrb({ color, size, position, delay }: {
  color: string
  size: number
  position: { top?: string; bottom?: string; left?: string; right?: string }
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity: [0.5, 0.8, 0.5],
        scale: [1, 1.15, 1],
        x: [0, 20, -15, 0],
        y: [0, -25, 15, 0],
      }}
      transition={{
        duration: 14,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      style={{
        position: 'absolute',
        ...position,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        filter: 'blur(80px)',
        pointerEvents: 'none',
      }}
    />
  )
}

/* ───── Stagger ───── */
const EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94]

const stagger = {
  container: {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.08, delayChildren: 0.3 },
    },
  },
  item: {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, ease: EASE },
    },
  },
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
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
    if (cleanUsername.length < 3) { setFormError('管理员名称至少需要 3 个字符。'); return }
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

  const inputStyle = {
    borderRadius: 10,
    height: 46,
    background: 'rgba(255, 255, 255, 0.7)',
    border: '1px solid rgba(0, 0, 0, 0.06)',
    fontSize: 14,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
  }

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        overflow: 'hidden',
        background: 'linear-gradient(160deg, #EDF2FA 0%, #F0F4FB 30%, #F5F7FA 60%, #EEF1F8 100%)',
      }}
    >
      {/* ───── Background: Soft Grid ───── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px',
          maskImage: 'radial-gradient(ellipse 70% 50% at 50% 45%, black 20%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 50% at 50% 45%, black 20%, transparent 100%)',
        }}
      />

      {/* ───── Background: Luminous Orbs ───── */}
      <GlowOrb color="rgba(59, 130, 246, 0.2)" size={700} position={{ top: '-20%', left: '-10%' }} delay={0} />
      <GlowOrb color="rgba(16, 185, 129, 0.15)" size={500} position={{ bottom: '-15%', right: '-5%' }} delay={3} />
      <GlowOrb color="rgba(139, 92, 246, 0.12)" size={450} position={{ top: '40%', right: '10%' }} delay={6} />

      {/* ───── Login Card ───── */}
      <motion.div
        variants={stagger.container}
        initial="hidden"
        animate="visible"
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: 400,
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          style={{
            padding: '44px 36px',
            borderRadius: 20,
            background: 'rgba(255, 255, 255, 0.72)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.8)',
            boxShadow: `
              0 0 0 1px rgba(0,0,0,0.03),
              0 1px 2px rgba(0,0,0,0.04),
              0 8px 24px -4px rgba(0,0,0,0.06),
              0 24px 48px -8px rgba(59, 130, 246, 0.06)
            `,
          }}
        >
          {/* ── Brand Lockup ── */}
          <motion.div variants={stagger.item} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 36, textAlign: 'center' }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 20,
                background: 'linear-gradient(145deg, rgba(255,255,255,0.95), rgba(240,245,255,0.9))',
                border: '1px solid rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
                boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px rgba(255,255,255,0.8) inset',
              }}
            >
              <img src={PLATFORM_BRAND_ICON_SRC} alt={PLATFORM_BRAND_NAME} style={{ width: 52, height: 52, objectFit: 'contain' }} />
            </div>
            <Typography.Text strong style={{ color: '#0F172A', fontSize: 20, fontFamily: 'var(--nb-font-display)', letterSpacing: '-0.02em', display: 'block', lineHeight: 1 }}>
              {PLATFORM_BRAND_NAME}
            </Typography.Text>
          </motion.div>

          {/* ── Heading ── */}
          <motion.div variants={stagger.item} style={{ marginBottom: 28 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--nb-font-display)',
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                color: '#0F172A',
              }}
            >
              {initializing ? '初始化系统' : '欢迎回来'}
            </h1>
          </motion.div>

          <form onSubmit={handleSubmit}>
            {/* ── Username ── */}
            <motion.div variants={stagger.item} style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#475569', fontSize: 13, fontWeight: 500 }}>
                账号
              </label>
              <Input
                autoComplete="username"
                value={username}
                placeholder="admin"
                onChange={(e) => setUsername(e.target.value)}
                data-testid={testIds.auth.username}
                style={inputStyle}
              />
            </motion.div>

            {/* ── Password ── */}
            <motion.div variants={stagger.item} style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#475569', fontSize: 13, fontWeight: 500 }}>
                {initializing ? '设置密码' : '密码'}
              </label>
              <Input.Password
                autoComplete={initializing ? 'new-password' : 'current-password'}
                value={password}
                placeholder="••••••••"
                onChange={(e) => setPassword(e.target.value)}
                data-testid={testIds.auth.password}
                style={inputStyle}
              />
            </motion.div>

            {/* ── Confirm Password ── */}
            <AnimatePresence>
              {initializing ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  style={{ overflow: 'hidden', marginBottom: 16 }}
                >
                  <label style={{ display: 'block', marginBottom: 6, color: '#475569', fontSize: 13, fontWeight: 500 }}>
                    确认密码
                  </label>
                  <Input.Password
                    autoComplete="new-password"
                    value={confirmPassword}
                    placeholder="••••••••"
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    data-testid={testIds.auth.confirmPassword}
                    style={inputStyle}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* ── Error ── */}
            {formError || error ? (
              <motion.div variants={stagger.item} style={{ marginBottom: 12 }}>
                <Alert
                  type="error"
                  showIcon
                  message={formError || error}
                  style={{
                    borderRadius: 10,
                    border: '1px solid rgba(239, 68, 68, 0.15)',
                    background: 'rgba(254, 242, 242, 0.8)',
                  }}
                />
              </motion.div>
            ) : null}

            {/* ── Submit ── */}
            <motion.div variants={stagger.item} style={{ marginTop: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                block
                style={{
                  height: 46,
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: 'var(--nb-font-display)',
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                  boxShadow: '0 4px 14px -2px rgba(37, 99, 235, 0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
                data-testid={testIds.auth.submit}
              >
                {initializing ? '初始化' : '登录'}
              </Button>
            </motion.div>
          </form>


        </motion.div>

        {/* ── Subtle glow beneath card ── */}
        <div
          style={{
            position: 'absolute',
            bottom: -30,
            left: '15%',
            right: '15%',
            height: 60,
            background: 'radial-gradient(ellipse, rgba(59, 130, 246, 0.08) 0%, transparent 70%)',
            filter: 'blur(16px)',
            pointerEvents: 'none',
          }}
        />
      </motion.div>
    </div>
  )
}
