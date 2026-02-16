'use client';

import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { SystemBar } from './SystemBar';
import { Spotlight } from './Spotlight';
import { Window } from './Window';
import { NewFileDialog } from './NewFileDialog';
import { useWindowStore } from '@/lib/window-store';
import { useChatStore } from '@/lib/store';
import { useBackgroundStore } from '@/lib/background-store';
import { getMediaUrl, backgroundApi } from '@/lib/api';
import { type AppId, appConfig } from './app-registry';

// ChatWindow loaded eagerly (always visible)
import ChatWindow from './apps/ChatWindow';
// All other windows loaded on-demand
const BrowserWindow = lazy(() => import('./apps/BrowserWindow'));
const EditorWindow = lazy(() => import('./apps/EditorWindow'));
const VoiceWindow = lazy(() => import('./apps/VoiceWindow'));
const FilesWindow = lazy(() => import('./apps/FilesWindow'));
const TerminalWindow = lazy(() => import('./apps/TerminalWindow'));
const TasksWindow = lazy(() => import('./apps/TasksWindow'));
const CalendarWindow = lazy(() => import('./apps/CalendarWindow'));
const EmailWindow = lazy(() => import('./apps/EmailWindow'));
const FriendsWindow = lazy(() => import('./apps/FriendsWindow'));
const MusicWindow = lazy(() => import('./apps/MusicWindow'));
const VideosWindow = lazy(() => import('./apps/VideosWindow'));
const TradingWindow = lazy(() => import('./apps/TradingWindow'));
const SettingsWindow = lazy(() => import('./apps/SettingsWindow'));
const ActivityWindow = lazy(() => import('./apps/ActivityWindow'));
const ConsciousnessWindow = lazy(() => import('./apps/ConsciousnessWindow'));
const AutonomousLearningWindow = lazy(() => import('./apps/AutonomousLearningWindow'));
const NewsWindow = lazy(() => import('./apps/NewsWindow'));
const PlannerWindow = lazy(() => import('./apps/PlannerWindow'));
const IRCWindow = lazy(() => import('./apps/IRCWindow'));
const PlaceholderWindow = lazy(() => import('./apps/PlaceholderWindow'));
const LazyCanvasWindow = lazy(() => import('./apps/CanvasWindow').then(m => ({ default: m.CanvasWindow })));
const GamesWindow = lazy(() => import('./apps/GamesWindow'));

// Map appId to component
function getAppComponent(appId: AppId): React.ReactNode {
  switch (appId) {
    case 'chat':
      return <ChatWindow />;
    case 'irc':
      return <IRCWindow />;
    case 'voice':
      return <VoiceWindow />;
    case 'files':
      return <FilesWindow />;
    case 'terminal':
      return <TerminalWindow />;
    case 'browser':
      return <BrowserWindow />;
    case 'editor':
      return <EditorWindow />;
    case 'planner':
      return <PlannerWindow />;
    case 'todo':
      return <TasksWindow />;
    case 'calendar':
      return <CalendarWindow />;
    case 'email':
      return <EmailWindow />;
    case 'friends':
      return <FriendsWindow />;
    case 'music':
      return <MusicWindow />;
    case 'videos':
      return <VideosWindow />;
    case 'trading':
      return <TradingWindow />;
    case 'settings':
      return <SettingsWindow />;
    case 'activity':
      return <ActivityWindow />;
    case 'consciousness':
      return <ConsciousnessWindow />;
    case 'autonomous-learning':
      return <AutonomousLearningWindow />;
    case 'news':
      return <NewsWindow />;
    case 'canvas':
      return <LazyCanvasWindow />;
    case 'games':
      return <GamesWindow />;
    default:
      return <PlaceholderWindow title="Unknown" message="Unknown app" />;
  }
}

