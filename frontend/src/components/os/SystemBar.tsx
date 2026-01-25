'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Bell,
  Search,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Settings,
  LogOut,
  Cpu,
  ChevronDown,
  FilePlus,
  Terminal,
  Globe,
  FileText,
  Info,
  BookOpen,
  MessageSquare,
  Coins,
} from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { useNotificationStore } from '@/lib/notification-store';
import { useNotificationStream } from '@/hooks/useNotificationStream';
import { NotificationDropdown } from './NotificationDropdown';
import { settingsApi, spotifyApi, type SystemMetrics, type SpotifyPlaybackState, type DailyTokenStats } from '@/lib/api';
import { appConfig, dockApps, type AppId } from './app-registry';

interface SystemBarProps {
  onSpotlightOpen: () => void;
  onSettingsOpen: () => void;
  onAppOpen: (appId: AppId) => void;
  onNewFile: () => void;
}

export function SystemBar({ onSpotlightOpen, onSettingsOpen, onAppOpen, onNewFile }: SystemBarProps) {
  const { user, logout } = useAuthStore();
  const [time, setTime] = useState(new Date());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [playbackState, setPlaybackState] = useState<SpotifyPlaybackState | null>(null);
  const [controlLoading, setControlLoading] = useState(false);
  const [dailyTokens, setDailyTokens] = useState<DailyTokenStats | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Notification state
  const {
    unreadCount,
    hasUrgentUnread,
    isDropdownOpen,
    setDropdownOpen,
  } = useNotificationStore();

  // Initialize SSE connection for real-time notifications
  useNotificationStream();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Load system metrics
  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const metrics = await settingsApi.getSystemMetrics();
        setSystemMetrics(metrics);
      } catch (error) {
        console.log('System metrics not available');
      }
    };
    loadMetrics();
    const interval = setInterval(loadMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load Spotify playback state
  const fetchPlaybackState = async () => {
    try {
      const response = await spotifyApi.getPlaybackStatus();
      setPlaybackState(response.state);
    } catch (error) {
      // Silently ignore - user may not have Spotify connected
    }
  };

  useEffect(() => {
    fetchPlaybackState();
    const interval = setInterval(fetchPlaybackState, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load daily token stats
  useEffect(() => {
    const loadTokens = async () => {
      try {
        const tokens = await settingsApi.getDailyTokens();
        setDailyTokens(tokens);
      } catch (error) {
        console.log('Daily tokens not available');
      }
    };
    loadTokens();
    const interval = setInterval(loadTokens, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

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

  // Helper to get color for metrics
  const getMetricColor = (percent: number) => {
    if (percent <= 50) return 'text-green-400';
    if (percent <= 85) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Format token count
  const formatTokens = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  // Format cost
  const formatCost = (cost: number): string => {
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return '<$0.01';
    return '$' + cost.toFixed(2);
  };

  // Derive current track from playback state
  const currentTrack = playbackState?.item
    ? {
        title: playbackState.item.name,
        artist: playbackState.item.artists.map(a => a.name).join(', '),
      }
    : {
        title: 'Not Playing',
        artist: 'Spotify',
      };

  const isPlaying = playbackState?.isPlaying ?? false;

  // Playback control handlers
  const handlePlayPause = async () => {
    if (controlLoading) return;
    setControlLoading(true);
    try {
      if (isPlaying) {
        await spotifyApi.pause();
      } else {
        await spotifyApi.play();
      }
      // Immediately refresh playback state
      await fetchPlaybackState();
    } catch (error) {
      console.error('Failed to toggle playback:', error);
    } finally {
      setControlLoading(false);
    }
  };

  const handleSkipPrevious = async () => {
    if (controlLoading) return;
    setControlLoading(true);
    try {
      await spotifyApi.skipPrevious();
      await fetchPlaybackState();
    } catch (error) {
      console.error('Failed to skip previous:', error);
    } finally {
      setControlLoading(false);
    }
  };

  const handleSkipNext = async () => {
    if (controlLoading) return;
    setControlLoading(true);
    try {
      await spotifyApi.skipNext();
      await fetchPlaybackState();
    } catch (error) {
      console.error('Failed to skip next:', error);
    } finally {
      setControlLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  // Menu definitions
  const menus = {
    file: {
      label: 'File',
      items: [
        { label: 'New File...', icon: FilePlus, action: () => { onNewFile(); setActiveMenu(null); } },
      ],
    },
    apps: {
      label: 'Apps',
      items: dockApps.map((appId) => ({
        label: appConfig[appId].title,
        icon: appConfig[appId].icon,
        action: () => { onAppOpen(appId); setActiveMenu(null); },
      })),
    },
    tools: {
      label: 'Tools',
      items: [
        { label: 'Terminal', icon: Terminal, action: () => { onAppOpen('terminal'); setActiveMenu(null); } },
        { label: 'Browser', icon: Globe, action: () => { onAppOpen('browser'); setActiveMenu(null); } },
        { label: 'Editor', icon: FileText, action: () => { onAppOpen('editor'); setActiveMenu(null); } },
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
      className="h-7 backdrop-blur-xl border-b flex items-center justify-between px-4 text-[12px] z-50"
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
              {activeMenu === key && (
                <div
                  className="absolute left-0 top-full mt-1 min-w-[180px] backdrop-blur-xl border rounded-lg shadow-2xl overflow-hidden z-50"
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
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Center - Spotify Now Playing */}
      <div className="hidden md:flex items-center gap-3">
        <div
          className="flex items-center gap-2 px-3 py-0.5 rounded-full border"
          style={{
            background: 'rgba(29, 185, 84, 0.2)',
            borderColor: 'rgba(29, 185, 84, 0.3)',
          }}
        >
          <div className="w-4 h-4 rounded-sm bg-[#1DB954] flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
          </div>
          <div className="flex flex-col leading-tight max-w-[120px]">
            <span className="text-[11px] text-white truncate">{currentTrack.title}</span>
            <span className="text-[9px] text-white/60 truncate">{currentTrack.artist}</span>
          </div>
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={handleSkipPrevious}
              disabled={controlLoading}
              className="p-0.5 hover:text-white transition-colors disabled:opacity-50"
            >
              <SkipBack className="w-3 h-3" />
            </button>
            <button
              onClick={handlePlayPause}
              disabled={controlLoading}
              className="p-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
            <button
              onClick={handleSkipNext}
              disabled={controlLoading}
              className="p-0.5 hover:text-white transition-colors disabled:opacity-50"
            >
              <SkipForward className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Spotlight trigger */}
        <button
          onClick={onSpotlightOpen}
          className="flex items-center gap-2 px-3 py-0.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
        >
          <Search className="w-3 h-3" />
          <span>Spotlight</span>
          <kbd className="text-[10px] text-white/50 ml-2">Cmd Space</kbd>
        </button>
      </div>

      {/* Right - System Tray */}
      <div className="flex items-center gap-3">
        {/* System Metrics with color coding */}
        {systemMetrics && (
          <div className="hidden md:flex items-center gap-2 px-2 py-0.5 rounded bg-white/5">
            <Cpu className="w-3 h-3" />
            <span className={`text-[11px] ${getMetricColor(systemMetrics.cpu.percent)}`}>
              {systemMetrics.cpu.percent.toFixed(0)}%
            </span>
            <span className="text-[11px] text-white/50">|</span>
            <span className={`text-[11px] ${getMetricColor(systemMetrics.memory.percent)}`}>
              {systemMetrics.memory.percent.toFixed(0)}%
            </span>
          </div>
        )}

        <div className="hidden md:flex items-center gap-2 px-2 py-0.5 rounded bg-white/5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
          <span className="text-[11px]">Connected</span>
        </div>

        {/* Token Display */}
        {dailyTokens && (
          <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/5" title="Today's token usage">
            <Coins className="w-3 h-3 text-amber-400" />
            <span className="text-[11px]">
              {formatTokens(dailyTokens.totalTokens)} ({formatCost(dailyTokens.estimatedCost)})
            </span>
          </div>
        )}

        {/* Settings */}
        <button
          onClick={onSettingsOpen}
          className="p-1 hover:bg-white/10 rounded transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!isDropdownOpen)}
            className={`relative p-1 hover:bg-white/10 rounded transition-colors ${
              hasUrgentUnread ? 'animate-pulse' : ''
            }`}
          >
            <Bell
              className={`w-3.5 h-3.5 ${
                hasUrgentUnread ? 'animate-[shake_0.5s_ease-in-out_infinite]' : ''
              }`}
            />
            {unreadCount > 0 && (
              <span
                className={`absolute -top-0.5 -right-0.5 min-w-[12px] h-3 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center ${
                  hasUrgentUnread ? 'animate-pulse' : ''
                }`}
                style={{ background: hasUrgentUnread ? 'rgb(239, 68, 68)' : 'var(--theme-accent-primary)' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {isDropdownOpen && (
            <NotificationDropdown onClose={() => setDropdownOpen(false)} />
          )}
        </div>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 pl-2 border-l hover:text-white transition-colors"
            style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}
          >
            <span>{time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <span className="font-medium">{time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
          </button>

          {showUserMenu && (
            <div
              className="absolute right-0 top-full mt-2 w-48 backdrop-blur-xl border rounded-xl shadow-2xl overflow-hidden z-50"
              style={{
                background: 'var(--theme-bg-secondary)',
                borderColor: 'var(--theme-border)',
              }}
            >
              <div className="p-3 border-b" style={{ borderColor: 'var(--theme-border)' }}>
                <p className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
                  {user?.email || 'User'}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 p-3 hover:bg-white/5 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm">Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default SystemBar;
