export const shellSpring = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 0.8,
} as const

export const surfaceReveal = {
  hidden: {
    opacity: 0,
    y: 18,
    scale: 0.985,
    filter: 'blur(14px)',
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: shellSpring,
  },
  exit: {
    opacity: 0,
    y: -10,
    scale: 0.992,
    filter: 'blur(10px)',
    transition: {
      duration: 0.18,
    },
  },
} as const

export const surfaceChild = {
  hidden: {
    opacity: 0,
    y: 14,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      ...shellSpring,
      stiffness: 190,
      damping: 24,
      mass: 0.82,
    },
  },
} as const

export const panelReveal = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.992,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      ...shellSpring,
      stiffness: 175,
      damping: 24,
      mass: 0.88,
    },
  },
} as const

export const staggerChildren = {
  hidden: {
    opacity: 1,
  },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.03,
    },
  },
} as const

export const interactiveLift = {
  y: -7,
  scale: 1.012,
} as const

export const interactiveTap = {
  y: -2,
  scale: 0.994,
} as const
