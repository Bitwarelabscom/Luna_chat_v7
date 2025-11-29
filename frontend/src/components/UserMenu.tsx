'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings, LogOut, ChevronUp } from 'lucide-react';

interface UserMenuProps {
  user: {
    displayName: string | null;
    email: string;
  } | null;
  onLogout: () => void;
  onOpenSettings: () => void;
}

export default function UserMenu({ user, onLogout, onOpenSettings }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuClick = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-800 transition group"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-medium">
            {user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="truncate text-left">
            <p className="text-sm font-medium text-white truncate max-w-[140px]">
              {user?.displayName || user?.email}
            </p>
          </div>
        </div>
        <ChevronUp
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
          <button
            onClick={() => handleMenuClick(onOpenSettings)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <div className="border-t border-gray-700" />
          <button
            onClick={() => handleMenuClick(onLogout)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-gray-700 hover:text-red-300 transition"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
