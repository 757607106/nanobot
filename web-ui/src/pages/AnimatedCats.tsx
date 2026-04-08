import { useState, useEffect, useRef } from "react"
import { motion, useAnimation } from "framer-motion"

interface PupilProps {
  size?: number
  maxDistance?: number
  pupilColor?: string
  forceLookX?: number
  forceLookY?: number
  isTyping?: boolean
  isHiding?: boolean
}

function Pupil({
  size = 8,
  maxDistance = 4,
  pupilColor = "#111", // darker, more refined black
  forceLookX,
  forceLookY,
  isTyping,
  isHiding
}: PupilProps) {
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

  // Pupil dilates (gets larger) when typing, typical cat hunting behavior!
  const currentSize = isTyping && !isHiding ? size * 1.5 : size

  return (
    <div
      ref={pupilRef}
      style={{
        borderRadius: "50%",
        width: currentSize,
        height: currentSize,
        backgroundColor: pupilColor,
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
  eyeColor = "white",
  pupilColor = "#111",
  isBlinking = false,
  forceLookX,
  forceLookY,
  isTyping,
  isHiding
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
        backgroundColor: eyeColor,
        overflow: "hidden",
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' // refined eye depth
      }}
    >
      {!isBlinking && (
        <Pupil 
          size={pupilSize} 
          maxDistance={maxDistance} 
          pupilColor={pupilColor} 
          forceLookX={forceLookX} 
          forceLookY={forceLookY} 
          isTyping={isTyping}
          isHiding={isHiding}
        />
      )}
    </div>
  )
}

interface AnimatedCatsProps {
  isTyping?: boolean
  showPassword?: boolean
  passwordLength?: number
}

// Helper: refined Cat Ear with optional twitch
const CatEar = ({ left, right, color, innerColor, rotate, twitch = false }: any) => {
  return (
    <motion.div
      animate={twitch ? { rotate: [rotate, rotate - 15, rotate + 10, rotate] } : { rotate }}
      transition={{ duration: 0.5, ease: "easeInOut", repeatDelay: Math.random() * 5 + 2, repeat: twitch ? Infinity : 0 }}
      style={{
        position: 'absolute', top: -14, left, right, width: 34, height: 34,
        backgroundColor: color, borderRadius: '8px 2px 8px 2px', zIndex: -1,
        boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)'
      }}
    >
      {innerColor && (
        <div style={{
          position: 'absolute', top: 6, left: 6, width: 14, height: 14,
          backgroundColor: innerColor, borderRadius: '4px 1px 4px 1px'
        }} />
      )}
    </motion.div>
  )
}

const Whiskers = () => (
  <>
    {/* Left whiskers */}
    <div style={{ position: 'absolute', left: -20, top: 2, width: 15, height: 1, backgroundColor: 'rgba(0,0,0,0.1)', transform: 'rotate(10deg)' }} />
    <div style={{ position: 'absolute', left: -22, top: 6, width: 15, height: 1, backgroundColor: 'rgba(0,0,0,0.1)', transform: 'rotate(-5deg)' }} />
    <div style={{ position: 'absolute', left: -20, top: 10, width: 15, height: 1, backgroundColor: 'rgba(0,0,0,0.1)', transform: 'rotate(-15deg)' }} />
    {/* Right whiskers */}
    <div style={{ position: 'absolute', right: -20, top: 2, width: 15, height: 1, backgroundColor: 'rgba(0,0,0,0.1)', transform: 'rotate(-10deg)' }} />
    <div style={{ position: 'absolute', right: -22, top: 6, width: 15, height: 1, backgroundColor: 'rgba(0,0,0,0.1)', transform: 'rotate(5deg)' }} />
    <div style={{ position: 'absolute', right: -20, top: 10, width: 15, height: 1, backgroundColor: 'rgba(0,0,0,0.1)', transform: 'rotate(15deg)' }} />
  </>
)

