'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { windowVariants, windowTransition } from '@/lib/animations';

interface WindowProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  isActive: boolean;
  onClose: () => void;
  onFocus: () => void;
  onMinimize: () => void;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  zIndex: number;
}

export function Window({
  id: _id,
  title,
  icon,
  children,
  isActive,
  onClose,
  onFocus,
  onMinimize,
  initialPosition = { x: 100, y: 50 },
  initialSize = { width: 800, height: 500 },
  zIndex,
}: WindowProps) {
  const [position, setPosition] = useState(initialPosition);
  const [size, setSize] = useState(initialSize);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 });
  const windowRef = useRef<HTMLDivElement>(null);

  const preMaximizeState = useRef({ position, size });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMaximized) return;
    onFocus();
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleMaximize = () => {
    if (isMaximized) {
      setPosition(preMaximizeState.current.position);
      setSize(preMaximizeState.current.size);
    } else {
      preMaximizeState.current = { position, size };
      // Account for header (28px) and footer bar (40px)
      const footerH = 40;
      setPosition({ x: 0, y: 0 });
      setSize({
        width: window.innerWidth,
        height: window.innerHeight - 28 - footerH,
      });
    }
    setIsMaximized(!isMaximized);
  };

  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    setResizeDirection(direction);
    onFocus();
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: Math.max(0, e.clientY - dragOffset.current.y),
        });
      } else if (isResizing && resizeDirection) {
        const deltaX = e.clientX - resizeStart.current.x;
        const deltaY = e.clientY - resizeStart.current.y;
        const minWidth = 300;
        const minHeight = 200;

        let newWidth = resizeStart.current.width;
        let newHeight = resizeStart.current.height;
        let newX = resizeStart.current.posX;
        let newY = resizeStart.current.posY;

        if (resizeDirection.includes('e')) {
          newWidth = Math.max(minWidth, resizeStart.current.width + deltaX);
        }
        if (resizeDirection.includes('w')) {
          const potentialWidth = resizeStart.current.width - deltaX;
          if (potentialWidth >= minWidth) {
            newWidth = potentialWidth;
            newX = resizeStart.current.posX + deltaX;
          }
        }
        if (resizeDirection.includes('s')) {
          newHeight = Math.max(minHeight, resizeStart.current.height + deltaY);
        }
        if (resizeDirection.includes('n')) {
          const potentialHeight = resizeStart.current.height - deltaY;
          if (potentialHeight >= minHeight) {
            newHeight = potentialHeight;
            newY = resizeStart.current.posY + deltaY;
          }
        }

        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection(null);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, resizeDirection]);

  return (
    <motion.div
      ref={windowRef}
      className={cn(
        'absolute rounded-xl overflow-hidden flex flex-col',
        isDragging && 'cursor-grabbing',
        isMaximized && 'rounded-none'
      )}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex,
        background: 'var(--theme-bg-primary)',
        boxShadow: isActive
          ? '0 0 20px 2px color-mix(in srgb, var(--theme-accent-primary) 30%, transparent), 0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          : '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
        border: isActive
          ? '1px solid color-mix(in srgb, var(--theme-accent-primary) 40%, transparent)'
          : '1px solid rgba(255, 255, 255, 0.05)',
      }}
      initial={windowVariants.initial}
      animate={windowVariants.animate}
      exit={windowVariants.exit}
      transition={windowTransition.enter}
      onMouseDown={onFocus}
      layout={false}
    >
      {/* Title Bar */}
      <div
        className={cn(
          'h-10 flex items-center px-3 select-none border-b',
          'border-[var(--theme-border)]',
          !isMaximized && 'cursor-grab'
        )}
        style={{
          background: isActive
            ? 'linear-gradient(to right, rgba(255,255,255,0.08), rgba(255,255,255,0.02))'
            : 'rgba(0,0,0,0.3)',
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleMaximize}
      >
        {/* Title - centered */}
        <div className="flex-1 flex items-center justify-center gap-2">
          {icon}
          <span className={cn('text-sm font-medium', isActive ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)]')}>
            {title}
          </span>
        </div>

        {/* Window Controls - right side */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            className="w-7 h-5 rounded-sm flex items-center justify-center bg-white/5 border border-white/10 hover:bg-yellow-500/20 hover:border-yellow-500/40 transition-all group"
            style={{ cursor: 'pointer' }}
          >
            <Minus className="w-3 h-3 text-white/40 group-hover:text-yellow-400 transition-colors" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMaximize();
            }}
            className="w-7 h-5 rounded-sm flex items-center justify-center bg-white/5 border border-white/10 hover:bg-green-500/20 hover:border-green-500/40 transition-all group"
            style={{ cursor: 'pointer' }}
          >
            {isMaximized ? (
              <Minimize2 className="w-3 h-3 text-white/40 group-hover:text-green-400 transition-colors" />
            ) : (
              <Maximize2 className="w-3 h-3 text-white/40 group-hover:text-green-400 transition-colors" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-7 h-5 rounded-sm flex items-center justify-center bg-white/5 border border-white/10 hover:bg-red-500/20 hover:border-red-500/40 transition-all group"
            style={{ cursor: 'pointer' }}
          >
            <X className="w-3 h-3 text-white/40 group-hover:text-red-400 transition-colors" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
        {children}
      </div>

      {/* Resize Handles */}
      {!isMaximized && (
        <>
          {/* Corner handles */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={(e) => handleResizeStart(e, 'se')}
          />
          <div
            className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize"
            onMouseDown={(e) => handleResizeStart(e, 'sw')}
          />
          <div
            className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize"
            onMouseDown={(e) => handleResizeStart(e, 'ne')}
          />
          <div
            className="absolute top-10 left-0 w-4 h-4 cursor-nw-resize"
            onMouseDown={(e) => handleResizeStart(e, 'nw')}
          />
          {/* Edge handles */}
          <div
            className="absolute top-10 bottom-4 right-0 w-1 cursor-e-resize"
            onMouseDown={(e) => handleResizeStart(e, 'e')}
          />
          <div
            className="absolute top-10 bottom-4 left-0 w-1 cursor-w-resize"
            onMouseDown={(e) => handleResizeStart(e, 'w')}
          />
          <div
            className="absolute bottom-0 left-4 right-4 h-1 cursor-s-resize"
            onMouseDown={(e) => handleResizeStart(e, 's')}
          />
        </>
      )}
    </motion.div>
  );
}

export default Window;
