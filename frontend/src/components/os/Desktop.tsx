'use client';

import { useState, useEffect, useCallback } from 'react';
import { SystemBar } from './SystemBar';
import { Spotlight } from './Spotlight';
import { Window } from './Window';
import { NewFileDialog } from './NewFileDialog';
import { useWindowStore } from '@/lib/window-store';
import { useChatStore } from '@/lib/store';
import { type AppId, appConfig } from './app-registry';

// App Components
import ChatWindow from './apps/ChatWindow';
import BrowserWindow from './apps/BrowserWindow';
import EditorWindow from './apps/EditorWindow';
import VoiceWindow from './apps/VoiceWindow';
import FilesWindow from './apps/FilesWindow';
import ProjectWindow from './apps/ProjectWindow';
import TerminalWindow from './apps/TerminalWindow';
import TasksWindow from './apps/TasksWindow';
import CalendarWindow from './apps/CalendarWindow';
import EmailWindow from './apps/EmailWindow';
import FriendsWindow from './apps/FriendsWindow';
import MusicWindow from './apps/MusicWindow';
import TradingWindow from './apps/TradingWindow';
import SettingsWindow from './apps/SettingsWindow';
import ActivityWindow from './apps/ActivityWindow';
import PlaceholderWindow from './apps/PlaceholderWindow';

// Map appId to component
function getAppComponent(appId: AppId): React.ReactNode {
  switch (appId) {
    case 'chat':
      return <ChatWindow />;
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
    case 'projects':
      return <ProjectWindow />;
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
    case 'trading':
      return <TradingWindow />;
    case 'settings':
      return <SettingsWindow />;
    case 'activity':
      return <ActivityWindow />;
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

  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false);

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

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0a0a1a 0%, #0d1025 50%, #0a0a1a 100%)',
      }}
    >
      {/* Ambient Background Effects */}
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
              {getAppComponent(windowState.appId)}
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
