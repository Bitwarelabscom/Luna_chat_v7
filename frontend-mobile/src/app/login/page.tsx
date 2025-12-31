'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Login page is no longer needed - auto-login happens on dashboard
// This page just redirects to dashboard
export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="h-dvh flex items-center justify-center bg-[var(--terminal-bg)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-2 border-[var(--terminal-accent)] border-t-transparent rounded-full animate-spin" />
        <span className="text-[var(--terminal-text-muted)] text-sm">Connecting...</span>
      </div>
    </div>
  );
}
