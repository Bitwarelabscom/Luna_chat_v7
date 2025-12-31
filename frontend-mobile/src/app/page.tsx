'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Always go to dashboard - auto-login happens there
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="h-dvh flex items-center justify-center bg-[var(--terminal-bg)]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-2 border-[var(--terminal-accent)] border-t-transparent rounded-full animate-spin" />
        <span className="text-[var(--terminal-text-muted)] text-sm">Loading...</span>
      </div>
    </div>
  );
}
