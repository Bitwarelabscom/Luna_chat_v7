'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, RefreshCw, Trash2, Eye, EyeOff, ArrowLeft, Inbox, Clock } from 'lucide-react';
import { emailApi, type Email, type EmailStatus } from '@/lib/api';

export default function EmailWindow() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [viewingEmail, setViewingEmail] = useState<Email | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);

  const loadEmails = useCallback(async () => {
    try {
      setLoading(true);
      const [inboxData, unreadData, statusData] = await Promise.all([
        emailApi.getInbox(50),
        emailApi.getUnread(),
        emailApi.getStatus(),
      ]);
      setEmails(inboxData.emails || []);
      setUnreadCount(unreadData.count || 0);
      setEmailStatus(statusData);
    } catch (error) {
      console.error('Failed to load emails:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const handleViewEmail = async (uid: number) => {
    try {
      setActionLoading(uid);
      const result = await emailApi.getEmail(uid);
      setViewingEmail(result.email);
      if (!result.email.read) {
        await emailApi.markRead(uid, true);
        setEmails(prev => prev.map(e => e.uid === uid ? { ...e, read: true } : e));
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Failed to load email:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkRead = async (uid: number, read: boolean) => {
    try {
      setActionLoading(uid);
      await emailApi.markRead(uid, read);
      setEmails(prev => prev.map(e => e.uid === uid ? { ...e, read } : e));
      setUnreadCount(prev => read ? Math.max(0, prev - 1) : prev + 1);
    } catch (error) {
      console.error('Failed to mark email:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteEmail = async (uid: number) => {
    if (!confirm('Delete this email?')) return;
    try {
      setActionLoading(uid);
      await emailApi.deleteEmail(uid);
      setEmails(prev => prev.filter(e => e.uid !== uid));
      if (viewingEmail?.uid === uid) setViewingEmail(null);
      if (selectedEmail?.uid === uid) setSelectedEmail(null);
    } catch (error) {
      console.error('Failed to delete email:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatFullDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!emailStatus?.imap?.connected) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8" style={{ background: 'var(--theme-bg-primary)' }}>
        <Mail className="w-16 h-16 mb-4 opacity-30" style={{ color: 'var(--theme-text-muted)' }} />
        <h2 className="text-lg font-medium mb-2" style={{ color: 'var(--theme-text-primary)' }}>Email Not Connected</h2>
        <p className="text-sm text-center mb-4" style={{ color: 'var(--theme-text-muted)' }}>
          Connect your email in Settings - Integrations to view your inbox
        </p>
        <button
          onClick={loadEmails}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm"
          style={{ background: 'var(--theme-accent-primary)', color: 'white' }}
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Email List */}
      <div
        className={`${viewingEmail ? 'hidden md:flex' : 'flex'} flex-col border-r`}
        style={{ width: viewingEmail ? '320px' : '100%', borderColor: 'var(--theme-border-default)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
        >
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5" style={{ color: 'var(--theme-accent-primary)' }} />
            <span className="font-medium" style={{ color: 'var(--theme-text-primary)' }}>Inbox</span>
            {unreadCount > 0 && (
              <span
                className="px-2 py-0.5 text-xs rounded-full"
                style={{ background: 'var(--theme-accent-primary)', color: 'white' }}
              >
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={loadEmails}
            disabled={loading}
            className="p-1.5 rounded transition hover:bg-[var(--theme-bg-tertiary)]"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Email List */}
        <div className="flex-1 overflow-auto">
          {loading && emails.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--theme-accent-primary)' }} />
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8" style={{ color: 'var(--theme-text-muted)' }}>
              <Mail className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No emails</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--theme-border-default)' }}>
              {emails.map((email) => (
                <div
                  key={email.id}
                  onClick={() => email.uid && handleViewEmail(email.uid)}
                  className={`px-4 py-3 cursor-pointer transition hover:bg-[var(--theme-bg-tertiary)] ${
                    selectedEmail?.id === email.id ? 'bg-[var(--theme-accent-primary)]/10' : ''
                  }`}
                  style={{
                    borderLeft: email.read ? 'none' : '3px solid var(--theme-accent-primary)',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-sm truncate ${email.read ? '' : 'font-semibold'}`}
                      style={{ color: 'var(--theme-accent-primary)' }}
                    >
                      {email.from}
                    </span>
                    <span className="text-xs flex-shrink-0 ml-2" style={{ color: 'var(--theme-text-muted)' }}>
                      {formatDate(email.date)}
                    </span>
                  </div>
                  <div
                    className={`text-sm truncate ${email.read ? '' : 'font-medium'}`}
                    style={{ color: 'var(--theme-text-primary)' }}
                  >
                    {email.subject || '(no subject)'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Email Viewer */}
      {viewingEmail && (
        <div className="flex-1 flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
          {/* Viewer Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
          >
            <button
              onClick={() => setViewingEmail(null)}
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="md:hidden">Back</span>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => viewingEmail.uid && handleMarkRead(viewingEmail.uid, !viewingEmail.read)}
                disabled={actionLoading === viewingEmail.uid}
                className="p-2 rounded transition hover:bg-[var(--theme-bg-tertiary)]"
                style={{ color: viewingEmail.read ? 'var(--theme-text-muted)' : 'var(--theme-accent-primary)' }}
                title={viewingEmail.read ? 'Mark unread' : 'Mark read'}
              >
                {viewingEmail.read ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={() => viewingEmail.uid && handleDeleteEmail(viewingEmail.uid)}
                disabled={actionLoading === viewingEmail.uid}
                className="p-2 rounded transition hover:bg-red-500/20"
                style={{ color: 'var(--theme-text-muted)' }}
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Email Content */}
          <div className="flex-1 overflow-auto p-4">
            <h1 className="text-xl font-medium mb-4" style={{ color: 'var(--theme-text-primary)' }}>
              {viewingEmail.subject || '(no subject)'}
            </h1>
            <div className="flex items-start justify-between mb-4 pb-4 border-b" style={{ borderColor: 'var(--theme-border-default)' }}>
              <div>
                <div className="font-medium" style={{ color: 'var(--theme-text-primary)' }}>{viewingEmail.from}</div>
                {viewingEmail.to && (
                  <div className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>To: {viewingEmail.to}</div>
                )}
              </div>
              <div className="text-sm flex items-center gap-1" style={{ color: 'var(--theme-text-muted)' }}>
                <Clock className="w-3.5 h-3.5" />
                {formatFullDate(viewingEmail.date)}
              </div>
            </div>
            <div
              className="prose prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              {viewingEmail.body || '(no content)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
