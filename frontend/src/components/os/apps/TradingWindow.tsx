'use client';

import TradingTerminal from '@/components/trading/terminal/TradingTerminal';

export function TradingWindow() {
  return (
    <div className="h-full w-full overflow-hidden trading-terminal-embedded" style={{ background: 'var(--terminal-bg)' }}>
      <TradingTerminal onClose={() => {}} />
    </div>
  );
}

export default TradingWindow;
