import { useState, useEffect, useRef } from "react"
import { useThemeMode } from "../themeMode"

function Pupil({
  size = 8,
  maxDistance = 4,
  pupilColor = "#111",
  forceLookX,
  forceLookY,
  isTyping,
}: any) {
  const [mouseX, setMouseX] = useState<number>(0)
  const [mouseY, setMouseY] = useState<number>(0)
  const pupilRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX)
      setMouseY(e.clientY)
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  const calculatePupilPosition = () => {
    if (!pupilRef.current) return { x: 0, y: 0 }
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY }
    }

    const pupil = pupilRef.current.getBoundingClientRect()
    const pupilCenterX = pupil.left + pupil.width / 2
    const pupilCenterY = pupil.top + pupil.height / 2

    const deltaX = mouseX - pupilCenterX
    const deltaY = mouseY - pupilCenterY
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance)

    const angle = Math.atan2(deltaY, deltaX)
    const x = Math.cos(angle) * distance
    const y = Math.sin(angle) * distance

    return { x, y }
  }

  const pupilPosition = calculatePupilPosition()
  const currentSize = isTyping ? size * 1.4 : size

  return (
    <div
      ref={pupilRef}
      style={{
        borderRadius: "50%",
        width: currentSize,
        height: currentSize,
        backgroundColor: pupilColor,
        boxShadow: `0 0 8px ${pupilColor}40`, // Add a little tech glow
        transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
        transition: "width 0.3s ease, height 0.3s ease, transform 0.1s ease-out",
      }}
    />
  )
}

function EyeBall({
  size = 24,
  pupilSize = 10,
  maxDistance = 6,
  isBlinking = false,
  isTyping,
  isDark = false,
}: any) {
  return (
    <div
      style={{
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 150ms",
        width: size,
        height: isBlinking ? 2 : size,
        background: isDark ? "linear-gradient(135deg, #334155 0%, #0F172A 100%)" : "linear-gradient(135deg, #ffffff 0%, #E2E8F0 100%)",
        boxShadow: isDark ? "inset 0 4px 6px rgba(0,0,0,0.8), 0 2px 4px rgba(255,255,255,0.05)" : "inset 0 4px 6px rgba(0,0,0,0.1), 0 2px 4px rgba(255,255,255,0.8)",
        overflow: "hidden",
      }}
    >
      {!isBlinking && (
        <Pupil 
          size={pupilSize} 
          maxDistance={maxDistance} 
          pupilColor={isDark ? "#60A5FA" : "#2563EB"} // Brighter tech blue in dark mode
          isTyping={isTyping}
        />
      )}
    </div>
  )
}

