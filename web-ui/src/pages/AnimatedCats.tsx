import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface AnimatedProps {
  isTyping?: boolean
  showPassword?: boolean
  passwordLength?: number
}

export function AnimatedCats({
  isTyping = false,
  showPassword = false,
  passwordLength = 0,
}: AnimatedProps) {
  const [mouseX, setMouseX] = useState<number>(0)
  const [mouseY, setMouseY] = useState<number>(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX)
      setMouseY(e.clientY)
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  const isHidingPassword = passwordLength > 0 && !showPassword

  const calculateLook = () => {
    if (!containerRef.current) return { x: 0, y: 0, headX: 0, headY: 0 }
    
    // If hiding, lock eyes forward but squinting
    if (isHidingPassword) return { x: 0, y: 0, headX: 0, headY: 0 }

    const rect = containerRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    
    const deltaX = mouseX - centerX
    const deltaY = mouseY - centerY
    
    // Eye movement range inside visor
    const maxEyeX = 22
    const maxEyeY = 12
    const eyeX = Math.max(-maxEyeX, Math.min(maxEyeX, deltaX / 12))
    const eyeY = Math.max(-maxEyeY, Math.min(maxEyeY, deltaY / 15))

    // Head subtle movement range
    const headX = Math.max(-8, Math.min(8, deltaX / 40))
    const headY = Math.max(-4, Math.min(4, deltaY / 50))

    return { x: eyeX, y: eyeY, headX, headY }
  }

  const look = calculateLook()

  // Blinking logic
  const [isBlinking, setIsBlinking] = useState(false)
  useEffect(() => {
    const scheduleBlink = () => {
      const timeout = setTimeout(() => {
        setIsBlinking(true)
        setTimeout(() => setIsBlinking(false), 200)
        scheduleBlink()
      }, Math.random() * 5000 + 2000)
      return timeout
    }
    const t = scheduleBlink()
    return () => clearTimeout(t)
  }, [])

  const currentBlink = isHidingPassword ? true : isBlinking
  // When looking down or hiding, eye shape becomes a line
  const eyeHeight = currentBlink ? 4 : (isTyping ? 20 : 16)
  const eyeWidth = currentBlink ? 20 : (isTyping ? 18 : 16)
  const eyeColor = isHidingPassword ? '#f43f5e' : (isTyping ? '#38bdf8' : '#06b6d4')

  return (
    <div style={{ display: 'flex', justifyContent: 'center', width: "100%", height: "140px", pointerEvents: 'none' }} ref={containerRef}>
      
      {/* ── High-Aesthetic Astro Guardian Robot ── */}
      <motion.div
        style={{
          position: "relative",
          width: 140, 
          height: 120,
          perspective: 1000,
          marginTop: 20
        }}
        initial={false}
        animate={{ 
          x: look.headX, 
          y: isTyping ? look.headY - 6 : look.headY,
          rotateZ: isTyping ? look.headX * 0.5 : 0 
        }}
        transition={{ type: "spring", stiffness: 120, damping: 14, mass: 0.8 }}
      >
        {/* Antennas / Ears */}
        {[-1, 1].map(side => (
          <motion.div
            key={side}
            style={{
              position: 'absolute',
              top: 30,
              left: side === -1 ? -12 : 'auto',
              right: side === 1 ? -12 : 'auto',
              width: 14,
              height: 35,
              background: 'linear-gradient(180deg, #e2e8f0, #94a3b8)',
              borderRadius: 7,
              boxShadow: 'inset -2px -2px 6px rgba(0,0,0,0.2), 0 4px 6px rgba(0,0,0,0.1)',
              zIndex: -1
            }}
            animate={{ rotateZ: side * (isHidingPassword ? 15 : isTyping ? -10 : 0) }}
          >
             <div style={{ position:'absolute', top:-8, left:3, width:8, height:8, borderRadius:'50%', background: eyeColor, boxShadow: `0 0 8px ${eyeColor}` }} />
          </motion.div>
        ))}

        {/* Main Helmet / Head */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 40%, #cbd5e1 100%)',
          borderRadius: '50px 50px 35px 35px',
          boxShadow: 'inset -8px -8px 20px rgba(0,0,0,0.08), inset 8px 8px 20px rgba(255,255,255,0.8), 0 10px 25px rgba(0,0,0,0.1)',
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          
          {/* Black Glass Visor */}
          <div style={{
            position: 'relative',
            width: 110, height: 65,
            background: 'linear-gradient(145deg, #0f172a, #000000)',
            borderRadius: 24,
            boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.15), inset 0 -4px 10px rgba(0,0,0,0.8), 0 4px 8px rgba(0,0,0,0.1)',
            overflow: 'hidden',
            border: '2px solid #334155'
          }}>
             {/* Glass reflection curving over top */}
             <div style={{
               position:'absolute', top:2, left:4, right:4, height: 20,
               background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 100%)',
               borderRadius: '20px 20px 50% 50%', zIndex: 10
             }}/>
             
             {/* Eyes Container tracking mouse */}
             <motion.div
               style={{
                 position: 'absolute', inset: 0,
                 display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20
               }}
               animate={{ x: look.x, y: look.y }}
               transition={{ type: "spring", stiffness: 200, damping: 20 }}
             >
                {/* Left Eye */}
                <motion.div
                  initial={false}
                  animate={{ 
                    width: eyeWidth, height: eyeHeight, 
                    backgroundColor: eyeColor,
                    boxShadow: `0 0 12px ${eyeColor}, 0 0 24px ${eyeColor}`
                  }}
                  transition={{ duration: 0.2 }}
                  style={{ borderRadius: 10 }}
                />
                
                {/* Right Eye */}
                <motion.div
                  initial={false}
                  animate={{ 
                    width: eyeWidth, height: eyeHeight, 
                    backgroundColor: eyeColor,
                    boxShadow: `0 0 12px ${eyeColor}, 0 0 24px ${eyeColor}`
                  }}
                  transition={{ duration: 0.2 }}
                  style={{ borderRadius: 10 }}
                />
             </motion.div>
          </div>
          
          {/* Subtle Mouth / Speaker Grill */}
          <div style={{ position:'absolute', bottom: 12, display:'flex', gap: 4 }}>
             <div style={{width:4, height:4, borderRadius:2, background: '#94a3b8', boxShadow:'inset 0 1px 2px rgba(0,0,0,0.2)'}}/>
             <div style={{width:4, height:4, borderRadius:2, background: '#94a3b8', boxShadow:'inset 0 1px 2px rgba(0,0,0,0.2)'}}/>
             <div style={{width:4, height:4, borderRadius:2, background: '#94a3b8', boxShadow:'inset 0 1px 2px rgba(0,0,0,0.2)'}}/>
          </div>
        </div>

        {/* Floating Magnetic Hands that cover visor for password */}
        <AnimatePresence>
          {isHidingPassword && (
            <>
              {/* Left Hand */}
              <motion.div
                initial={{ y: 80, x: -30, rotateZ: -45, opacity: 0 }}
                animate={{ y: 0, x: -10, rotateZ: 15, opacity: 1 }}
                exit={{ y: 80, x: -30, rotateZ: -45, opacity: 0 }}
                transition={{ type: "spring", stiffness: 150, damping: 15 }}
                style={{
                  position: 'absolute', bottom: 10, left: -5,
                  width: 45, height: 60,
                  background: 'linear-gradient(135deg, #ffffff, #e2e8f0)',
                  borderRadius: 22,
                  boxShadow: '-4px 4px 10px rgba(0,0,0,0.15), inset -2px -2px 10px rgba(0,0,0,0.1)',
                  zIndex: 20
                }}
              />
              {/* Right Hand */}
              <motion.div
                initial={{ y: 80, x: 30, rotateZ: 45, opacity: 0 }}
                animate={{ y: 0, x: 10, rotateZ: -15, opacity: 1 }}
                exit={{ y: 80, x: 30, rotateZ: 45, opacity: 0 }}
                transition={{ type: "spring", stiffness: 150, damping: 15 }}
                style={{
                  position: 'absolute', bottom: 10, right: -5,
                  width: 45, height: 60,
                  background: 'linear-gradient(135deg, #ffffff, #e2e8f0)',
                  borderRadius: 22,
                  boxShadow: '4px 4px 10px rgba(0,0,0,0.15), inset 2px -2px 10px rgba(0,0,0,0.1)',
                  zIndex: 20
                }}
              />
            </>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
