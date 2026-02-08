'use client';

import { useMemo } from 'react';
import {
  TrendingUp,
  Bell,
  Mail,
  Bot,
  X,
  Check,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import {
  useNotificationStore,
  categoryConfig,
  type Notification,
  type NotificationCategory,
} from '@/lib/notification-store';
import { useWindowStore } from '@/lib/window-store';

// Category icons
const categoryIcons: Record<NotificationCategory, React.ComponentType<{ className?: string }>> = {
  trading: TrendingUp,
  reminders: Bell,
  email: Mail,
  autonomous: Bot,
};

// Category colors
const categoryColors: Record<NotificationCategory, string> = {
  trading: 'text-emerald-400',
  reminders: 'text-amber-400',
  email: 'text-blue-400',
  autonomous: 'text-purple-400',
};


// Format relative time
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

interface NotificationItemProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  onNavigate: (notification: Notification) => void;
}

function NotificationItem({ notification, onDismiss, onNavigate }: NotificationItemProps) {
  const Icon = categoryIcons[notification.category];
  const colorClass = categoryColors[notification.category];

  return (
    <div
      className={`p-3 hover:bg-white/5 transition-colors border-b last:border-0 cursor-pointer group ${
        notification.read ? 'opacity-60' : ''
      }`}
      style={{ borderColor: 'var(--theme-border)' }}
      onClick={() => onNavigate(notification)}
    >
      <div className="flex items-start gap-3">
        {/* Category icon */}
        <div className={`mt-0.5 ${colorClass}`}>
          <Icon className="w-4 h-4" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p
              className="text-sm font-medium truncate"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              {notification.title}
            </p>
            {notification.priorityValue >= 8 && (
              <AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0" />
            )}
          </div>
          <p
            className="text-xs mt-0.5 line-clamp-2"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {notification.message}
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
            {formatRelativeTime(notification.timestamp)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(notification.id);
            }}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
          {notification.navigationTarget && (
            <ChevronRight className="w-3 h-3 text-white/40" />
          )}
        </div>
      </div>
    </div>
  );
}

interface NotificationDropdownProps {
  onClose: () => void;
}

export function NotificationDropdown({ onClose }: NotificationDropdownProps) {
  const {
    notifications,
    unreadCount,
    unreadByCategory,
    activeFilter,
    setActiveFilter,
    markRead,
    markAllRead,
    dismiss,
    dismissAll,
  } = useNotificationStore();

  const { openApp } = useWindowStore();

  // Filter notifications
  const visibleNotifications = useMemo(() => {
    const nonDismissed = notifications.filter((n) => !n.dismissed);
    if (activeFilter === 'all') return nonDismissed;
    return nonDismissed.filter((n) => n.category === activeFilter);
  }, [notifications, activeFilter]);

  // Group notifications by urgency/time
  const groupedNotifications = useMemo(() => {
    const urgent: Notification[] = [];
    const today: Notification[] = [];
    const older: Notification[] = [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (const n of visibleNotifications) {
      if (!n.read && n.priorityValue >= 8) {
        urgent.push(n);
      } else if (n.timestamp >= todayStart) {
        today.push(n);
      } else {
        older.push(n);
      }
    }

    return { urgent, today, older };
  }, [visibleNotifications]);

  const handleNavigate = (notification: Notification) => {
    // Mark as read
    markRead(notification.id);

    // Navigate to target app
    if (notification.navigationTarget) {
      openApp(notification.navigationTarget.appId);
      // Note: Context passing would require additional window store functionality
    }

    // Close dropdown
    onClose();
  };

  const handleDismiss = (id: string) => {
    dismiss(id);
  };

  const handleClearAll = () => {
    if (activeFilter === 'all') {
      dismissAll();
    } else {
      dismissAll(activeFilter);
    }
  };

  const handleMarkAllRead = () => {
    if (activeFilter === 'all') {
      markAllRead();
    } else {
      markAllRead(activeFilter);
    }
  };

  const categories: (NotificationCategory | 'all')[] = ['all', 'trading', 'reminders', 'email', 'autonomous'];

  return (
    <div
      className="absolute right-0 top-full mt-2 w-80 backdrop-blur-xl border rounded-xl shadow-2xl overflow-hidden z-[9999]"
      style={{
        background: 'var(--theme-bg-secondary)',
        borderColor: 'var(--theme-border)',
      }}
    >
      {/* Header */}
      <div
        className="p-3 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <h3 className="font-medium text-sm" style={{ color: 'var(--theme-text-primary)' }}>
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-white/10">
              {unreadCount}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="Mark all as read"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          {visibleNotifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs hover:text-white transition-colors"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div
        className="flex items-center gap-1 p-2 border-b overflow-x-auto"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        {categories.map((cat) => {
          const isActive = activeFilter === cat;
          const count = cat === 'all' ? unreadCount : unreadByCategory[cat];
          const label = cat === 'all' ? 'All' : categoryConfig[cat].label;

          return (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              {label}
              {count > 0 && (
                <span
                  className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center"
                  style={{ background: 'var(--theme-accent-primary)' }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      <div className="max-h-80 overflow-y-auto">
        {visibleNotifications.length === 0 ? (
          <div className="p-6 text-center">
            <Bell className="w-8 h-8 mx-auto mb-2 text-white/20" />
            <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
              No notifications
            </p>
          </div>
        ) : (
          <>
            {/* Urgent section */}
            {groupedNotifications.urgent.length > 0 && (
              <div>
                <div
                  className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider bg-red-500/10"
                  style={{ color: 'rgb(239, 68, 68)' }}
                >
                  Urgent
                </div>
                {groupedNotifications.urgent.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onDismiss={handleDismiss}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            )}

            {/* Today section */}
            {groupedNotifications.today.length > 0 && (
              <div>
                <div
                  className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  Today
                </div>
                {groupedNotifications.today.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onDismiss={handleDismiss}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            )}

            {/* Older section */}
            {groupedNotifications.older.length > 0 && (
              <div>
                <div
                  className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  Earlier
                </div>
                {groupedNotifications.older.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onDismiss={handleDismiss}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default NotificationDropdown;
