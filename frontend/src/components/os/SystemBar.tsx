'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ChevronDown,
  FilePlus,
  Terminal,
  Globe,
  FileText,
  Info,
  BookOpen,
  MessageSquare,
  Mic,
  Hash,
  Folder,
  Mail,
  Users,
  Music,
  Video,
  TrendingUp,
  Activity,
  Brain,
  CheckSquare,
  Calendar,
  GitBranch,
  Newspaper,
  Gamepad2,
} from 'lucide-react';
import { type AppId } from './app-registry';
import { menuVariants, menuTransition } from '@/lib/animations';

interface SystemBarProps {
  onSpotlightOpen: () => void;
  onAppOpen: (appId: AppId) => void;
  onNewFile: () => void;
}

export function SystemBar({ onSpotlightOpen, onAppOpen, onNewFile }: SystemBarProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Categorized menu definitions
  const menus = {
    file: {
      label: 'File',
      items: [
        { label: 'New File...', icon: FilePlus, action: () => { onNewFile(); setActiveMenu(null); } },
      ],
    },
    communication: {
      label: 'Communication',
      items: [
        { label: 'Chat', icon: MessageSquare, action: () => { onAppOpen('chat'); setActiveMenu(null); } },
        { label: 'IRC', icon: Hash, action: () => { onAppOpen('irc'); setActiveMenu(null); } },
        { label: 'Email', icon: Mail, action: () => { onAppOpen('email'); setActiveMenu(null); } },
        { label: 'Voice', icon: Mic, action: () => { onAppOpen('voice'); setActiveMenu(null); } },
        { label: 'Friends', icon: Users, action: () => { onAppOpen('friends'); setActiveMenu(null); } },
      ],
    },
    productivity: {
      label: 'Productivity',
      items: [
        { label: 'Files', icon: Folder, action: () => { onAppOpen('files'); setActiveMenu(null); } },
        { label: 'Editor', icon: FileText, action: () => { onAppOpen('editor'); setActiveMenu(null); } },
        { label: 'Projects', icon: GitBranch, action: () => { onAppOpen('planner'); setActiveMenu(null); } },
        { label: 'Tasks', icon: CheckSquare, action: () => { onAppOpen('todo'); setActiveMenu(null); } },
        { label: 'Calendar', icon: Calendar, action: () => { onAppOpen('calendar'); setActiveMenu(null); } },
      ],
    },
    media: {
      label: 'Media',
      items: [
        { label: 'Music', icon: Music, action: () => { onAppOpen('music'); setActiveMenu(null); } },
        { label: 'Videos', icon: Video, action: () => { onAppOpen('videos'); setActiveMenu(null); } },
        { label: 'Games', icon: Gamepad2, action: () => { onAppOpen('games'); setActiveMenu(null); } },
      ],
    },
    tools: {
      label: 'Tools',
      items: [
        { label: 'Terminal', icon: Terminal, action: () => { onAppOpen('terminal'); setActiveMenu(null); } },
        { label: 'Browser', icon: Globe, action: () => { onAppOpen('browser'); setActiveMenu(null); } },
      ],
    },
    analytics: {
      label: 'Analytics',
      items: [
        { label: 'Trading', icon: TrendingUp, action: () => { onAppOpen('trading'); setActiveMenu(null); } },
        { label: 'Activity', icon: Activity, action: () => { onAppOpen('activity'); setActiveMenu(null); } },
        { label: 'Consciousness', icon: Brain, action: () => { onAppOpen('consciousness'); setActiveMenu(null); } },
        { label: 'Learning', icon: Brain, action: () => { onAppOpen('autonomous-learning'); setActiveMenu(null); } },
        { label: 'News', icon: Newspaper, action: () => { onAppOpen('news'); setActiveMenu(null); } },
      ],
    },
    help: {
      label: 'Help',
      items: [
        { label: 'About Luna', icon: Info, action: () => { setActiveMenu(null); } },
        { label: 'Documentation', icon: BookOpen, action: () => { window.open('https://github.com/anthropics/claude-code', '_blank'); setActiveMenu(null); } },
        { label: 'Send Feedback', icon: MessageSquare, action: () => { onAppOpen('chat'); setActiveMenu(null); } },
      ],
    },
  };

  return (
    <header
      className="h-7 backdrop-blur-xl border-b flex items-center justify-between px-4 text-[12px] z-[9999]"
      style={{
        background: 'rgba(0, 0, 0, 0.4)',
        borderColor: 'rgba(255, 255, 255, 0.05)',
        color: 'rgba(255, 255, 255, 0.8)',
      }}
    >
      {/* Left - Logo & Menu */}
      <div className="flex items-center gap-4" ref={menuRef}>
        <button className="flex items-center gap-1.5 hover:text-white transition-colors font-medium">
          <div
            className="w-4 h-4 rounded flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--theme-accent-primary), var(--theme-accent-secondary))' }}
          >
            <span className="text-[8px] font-bold text-black">L</span>
          </div>
          LunaOS
        </button>
        <nav className="hidden md:flex items-center gap-1">
          {Object.entries(menus).map(([key, menu]) => (
            <div key={key} className="relative">
              <button
                onClick={() => setActiveMenu(activeMenu === key ? null : key)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded hover:bg-white/10 transition-colors ${
                  activeMenu === key ? 'bg-white/10' : ''
                }`}
              >
                {menu.label}
                <ChevronDown className="w-3 h-3" />
              </button>
              <AnimatePresence>
                {activeMenu === key && (
                  <motion.div
                    initial={menuVariants.initial}
                    animate={menuVariants.animate}
                    exit={menuVariants.exit}
                    transition={menuTransition}
                    className="absolute left-0 top-full mt-1 min-w-[180px] backdrop-blur-xl border rounded-lg shadow-2xl z-[9999] overflow-hidden"
                    style={{
                      background: 'var(--theme-bg-secondary)',
                      borderColor: 'var(--theme-border)',
                    }}
                  >
                    {menu.items.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={item.action}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                        style={{ color: 'var(--theme-text-primary)' }}
                      >
                        <item.icon className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />
                        <span className="text-sm">{item.label}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </nav>
      </div>

      {/* Center - Spotlight */}
      <button
        onClick={onSpotlightOpen}
        className="flex items-center gap-2 px-3 py-0.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
      >
        <Search className="w-3 h-3" />
        <span>Spotlight</span>
        <kbd className="text-[10px] text-white/50 ml-2">Cmd Space</kbd>
      </button>

      {/* Right - empty placeholder to keep spotlight centered */}
      <div className="flex items-center" style={{ minWidth: '120px' }} />
    </header>
  );
}

export default SystemBar;