export function Desktop() {
  const {
    windows,
    focusedWindow,
    openApp,
    closeApp,
    minimizeApp,
    focusWindow,
    setPendingBrowserUrl,
  } = useWindowStore();

  const browserAction = useChatStore((state) => state.browserAction);
  const setBrowserAction = useChatStore((state) => state.setBrowserAction);
  const videoAction = useChatStore((state) => state.videoAction);
  const setVideoAction = useChatStore((state) => state.setVideoAction);
  const setPendingVideoResults = useWindowStore((state) => state.setPendingVideoResults);
  const mediaAction = useChatStore((state) => state.mediaAction);
  const setMediaAction = useChatStore((state) => state.setMediaAction);
  const setPendingMediaResults = useWindowStore((state) => state.setPendingMediaResults);
  const canvasAction = useChatStore((state) => state.canvasAction);
  const setCanvasAction = useChatStore((state) => state.setCanvasAction);
  const setPendingCanvasData = useWindowStore((state) => state.setPendingCanvasData);

  const { activeBackground, setActiveBackground } = useBackgroundStore();

  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false);

  // Fetch active background on mount and on refresh events
  const fetchActiveBackground = useCallback(() => {
    backgroundApi.getActiveBackground()
      .then((result) => {
        setActiveBackground(result.background);
      })
      .catch((err) => {
        console.error('Failed to fetch active background:', err);
      });
  }, [setActiveBackground]);

  useEffect(() => {
    fetchActiveBackground();
  }, [fetchActiveBackground]);

  // Listen for background refresh events (triggered by Luna chat)
  useEffect(() => {
    const handleBackgroundRefresh = () => {
      fetchActiveBackground();
    };
    window.addEventListener('luna:background-refresh', handleBackgroundRefresh);
    return () => {
      window.removeEventListener('luna:background-refresh', handleBackgroundRefresh);
    };
  }, [fetchActiveBackground]);

  // Open chat by default on first load
  useEffect(() => {
    if (windows.length === 0) {
      openApp('chat');
    }
  }, []);

  // Auto-open browser when browserAction is triggered (visual browsing)
  useEffect(() => {
    if (browserAction?.type === 'open') {
      // Set the pending URL for the browser to navigate to
      if (browserAction.url) {
        setPendingBrowserUrl(browserAction.url);
      }
      // Open the browser app
      openApp('browser');
      // Clear the action
      setBrowserAction(null);
    }
  }, [browserAction, openApp, setBrowserAction, setPendingBrowserUrl]);

  // Auto-open videos window when videoAction is triggered (YouTube search)
  useEffect(() => {
    if (videoAction?.type === 'open') {
      setPendingVideoResults({ videos: videoAction.videos, query: videoAction.query });
      openApp('videos');
      setVideoAction(null);
    }
  }, [videoAction, openApp, setVideoAction, setPendingVideoResults]);

  // Auto-open videos window when mediaAction is triggered
  useEffect(() => {
    if (mediaAction) {
      const mediaItems = mediaAction.items.map((item: any) => ({
        id: item.id,
        name: item.name,
        type: mediaAction.source === 'youtube' ? 'youtube' as const : (item.type === 'audio' ? 'media-audio' as const : 'media-video' as const),
        youtubeId: item.id,
        thumbnail: item.thumbnail,
        channelTitle: item.channelTitle,
        duration: item.duration,
        isLive: item.isLive,
        streamUrl: item.streamUrl,
        imageUrl: item.imageUrl,
        artist: item.artist,
        album: item.album,
        year: item.year,
        durationTicks: item.durationTicks,
      }));
      setPendingMediaResults({
        items: mediaItems,
        query: mediaAction.query,
        source: mediaAction.source as any,
        autoPlay: mediaAction.type === 'play',
      });
      openApp('videos');
      setMediaAction(null);
    }
  }, [mediaAction, openApp, setMediaAction, setPendingMediaResults]);

  // Auto-open canvas window when canvasAction is triggered
  useEffect(() => {
    if (canvasAction?.type === 'complete' && canvasAction.content) {
      setPendingCanvasData({
        artifactId: canvasAction.artifactId,
        content: canvasAction.content,
      });
      openApp('canvas');
      setCanvasAction(null);
    }
  }, [canvasAction, openApp, setCanvasAction, setPendingCanvasData]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === ' ') {
          e.preventDefault();
          setSpotlightOpen((prev) => !prev);
        } else if (e.key >= '1' && e.key <= '5') {
          e.preventDefault();
          const apps: AppId[] = ['chat', 'voice', 'files', 'terminal', 'browser'];
          openApp(apps[parseInt(e.key) - 1]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openApp]);

  const handleAppClick = useCallback((appId: AppId) => {
    openApp(appId);
  }, [openApp]);

  const handleSpotlightCommand = useCallback((command: string) => {
    // Handle commands like 'new-chat', 'search-files', etc.
    if (command === 'settings') {
      openApp('settings');
    }
  }, [openApp]);

  const handleNewFile = useCallback((filename: string) => {
    // Open editor with the new file
    openApp('editor');
    // TODO: Pass filename to editor - for now just opens editor
    console.log('Creating new file:', filename);
  }, [openApp]);

  // Compute background style
  const defaultGradient = 'linear-gradient(135deg, #0a0a1a 0%, #0d1025 50%, #0a0a1a 100%)';
  const backgroundStyle = activeBackground?.imageUrl
    ? {
        backgroundImage: `url(${getMediaUrl(activeBackground.imageUrl)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat' as const,
      }
    : {
        background: defaultGradient,
      };

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={backgroundStyle}
    >
      {/* Ambient Background Effects - only show when using default gradient */}
      {!activeBackground && (
        <div className="fixed inset-0 pointer-events-none">
          <div
            className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-[100px]"
            style={{ background: 'var(--theme-accent-primary)', opacity: 0.05 }}
          />
          <div
            className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-[100px]"
            style={{ background: 'var(--theme-accent-secondary)', opacity: 0.05 }}
          />
        </div>
      )}

      {/* System Bar */}
      <SystemBar
        onSpotlightOpen={() => setSpotlightOpen(true)}
        onSettingsOpen={() => openApp('settings')}
        onAppOpen={handleAppClick}
        onNewFile={() => setNewFileDialogOpen(true)}
      />

      {/* Desktop Area */}
      <div className="flex-1 relative">
        {/* Windows */}
        {windows.map((windowState) => {
          if (windowState.isMinimized) return null;

          const config = appConfig[windowState.appId];
          const Icon = config.icon;

          return (
            <Window
              key={windowState.id}
              id={windowState.id}
              title={config.title}
              icon={<Icon className="w-4 h-4" style={{ color: 'var(--theme-text-secondary)' }} />}
              isActive={focusedWindow === windowState.id}
              onClose={() => closeApp(windowState.id)}
              onFocus={() => focusWindow(windowState.id)}
              onMinimize={() => minimizeApp(windowState.id)}
              initialPosition={windowState.position}
              initialSize={windowState.size}
              zIndex={windowState.zIndex}
            >
              <Suspense fallback={
                <div className="flex items-center justify-center h-full w-full" style={{ color: 'var(--theme-text-secondary)' }}>
                  <div className="animate-pulse text-sm">Loading...</div>
                </div>
              }>
                {getAppComponent(windowState.appId)}
              </Suspense>
            </Window>
          );
        })}

      </div>

      {/* Spotlight */}
      <Spotlight
        isOpen={spotlightOpen}
        onClose={() => setSpotlightOpen(false)}
        onAppOpen={(appId) => {
          openApp(appId);
          setSpotlightOpen(false);
        }}
        onCommand={handleSpotlightCommand}
      />

      {/* New File Dialog */}
      <NewFileDialog
        isOpen={newFileDialogOpen}
        onClose={() => setNewFileDialogOpen(false)}
        onCreateFile={handleNewFile}
      />
    </div>
  );
}

export default Desktop;
