import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

type AnimatedLogoProps = {
  size?: number
  isTyping?: boolean
}

const HEAD_GRADIENT = 'linear-gradient(135deg, var(--ant-color-bg-container) 0%, var(--ant-color-fill-quaternary) 40%, var(--ant-color-border) 100%)'
const VISOR_GRADIENT = 'linear-gradient(145deg, var(--ant-color-text), color-mix(in srgb, var(--ant-color-text) 82%, var(--ant-color-bg-layout)))'
const EAR_GRADIENT = 'linear-gradient(180deg, var(--ant-color-border-secondary), var(--ant-color-text-tertiary))'
const SPRING = { type: 'spring', stiffness: 180, damping: 18, mass: 0.6 } as const

export function AnimatedLogo({ size = 72, isTyping = false }: AnimatedLogoProps) {
  const shouldReduceMotion = useReducedMotion()
  const logoRef = useRef<HTMLDivElement>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [isBlinking, setIsBlinking] = useState(false)

  useEffect(() => {
    if (shouldReduceMotion) {
      return undefined
    }

    const handleMouseMove = (event: MouseEvent) => {
      setMouse({ x: event.clientX, y: event.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [shouldReduceMotion])

  useEffect(() => {
    if (shouldReduceMotion) {
      return undefined
    }

    let blinkTimeoutId: number | undefined
    let resetTimeoutId: number | undefined

    const scheduleBlink = () => {
      blinkTimeoutId = window.setTimeout(() => {
        setIsBlinking(true)
        resetTimeoutId = window.setTimeout(() => {
          setIsBlinking(false)
          scheduleBlink()
        }, 180)
      }, Math.random() * 3200 + 2200)
    }

    scheduleBlink()

    return () => {
      if (blinkTimeoutId) {
        window.clearTimeout(blinkTimeoutId)
      }
      if (resetTimeoutId) {
        window.clearTimeout(resetTimeoutId)
      }
    }
  }, [shouldReduceMotion])

  const base = size
  const look = (() => {
    if (!logoRef.current || shouldReduceMotion) {
      return { eyeX: 0, eyeY: 0, headX: 0, headY: 0, tilt: 0 }
    }

    const rect = logoRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const deltaX = mouse.x - centerX
    const deltaY = mouse.y - centerY

    return {
      eyeX: Math.max(-base * 0.08, Math.min(base * 0.08, deltaX / 18)),
      eyeY: Math.max(-base * 0.04, Math.min(base * 0.04, deltaY / 22)),
      headX: Math.max(-base * 0.05, Math.min(base * 0.05, deltaX / 42)),
      headY: Math.max(-base * 0.025, Math.min(base * 0.025, deltaY / 55)),
      tilt: Math.max(-6, Math.min(6, deltaX / 65)),
    }
  })()

  const eyeColor = isTyping ? 'var(--ant-color-primary-hover)' : 'var(--ant-color-primary)'
  const eyeWidth = isBlinking ? base * 0.17 : base * 0.13
  const eyeHeight = isBlinking ? Math.max(2, base * 0.025) : Math.max(3, base * 0.105)
  const helmetStyle = {
    position: 'absolute',
    inset: 0,
    background: HEAD_GRADIENT,
    borderRadius: `${base * 0.34}px ${base * 0.34}px ${base * 0.24}px ${base * 0.24}px`,
    boxShadow: 'inset -8px -8px 20px rgba(0,0,0,0.08), inset 8px 8px 20px rgba(255,255,255,0.8), 0 10px 25px rgba(0,0,0,0.1)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  } satisfies React.CSSProperties

  return (
    <div
      ref={logoRef}
      aria-hidden="true"
      style={{
        position: 'relative',
        width: size,
        height: size,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <motion.div
        initial={false}
        animate={shouldReduceMotion ? undefined : {
          x: look.headX,
          y: isTyping ? look.headY - base * 0.02 : look.headY,
          rotateZ: isTyping ? look.tilt * 0.55 : look.tilt,
          scale: isTyping ? 1.02 : 1,
        }}
        transition={SPRING}
        style={{
          position: 'absolute',
          left: base * 0.02,
          top: base * 0.11,
          width: base * 0.96,
          height: base * 0.78,
        }}
      >
        {[-1, 1].map((side) => (
          <motion.div
            key={side}
            initial={false}
            animate={shouldReduceMotion ? undefined : { rotateZ: side * (isTyping ? -8 : 0) }}
            transition={SPRING}
            style={{
              position: 'absolute',
              top: base * 0.17,
              left: side === -1 ? -base * 0.08 : 'auto',
              right: side === 1 ? -base * 0.08 : 'auto',
              width: base * 0.11,
              height: base * 0.27,
              background: EAR_GRADIENT,
              borderRadius: base * 0.05,
              boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.2), 0 4px 6px rgba(0,0,0,0.1)',
              zIndex: -1,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -base * 0.06,
                left: base * 0.018,
                width: base * 0.06,
                height: base * 0.06,
                borderRadius: '50%',
                background: eyeColor,
                boxShadow: `0 0 ${base * 0.08}px ${eyeColor}`,
              }}
            />
          </motion.div>
        ))}

        <div style={helmetStyle}>
          <div
            style={{
              position: 'relative',
              width: base * 0.74,
              height: base * 0.43,
              background: VISOR_GRADIENT,
              borderRadius: base * 0.16,
              boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.15), inset 0 -4px 10px rgba(0,0,0,0.8), 0 4px 8px rgba(0,0,0,0.1)',
              overflow: 'hidden',
              border: `${Math.max(1, base * 0.02)}px solid var(--ant-color-border)`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 2,
                left: 4,
                right: 4,
                height: base * 0.12,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 100%)',
                borderRadius: `${base * 0.12}px ${base * 0.12}px 50% 50%`,
                zIndex: 2,
              }}
            />

            <motion.div
              initial={false}
              animate={shouldReduceMotion ? undefined : { x: look.eyeX, y: look.eyeY }}
              transition={SPRING}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: base * 0.12,
              }}
            >
              {[0, 1].map((eyeIndex) => (
                <motion.div
                  key={eyeIndex}
                  initial={false}
                  animate={shouldReduceMotion ? undefined : {
                    width: eyeWidth,
                    height: eyeHeight,
                    backgroundColor: eyeColor,
                    boxShadow: `0 0 ${base * 0.08}px ${eyeColor}, 0 0 ${base * 0.16}px ${eyeColor}`,
                  }}
                  transition={{ duration: 0.18 }}
                  style={{
                    width: eyeWidth,
                    height: eyeHeight,
                    borderRadius: base * 0.07,
                    backgroundColor: eyeColor,
                    boxShadow: `0 0 ${base * 0.08}px ${eyeColor}`,
                  }}
                />
              ))}
            </motion.div>
          </div>

          <div
            style={{
              position: 'absolute',
              bottom: base * 0.08,
              display: 'flex',
              gap: base * 0.025,
            }}
          >
            {[0, 1, 2].map((dot) => (
              <div
                key={dot}
                style={{
                  width: Math.max(2, base * 0.03),
                  height: Math.max(2, base * 0.03),
                  borderRadius: Math.max(1, base * 0.015),
                  background: 'var(--ant-color-text-tertiary)',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
                }}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