export function AnimatedLogo({ size = 72, isTyping = false }: { size?: number, isTyping?: boolean }) {
  const [mouseX, setMouseX] = useState<number>(0)
  const [mouseY, setMouseY] = useState<number>(0)
  const [isBlinking, setIsBlinking] = useState(false)
  const logoRef = useRef<HTMLDivElement>(null)
  
  const { resolvedTheme } = useThemeMode()
  const isDark = resolvedTheme === 'dark'

  const themeColors = {
    bgGlass: isDark ? 'linear-gradient(145deg, #1E293B, #0F172A)' : 'linear-gradient(145deg, #ffffff, #F1F5F9)',
    borderGlass: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.8)',
    shadowGlass: isDark ? '0 8px 16px -4px rgba(0,0,0,0.5), inset 0 -4px 8px rgba(0,0,0,0.2)' : '0 8px 16px -4px rgba(15, 23, 42, 0.08), inset 0 -4px 8px rgba(0,0,0,0.02)',
    earOuter: isDark ? 'linear-gradient(145deg, #334155, #1E293B)' : 'linear-gradient(145deg, #ffffff, #E2E8F0)',
    earInner: isDark ? '#1E293B' : '#EFF6FF',
    noseOuter: isDark ? '#475569' : '#94A3B8',
    whiskers: isDark ? '#64748B' : '#CBD5E1',
    earShadow: isDark ? 'inset 0 2px 4px rgba(255,255,255,0.05), 0 4px 6px rgba(0,0,0,0.4)' : 'inset 0 2px 4px rgba(255,255,255,1), 0 4px 6px rgba(0,0,0,0.05)'
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX)
      setMouseY(e.clientY)
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  useEffect(() => {
    const scheduleBlink = () => {
      const timeout = setTimeout(() => {
        setIsBlinking(true)
        setTimeout(() => {
          setIsBlinking(false)
          scheduleBlink()
        }, 150)
      }, Math.random() * 5000 + 3000)
      return timeout
    }
    const t = scheduleBlink()
    return () => clearTimeout(t)
  }, [])

  const calculatePosition = () => {
    if (!logoRef.current) return { faceX: 0, faceY: 0, rotation: 0 }
    const rect = logoRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const deltaX = mouseX - centerX
    const deltaY = mouseY - centerY
    
    // Subtly move the inner face
    const faceX = Math.max(-4, Math.min(4, deltaX / 40))
    const faceY = Math.max(-3, Math.min(3, deltaY / 60))
    
    // Subtly rotate the entire logo towards the mouse
    const rotation = Math.max(-8, Math.min(8, deltaX / 80))
    return { faceX, faceY, rotation }
  }

  const { faceX, faceY, rotation } = calculatePosition()

  return (
    <div
      ref={logoRef}
      style={{
        position: 'relative',
        width: size,
        height: size,
        transform: `rotate(${rotation}deg) scale(${isTyping ? 1.05 : 1})`,
        transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.3s, box-shadow 0.3s',
        cursor: 'pointer'
      }}
    >
      {/* ── Background Rounded Hexagon / Bezel ── */}
      <div style={{
        position: 'absolute', inset: 0,
        background: themeColors.bgGlass,
        borderRadius: size * 0.3,
        border: themeColors.borderGlass,
        boxShadow: themeColors.shadowGlass,
        transition: 'all 0.3s',
      }} />

      {/* ── Outer Tech Ears ── */}
      <div style={{
         position: 'absolute', top: -size*0.1, left: size*0.1, width: size*0.35, height: size*0.35,
         background: themeColors.earOuter, borderRadius: '6px',
         transform: 'rotate(-20deg)', zIndex: 0,
         boxShadow: themeColors.earShadow,
         transition: 'all 0.3s',
      }}>
         <div style={{ position: 'absolute', inset: 6, background: themeColors.earInner, borderRadius: '4px', transition: 'background 0.3s' }} />
      </div>
      <div style={{
         position: 'absolute', top: -size*0.1, right: size*0.1, width: size*0.35, height: size*0.35,
         background: themeColors.earOuter, borderRadius: '6px',
         transform: 'rotate(20deg)', zIndex: 0,
         boxShadow: themeColors.earShadow,
         transition: 'all 0.3s',
      }}>
         <div style={{ position: 'absolute', inset: 6, background: themeColors.earInner, borderRadius: '4px', transition: 'background 0.3s' }} />
      </div>

      {/* ── Face Wrapper (moves slightly with mouse) ── */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        transform: `translate(${faceX}px, ${faceY}px)`,
      }}>
         {/* Eyes */}
         <div style={{ display: 'flex', gap: size * 0.18, marginTop: -size * 0.05 }}>
            <EyeBall size={size * 0.3} pupilSize={size * 0.14} maxDistance={size * 0.08} isBlinking={isBlinking} isTyping={isTyping} isDark={isDark} />
            <EyeBall size={size * 0.3} pupilSize={size * 0.14} maxDistance={size * 0.08} isBlinking={isBlinking} isTyping={isTyping} isDark={isDark} />
         </div>

         {/* Tech Node Nose */}
         <div style={{ marginTop: size * 0.1, position: 'relative', width: size * 0.12, height: size * 0.08 }}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50% 50% 40% 40%', backgroundColor: themeColors.noseOuter, transition: 'background 0.3s' }} />
            {/* Whiskers */}
            <div style={{ position: 'absolute', left: -size*0.25, top: 0, width: size*0.18, height: 2, background: themeColors.whiskers, borderRadius: 2, transform: 'rotate(10deg)', transition: 'background 0.3s' }} />
            <div style={{ position: 'absolute', left: -size*0.25, top: size*0.06, width: size*0.18, height: 2, background: themeColors.whiskers, borderRadius: 2, transform: 'rotate(-5deg)', transition: 'background 0.3s' }} />
            <div style={{ position: 'absolute', right: -size*0.25, top: 0, width: size*0.18, height: 2, background: themeColors.whiskers, borderRadius: 2, transform: 'rotate(-10deg)', transition: 'background 0.3s' }} />
            <div style={{ position: 'absolute', right: -size*0.25, top: size*0.06, width: size*0.18, height: 2, background: themeColors.whiskers, borderRadius: 2, transform: 'rotate(5deg)', transition: 'background 0.3s' }} />
         </div>
      </div>
    </div>
  )
}
