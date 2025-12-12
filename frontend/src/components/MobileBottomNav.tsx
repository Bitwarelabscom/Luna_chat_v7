'use client';

import React, { useState } from 'react';

// Simple icon components
const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const TasksIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const ActivityIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const MoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
);

const AutonomousIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const FriendsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const WorkspaceIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const EmailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

type MainTab = 'chat' | 'autonomous' | 'friends' | 'tasks' | 'workspace' | 'email' | 'calendar' | 'trading' | 'settings' | 'activity';

interface MobileBottomNavProps {
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
  unreadCount?: number;
}

const primaryTabs: { id: MainTab; label: string; Icon: React.FC }[] = [
  { id: 'chat', label: 'Chat', Icon: ChatIcon },
  { id: 'tasks', label: 'Tasks', Icon: TasksIcon },
  { id: 'activity', label: 'Activity', Icon: ActivityIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

const moreTabs: { id: MainTab; label: string; Icon: React.FC }[] = [
  { id: 'autonomous', label: 'Autonomous', Icon: AutonomousIcon },
  { id: 'friends', label: 'Friends', Icon: FriendsIcon },
  { id: 'workspace', label: 'Workspace', Icon: WorkspaceIcon },
  { id: 'email', label: 'Email', Icon: EmailIcon },
  { id: 'calendar', label: 'Calendar', Icon: CalendarIcon },
];

export default function MobileBottomNav({ activeTab, onTabChange, unreadCount = 0 }: MobileBottomNavProps) {
  const [showMore, setShowMore] = useState(false);

  const isActiveInMore = moreTabs.some(tab => tab.id === activeTab);

  return (
    <>
      {/* More menu popup */}
      {showMore && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShowMore(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 98,
            }}
          />
          {/* Menu */}
          <div style={{
            position: 'fixed',
            bottom: '70px',
            right: '10px',
            background: 'linear-gradient(180deg, #1a2433 0%, #0d1520 100%)',
            border: '1px solid #2a3545',
            borderRadius: '8px',
            padding: '8px',
            zIndex: 99,
            minWidth: '150px',
            boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.3)',
          }}>
            {moreTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  onTabChange(tab.id);
                  setShowMore(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '10px 12px',
                  background: activeTab === tab.id ? '#00ff9f15' : 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  color: activeTab === tab.id ? '#00ff9f' : '#8090a0',
                  fontSize: '12px',
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <tab.Icon />
                <span>{tab.label}</span>
                {tab.id === 'email' && unreadCount > 0 && (
                  <span style={{
                    marginLeft: 'auto',
                    background: '#ff6b6b',
                    color: '#fff',
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '10px',
                  }}>
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Bottom Navigation Bar */}
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '60px',
        background: 'linear-gradient(180deg, #151d28 0%, #0d1520 100%)',
        borderTop: '1px solid #2a3545',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        zIndex: 100,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {primaryTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              color: activeTab === tab.id ? '#00ff9f' : '#607080',
              cursor: 'pointer',
              minWidth: '60px',
              minHeight: '44px',
              transition: 'color 0.2s ease',
            }}
          >
            <tab.Icon />
            <span style={{ fontSize: '9px', letterSpacing: '0.5px' }}>{tab.label}</span>
          </button>
        ))}

        {/* More button */}
        <button
          onClick={() => setShowMore(!showMore)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '8px 12px',
            background: 'transparent',
            border: 'none',
            color: showMore || isActiveInMore ? '#00ff9f' : '#607080',
            cursor: 'pointer',
            minWidth: '60px',
            minHeight: '44px',
            transition: 'color 0.2s ease',
            position: 'relative',
          }}
        >
          <MoreIcon />
          <span style={{ fontSize: '9px', letterSpacing: '0.5px' }}>More</span>
          {/* Badge for unread emails */}
          {unreadCount > 0 && !showMore && (
            <span style={{
              position: 'absolute',
              top: '4px',
              right: '8px',
              width: '8px',
              height: '8px',
              background: '#ff6b6b',
              borderRadius: '50%',
            }} />
          )}
        </button>
      </nav>
    </>
  );
}
