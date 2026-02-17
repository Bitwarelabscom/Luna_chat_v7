'use client';

import { useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring, type MotionValue } from 'framer-motion';
import { useWindowStore } from '@/lib/window-store';
import { appConfig } from './app-registry';
import { taskbarIconVariants, taskbarIconTransition } from '@/lib/animations';

function TaskbarIcon({
  windowState,
  isFocused,
  mouseX,
}: {
  windowState: { id: string; appId: string; isMinimized: boolean };
  isFocused: boolean;
  mouseX: MotionValue<number>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { focusWindow, minimizeApp } = useWindowStore();

  const config = appConfig[windowState.appId as keyof typeof appConfig];
  const Icon = config.icon;

  const distance = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const scale = useTransform(distance, [-100, 0, 100], [1, 1.35, 1]);
  const smoothScale = useSpring(scale, { mass: 0.1, stiffness: 300, damping: 15 });

  const handleClick = () => {
    if (windowState.isMinimized) {
      focusWindow(windowState.id);
      // Restore by re-opening (focusWindow doesn't restore minimized)
      useWindowStore.getState().openApp(windowState.appId as any);
    } else if (isFocused) {
      minimizeApp(windowState.id);
    } else {
      focusWindow(windowState.id);
    }
  };

  return (
    <motion.button
      ref={ref}
      layout
      variants={taskbarIconVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={taskbarIconTransition}
      style={{ scale: smoothScale }}
      onClick={handleClick}
      className="relative group flex flex-col items-center"
      title={config.title}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br shadow-lg transition-opacity ${config.color} ${
          windowState.isMinimized ? 'opacity-50' : ''
        }`}
      >
        <Icon className="w-5 h-5 text-white drop-shadow-md" />
      </div>

      {/* Minimized indicator dot */}
      {windowState.isMinimized && (
        <div className="absolute -bottom-1.5 w-1 h-1 rounded-full bg-white/50" />
      )}

      {/* Focus indicator */}
      {isFocused && !windowState.isMinimized && (
        <div
          className="absolute -bottom-1.5 w-1.5 h-1.5 rounded-full"
          style={{ background: 'var(--theme-accent-primary)' }}
        />
      )}

      {/* Tooltip */}
      <div
        className="absolute -top-8 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          background: 'var(--theme-bg-secondary)',
          border: '1px solid var(--theme-border)',
          color: 'var(--theme-text-primary)',
        }}
      >
        {config.title}
      </div>
    </motion.button>
  );
}

export function Taskbar() {
  const windows = useWindowStore((s) => s.windows);
  const focusedWindow = useWindowStore((s) => s.focusedWindow);
  const mouseX = useMotionValue(Infinity);

  if (windows.length === 0) return null;

  return (
    <div
      className="flex-shrink-0 flex justify-center py-2 z-50"
      onMouseMove={(e) => mouseX.set(e.clientX)}
      onMouseLeave={() => mouseX.set(Infinity)}
    >
      <motion.div
        className="flex items-center gap-2 px-3 py-2 backdrop-blur-2xl border rounded-2xl shadow-2xl"
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          borderColor: 'rgba(255, 255, 255, 0.15)',
        }}
        layout
      >
        <AnimatePresence mode="popLayout">
          {windows.map((w) => (
            <TaskbarIcon
              key={w.id}
              windowState={w}
              isFocused={focusedWindow === w.id}
              mouseX={mouseX}
            />
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default Taskbar;
