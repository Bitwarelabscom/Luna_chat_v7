// Shared Framer Motion animation presets

export const springConfig = {
  snappy: { type: 'spring' as const, stiffness: 500, damping: 30 },
  smooth: { type: 'spring' as const, stiffness: 300, damping: 25 },
  gentle: { type: 'spring' as const, stiffness: 200, damping: 20 },
  bouncy: { type: 'spring' as const, stiffness: 400, damping: 15 },
};

export const windowVariants = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.92, y: 40 },
};

export const windowTransition = {
  enter: { ...springConfig.snappy, mass: 0.5 },
  exit: { duration: 0.2, ease: 'easeIn' as const },
};

export const sidebarVariants = {
  open: { width: 350 },
  closed: { width: 0 },
};

export const sidebarTransition = springConfig.smooth;

export const menuVariants = {
  initial: { opacity: 0, y: -4, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.97 },
};

export const menuTransition = { duration: 0.15, ease: 'easeOut' as const };

export const taskbarIconVariants = {
  initial: { opacity: 0, scale: 0.5, y: 20 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.5, y: 20 },
};

export const taskbarIconTransition = springConfig.snappy;

// Chat panel slide-in from right
export const panelVariants = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
};

export const panelTransition = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 30,
};

// Floating action button scale-in
export const fabVariants = {
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0, opacity: 0 },
};

export const fabTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 15,
};
