import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Alert, Button, Input, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { AnimatePresence, motion } from 'framer-motion'
import { PLATFORM_BRAND_NAME } from '../branding'
import { testIds } from '../testIds'
import { AnimatedCats } from './AnimatedCats'

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

/* ───── Animated Soft Orb (Original) ───── */
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
  const { bootstrap, error, login, status, submitting } = useAuth()
  const initializing = !status?.initialized
  
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  
  // Animation States
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

  // Modern pill input style
  const inputStyle = {
    borderRadius: 9999,
    height: 48,
    background: 'rgba(255, 255, 255, 0.85)',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    fontSize: 'var(--nb-text-sm)',
    paddingLeft: 20,
    paddingRight: 20,
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)',
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
      {/* ───── Background: Soft Grid (Original) ───── */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: `linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
          maskImage: 'radial-gradient(ellipse 70% 50% at 50% 45%, black 20%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 50% at 50% 45%, black 20%, transparent 100%)',
        }}
      />
      {/* ───── Background: Luminous Orbs (Original) ───── */}
      <GlowOrb color="rgba(59, 130, 246, 0.2)" size={700} position={{ top: '-20%', left: '-10%' }} delay={0} />
      <GlowOrb color="rgba(16, 185, 129, 0.15)" size={500} position={{ bottom: '-15%', right: '-5%' }} delay={3} />
      <GlowOrb color="rgba(139, 92, 246, 0.12)" size={450} position={{ top: '40%', right: '10%' }} delay={6} />

      {/* ───── Center Form Container ───── */}
      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 400 }}>
        
        {/* Animated Cats Peeking From Behind Card */}
        <div style={{ position: 'absolute', top: -120, left: 0, width: '100%', zIndex: 0 }}>
           <AnimatedCats 
             isTyping={isTyping} 
             showPassword={passwordVisible} 
             passwordLength={password.length} 
           />
        </div>

        {/* ───── Login Card ───── */}
        <motion.div
          variants={stagger.container}
          initial="hidden"
          animate="visible"
          style={{
            position: 'relative',
            zIndex: 10,
            padding: '44px 36px',
            borderRadius: 24,
            background: 'rgba(255, 255, 255, 0.72)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.9)',
            boxShadow: `
              0 0 0 1px rgba(0,0,0,0.03),
              0 1px 2px rgba(0,0,0,0.04),
              0 12px 32px -4px rgba(0,0,0,0.08),
              0 24px 64px -8px rgba(59, 130, 246, 0.08)
            `,
          }}
        >
          {/* ── Brand Lockup (Text Only) ── */}
          <motion.div variants={stagger.item} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32, textAlign: 'center' }}>
            <Typography.Text strong style={{ 
                color: '#0F172A', 
                fontSize: 28,
                fontFamily: 'var(--nb-font-display)', 
                letterSpacing: '-0.03em', 
                display: 'block', 
                lineHeight: 1 
            }}>
              {PLATFORM_BRAND_NAME}
            </Typography.Text>
            {initializing && (
               <Typography.Text type="secondary" style={{ marginTop: 12, fontSize: 14 }}>
                 请先设置初始管理员账号与密码
               </Typography.Text>
            )}
          </motion.div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* ── Username ── */}
            <motion.div variants={stagger.item}>
              <label style={{ display: 'block', marginBottom: 8, color: '#475569', fontSize: 14, fontWeight: 500 }}>
                账号
              </label>
              <Input
                autoComplete="username"
                value={username}
                placeholder="admin"
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                data-testid={testIds.auth.username}
                style={inputStyle}
              />
            </motion.div>

            {/* ── Password ── */}
            <motion.div variants={stagger.item}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ color: '#475569', fontSize: 14, fontWeight: 500 }}>
                  {initializing ? '设置密码' : '密码'}
                </label>
                {!initializing && <a href="#" style={{ fontSize: 13, color: '#2563EB', fontWeight: 500, textDecoration: 'none' }}>忘记密码?</a>}
              </div>
              
              <Input.Password
                autoComplete={initializing ? 'new-password' : 'current-password'}
                value={password}
                placeholder="••••••••"
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                visibilityToggle={{ visible: passwordVisible, onVisibleChange: setPasswordVisible }}
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
                  style={{ overflow: 'hidden' }}
                >
                  <label style={{ display: 'block', marginBottom: 8, color: '#475569', fontSize: 14, fontWeight: 500 }}>
                    确认密码
                  </label>
                  <Input.Password
                    autoComplete="new-password"
                    value={confirmPassword}
                    placeholder="••••••••"
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
                    data-testid={testIds.auth.confirmPassword}
                    style={inputStyle}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* ── Error ── */}
            {formError || error ? (
              <motion.div variants={stagger.item}>
                <Alert
                  type="error"
                  message={formError || error}
                  style={{ borderRadius: 12, border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(254, 242, 242, 0.9)' }}
                />
              </motion.div>
            ) : null}

            {/* ── Submit ── */}
            <motion.div variants={stagger.item} style={{ marginTop: 4 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                block
                style={{
                  height: 48,
                  borderRadius: 9999,
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: 'var(--nb-font-display)',
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                  boxShadow: '0 4px 14px -2px rgba(37, 99, 235, 0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
                data-testid={testIds.auth.submit}
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
