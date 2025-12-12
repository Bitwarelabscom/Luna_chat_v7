'use client';

import dynamic from 'next/dynamic';

// Dynamic import to avoid SSR issues with speech recognition
const VoiceChatArea = dynamic(() => import('@/components/VoiceChatArea'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--theme-text-secondary)' }}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-current mx-auto mb-2"></div>
        <p className="text-sm">Loading voice chat...</p>
      </div>
    </div>
  ),
});

export function VoiceWindow() {
  return (
    <div className="h-full w-full overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
      <VoiceChatArea />
    </div>
  );
}

export default VoiceWindow;
