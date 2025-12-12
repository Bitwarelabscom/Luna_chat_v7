'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      setPosition({ x: 0, y: 0 });
      // Account for SystemBar (28px) and Dock (80px)
      setSize({ width: window.innerWidth, height: window.innerHeight - 28 - 80 });
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
    <div
      ref={windowRef}
      className={cn(
        'absolute rounded-xl overflow-hidden shadow-2xl flex flex-col transition-shadow duration-200',
        isActive ? 'shadow-black/50 ring-1 ring-white/10' : 'shadow-black/30',
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
      }}
      onMouseDown={onFocus}
    >
      {/* Title Bar */}
      <div
        className={cn(
          'h-10 flex items-center justify-between px-3 select-none border-b',
          isActive ? 'bg-[var(--theme-bg-secondary)]' : 'bg-[var(--theme-bg-secondary)]/80',
          'border-[var(--theme-border)]',
          !isMaximized && 'cursor-grab'
        )}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleMaximize}
      >
        {/* Traffic Lights */}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center group"
          >
            <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors flex items-center justify-center group"
          >
            <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMaximize();
            }}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 transition-colors flex items-center justify-center group"
          >
            {isMaximized ? (
              <Minimize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            ) : (
              <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        </div>

        {/* Title */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          {icon}
          <span className={cn('text-sm font-medium', isActive ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)]')}>
            {title}
          </span>
        </div>

        {/* Spacer */}
        <div className="w-16" />
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
    </div>
  );
}

export default Window;
