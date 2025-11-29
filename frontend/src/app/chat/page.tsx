'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, useChatStore } from '@/lib/store';
import Sidebar from '@/components/Sidebar';
import ChatArea from '@/components/ChatArea';

export default function ChatPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const { loadSessions } = useChatStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      loadSessions();
    }
  }, [isAuthenticated, loadSessions]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-theme-bg-primary">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-theme-accent-primary" />
          <p className="text-theme-text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen bg-theme-bg-primary">
      <Sidebar />
      <ChatArea />
    </div>
  );
}
