'use client';

import TradingDashboard from '@/components/trading/TradingDashboard';

export function TradingWindow() {
  return (
    <div className="h-full w-full overflow-hidden" style={{ background: 'var(--theme-bg-primary)' }}>
      <TradingDashboard />
    </div>
  );
}

export default TradingWindow;