const NoseAndMouth = ({ color = '#FCA5A5' }) => (
  <div style={{ position: 'relative', width: 10, height: 8, margin: '8px auto 0' }}>
    <div style={{ width: 10, height: 7, borderRadius: '50% 50% 40% 40%', backgroundColor: color }} />
    {/* Refined mouth lines */}
    <div style={{ position: 'absolute', top: 6, left: -2, width: 7, height: 7, borderBottom: '2px solid rgba(0,0,0,0.4)', borderLeft: '2px solid rgba(0,0,0,0.4)', borderRadius: '50%', transform: 'rotate(-45deg)' }} />
    <div style={{ position: 'absolute', top: 6, right: -2, width: 7, height: 7, borderBottom: '2px solid rgba(0,0,0,0.4)', borderRight: '2px solid rgba(0,0,0,0.4)', borderRadius: '50%', transform: 'rotate(45deg)' }} />
    <Whiskers />
  </div>
)

export function AnimatedCats({
  isTyping = false,
  showPassword = false,
  passwordLength = 0,
}: AnimatedCatsProps) {
  const [mouseX, setMouseX] = useState<number>(0)
  const [mouseY, setMouseY] = useState<number>(0)
  
  const [isBlinking1, setIsBlinking1] = useState(false)
  const [isBlinking2, setIsBlinking2] = useState(false)
  const [isBlinking3, setIsBlinking3] = useState(false)
  
  // Easter egg: Peeking one eye for the middle cat
  const [middleCatPeeking, setMiddleCatPeeking] = useState(false)

  const cat1Ref = useRef<HTMLDivElement>(null)
  const cat2Ref = useRef<HTMLDivElement>(null)
  const cat3Ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX)
      setMouseY(e.clientY)
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  const useBlinking = (setBlink: (v: boolean) => void) => {
    useEffect(() => {
      const scheduleBlink = () => {
        const timeout = setTimeout(() => {
          setBlink(true)
          setTimeout(() => {
            setBlink(false)
            scheduleBlink()
          }, 150)
        }, Math.random() * 4000 + 2000)
        return timeout
      }
      const t = scheduleBlink()
      return () => clearTimeout(t)
    }, [])
  }

  useBlinking(setIsBlinking1)
  useBlinking(setIsBlinking2)
  useBlinking(setIsBlinking3)

  const isHidingPassword = passwordLength > 0 && !showPassword

  // Trigger occasional peeking for middle cat when hiding password
  useEffect(() => {
    if (isHidingPassword) {
      const peekTimer = setInterval(() => {
        if (Math.random() > 0.6) {
          setMiddleCatPeeking(true)
          setTimeout(() => setMiddleCatPeeking(false), 1200)
        }
      }, 3000)
      return () => clearInterval(peekTimer)
    } else {
      setMiddleCatPeeking(false)
    }
  }, [isHidingPassword])

  const calculatePosition = (ref: React.RefObject<HTMLDivElement | null>, rangeScale = 1) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 }
    const rect = ref.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 3
    const deltaX = mouseX - centerX
    const deltaY = mouseY - centerY
    const faceX = Math.max(-10 * rangeScale, Math.min(10 * rangeScale, deltaX / 20))
    const faceY = Math.max(-6 * rangeScale, Math.min(6 * rangeScale, deltaY / 30))
    const bodySkew = Math.max(-6, Math.min(6, -deltaX / 120))
    return { faceX, faceY, bodySkew }
  }

  const pos1 = calculatePosition(cat1Ref, 1.2)
  const pos2 = calculatePosition(cat2Ref, 1.5)
  const pos3 = calculatePosition(cat3Ref, 1.0)

  // Mischievous State Logic
  // Cat 1 (Orange): Super scared/sneaky. Ducks completely behind card when typing password!
  const cat1Hiding = isHidingPassword

  // Cat 2 (White): Center hero. Covers eyes, occasionally spreads fingers to peek.
  // Paws state handled below.

  // Cat 3 (Dark): Too cool to care. Looks up/away when typing password!
  const cat3Ignoring = isHidingPassword

  return (
    <div style={{ position: "relative", width: "100%", height: "130px", pointerEvents: 'none' }}>
      
      {/* ── Cat 1: Orange Tabby (The Sneaky One) ── */}
      {/* Behavior: Drops completely out of sight except ear tips when password focuses! */}
      <div
        ref={cat1Ref}
        style={{
          position: "absolute", bottom: 0, left: "12%", width: 95, height: 85,
          backgroundColor: "#F97316", borderRadius: "45px 45px 0 0",
          transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1)", 
          transformOrigin: "bottom center",
          transform: cat1Hiding ? 'translateY(65px)' : isTyping ? `skewX(${pos1.bodySkew}deg) translateY(-5px)` : `skewX(${pos1.bodySkew}deg)`,
          boxShadow: 'inset -4px 0 12px rgba(0,0,0,0.08)'
        }}
      >
        <CatEar left={4} color="#F97316" innerColor="#FCA5A5" rotate={-15} twitch={true} />
        <CatEar right={4} color="#F97316" innerColor="#FCA5A5" rotate={80} />
        
        <div style={{
          position: 'absolute', width: '100%', top: 20 + pos1.faceY, left: pos1.faceX,
          display: 'flex', flexDirection: 'column', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <EyeBall size={20} pupilSize={9} eyeColor="white" isBlinking={isBlinking1} isTyping={isTyping} isHiding={cat1Hiding} />
            <EyeBall size={20} pupilSize={9} eyeColor="white" isBlinking={isBlinking1} isTyping={isTyping} isHiding={cat1Hiding} />
          </div>
          <NoseAndMouth color="#FCA5A5" />
        </div>

        <div style={{ position: 'absolute', bottom: 0, width: '100%', display: 'flex', justifyContent: 'space-between', padding: '0 12px', opacity: cat1Hiding ? 0 : 1, transition: 'opacity 0.2s' }}>
          <div style={{ width: 18, height: 16, backgroundColor: '#F97316', borderRadius: '14px 14px 0 0', boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.2)' }} />
          <div style={{ width: 18, height: 16, backgroundColor: '#F97316', borderRadius: '14px 14px 0 0', boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.2)' }} />
        </div>
      </div>

      {/* ── Cat 2: White/Gray (Center/Main) ── */}
      {/* Behavior: Playfully covers eyes, occasionally peeking. Paws move UP from edge to eyes! */}
      <div
        ref={cat2Ref}
        style={{
          position: "absolute", bottom: 0, left: "50%", marginLeft: -60, width: 120, height: 105,
          backgroundColor: "#F8FAFC", borderRadius: "60px 60px 0 0",
          boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.04)',
          transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.1)", transformOrigin: "bottom center",
          transform: isTyping ? `skewX(${pos2.bodySkew}deg) translateY(-8px)` : `skewX(${pos2.bodySkew}deg)`,
          zIndex: 5
        }}
      >
        <CatEar left={6} color="#F8FAFC" innerColor="#FBCFE8" rotate={-20} />
        <CatEar right={6} color="#F8FAFC" innerColor="#FBCFE8" rotate={75} twitch={true} />
        
        <div style={{
          position: 'absolute', width: '100%', top: 30 + pos2.faceY, left: pos2.faceX,
          display: 'flex', flexDirection: 'column', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {/* If peeking, left eye looks slightly down towards cursor */}
            <EyeBall size={26} pupilSize={12} eyeColor="white" isBlinking={isBlinking2} isTyping={isTyping} isHiding={isHidingPassword}
               forceLookX={middleCatPeeking ? -2 : undefined} 
               forceLookY={middleCatPeeking ? 4 : undefined} 
            />
            <EyeBall size={26} pupilSize={12} eyeColor="white" isBlinking={isBlinking2} isTyping={isTyping} isHiding={isHidingPassword} />
          </div>
          <NoseAndMouth color="#F472B6" />
        </div>

        {/* Dynamic Paws for Middle Cat */}
        {/* Normal: Rest on card edge. Hiding: Cover eyes. If peeking, left paw drops! */}
        <div style={{
           position: 'absolute', width: 26, height: 35, borderRadius: '13px', backgroundColor: '#F8FAFC',
           transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.2)', zIndex: 10,
           boxShadow: '0 4px 6px rgba(0,0,0,0.15)',
           // Left Paw logic
           left: isHidingPassword ? 18 : 22,
           bottom: isHidingPassword ? (middleCatPeeking ? 15 : 50) : 0,
           transform: isHidingPassword && !middleCatPeeking ? 'rotate(30deg)' : 'rotate(0deg)'
        }}>
           {/* Paw toes */}
           <div style={{ position: 'absolute', bottom: 4, width: '100%', display: 'flex', justifyContent: 'space-evenly' }}>
             <div style={{ width: 2, height: 8, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2 }} />
             <div style={{ width: 2, height: 8, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2 }} />
           </div>
        </div>

        <div style={{
           position: 'absolute', width: 26, height: 35, borderRadius: '13px', backgroundColor: '#F8FAFC',
           transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.2)', zIndex: 10,
           boxShadow: '0 4px 6px rgba(0,0,0,0.15)',
           // Right Paw logic
           right: isHidingPassword ? 18 : 22,
           bottom: isHidingPassword ? 50 : 0,
           transform: isHidingPassword ? 'rotate(-30deg)' : 'rotate(0deg)'
        }}>
           {/* Paw toes */}
           <div style={{ position: 'absolute', bottom: 4, width: '100%', display: 'flex', justifyContent: 'space-evenly' }}>
             <div style={{ width: 2, height: 8, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2 }} />
             <div style={{ width: 2, height: 8, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2 }} />
           </div>
        </div>
      </div>

      {/* ── Cat 3: Dark Blue/Black ("Too cool" cat) ── */}
      {/* Behavior: Whistles/Looks completely up into the ceiling when password typing */}
      <div
        ref={cat3Ref}
        style={{
          position: "absolute", bottom: 0, right: "12%", width: 90, height: 80,
          backgroundColor: "#1E293B", borderRadius: "45px 45px 0 0",
          transition: "all 0.4s ease-out", transformOrigin: "bottom center",
          transform: isTyping ? `skewX(${pos3.bodySkew}deg) translateY(-2px)` : `skewX(${pos3.bodySkew}deg)`,
          boxShadow: 'inset 4px 0 12px rgba(255,255,255,0.05)'
        }}
      >
        <CatEar left={4} color="#1E293B" rotate={-10} />
        <CatEar right={4} color="#1E293B" innerColor="#475569" rotate={80} />
        
        <div style={{
          position: 'absolute', width: '100%', top: 22 + pos3.faceY, left: pos3.faceX,
          display: 'flex', flexDirection: 'column', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <EyeBall size={18} pupilSize={8} eyeColor="#FEF08A" isBlinking={isBlinking3} isTyping={isTyping} isHiding={cat3Ignoring} 
               forceLookX={cat3Ignoring ? 8 : undefined}
               forceLookY={cat3Ignoring ? -10 : undefined}
            />
            <EyeBall size={18} pupilSize={8} eyeColor="#FEF08A" isBlinking={isBlinking3} isTyping={isTyping} isHiding={cat3Ignoring} 
               forceLookX={cat3Ignoring ? 8 : undefined}
               forceLookY={cat3Ignoring ? -10 : undefined}
            />
          </div>
          <NoseAndMouth color="#64748B" />
        </div>

        <div style={{ position: 'absolute', bottom: 0, width: '100%', display: 'flex', justifyContent: 'space-between', padding: '0 12px' }}>
          <div style={{ width: 18, height: 16, backgroundColor: '#1E293B', borderRadius: '14px 14px 0 0', boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.1)' }} />
          <div style={{ width: 18, height: 16, backgroundColor: '#1E293B', borderRadius: '14px 14px 0 0', boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.1)' }} />
        </div>
      </div>

    </div>
  )
}
