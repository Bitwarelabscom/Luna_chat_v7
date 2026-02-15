'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, Play, Pause, Square, X, Send, Zap } from 'lucide-react';
import {
  tradingApi,
  type ActiveTrade,
  type ResearchSignal,
  type BotConfig,
  type TradingSettings,
  type StrategyId,
  type StrategyMeta,
  type StrategyPerformance,
  type MarketRegimeData,
} from '@/lib/api';
import { useTradingWebSocket } from '@/hooks/useTradingWebSocket';
import { useThinkingMessage } from './ThinkingStatus';

// Smart price formatting - shows more decimals for low-priced coins
function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return '-';
  if (price > 0 && price < 0.0001) return price.toFixed(8);
  if (price > 0 && price < 0.01) return price.toFixed(6);
  if (price > 0 && price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

type Tab = 'chat' | 'active' | 'signals' | 'bots' | 'auto';

interface TabButtonProps {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}

function TabButton({ active, label, count, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 text-sm font-medium transition-colors ${
        active
          ? 'text-[var(--terminal-accent)] border-b-2 border-[var(--terminal-accent)]'
          : 'text-[var(--terminal-text-muted)] border-b border-[var(--terminal-border)]'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={`ml-1 px-1.5 py-0.5 rounded text-xs ${
          active ? 'bg-[var(--terminal-accent)] text-black' : 'bg-[var(--terminal-surface-hover)]'
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

interface TradeCardProps {
  trade: ActiveTrade;
  currentPrice?: number;
  onClose: (id: string) => void;
}

function TradeCard({ trade, currentPrice, onClose }: TradeCardProps) {
  const isProfit = trade.pnlDollar >= 0;
  const displayPrice = currentPrice || trade.currentPrice;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
            trade.side === 'buy'
              ? 'bg-[rgba(0,214,143,0.15)] text-[var(--terminal-positive)]'
              : 'bg-[rgba(255,107,107,0.15)] text-[var(--terminal-negative)]'
          }`}>
            {trade.side.toUpperCase()}
          </span>
          <span className="font-semibold text-[var(--terminal-text)]">{trade.symbol}</span>
        </div>
        <button
          onClick={() => onClose(trade.id)}
          className="p-1.5 text-[var(--terminal-text-muted)] hover:text-[var(--terminal-negative)] hover:bg-[var(--terminal-surface-hover)] rounded"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-[var(--terminal-text-dim)] text-xs">Entry</span>
          <div className="font-medium">${formatPrice(trade.entryPrice)}</div>
        </div>
        <div>
          <span className="text-[var(--terminal-text-dim)] text-xs">Current</span>
          <div className="font-medium">${formatPrice(displayPrice)}</div>
        </div>
        <div>
          <span className="text-[var(--terminal-text-dim)] text-xs">Qty</span>
          <div className="font-medium">{trade.quantity}</div>
        </div>
        <div>
          <span className="text-[var(--terminal-text-dim)] text-xs">P&L</span>
          <div className={`font-semibold ${isProfit ? 'pnl-positive' : 'pnl-negative'}`}>
            {isProfit ? '+' : ''}${trade.pnlDollar?.toFixed(2) || '0.00'} ({isProfit ? '+' : ''}{trade.pnlPercent?.toFixed(2) || '0.00'}%)
          </div>
        </div>
      </div>

      {(trade.stopLossPrice || trade.takeProfitPrice) && (
        <div className="mt-3 pt-3 border-t border-[var(--terminal-border)] flex gap-4 text-xs">
          {trade.stopLossPrice && (
            <div>
              <span className="text-[var(--terminal-negative)]">SL:</span> ${formatPrice(trade.stopLossPrice)}
            </div>
          )}
          {trade.takeProfitPrice && (
            <div>
              <span className="text-[var(--terminal-positive)]">TP:</span> ${formatPrice(trade.takeProfitPrice)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SignalCardProps {
  signal: ResearchSignal;
  onExecute: (id: string) => void;
  onSkip: (id: string) => void;
}

function SignalCard({ signal, onExecute, onSkip }: SignalCardProps) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="font-semibold text-[var(--terminal-text)]">{signal.symbol}</span>
          <div className="text-xs text-[var(--terminal-text-muted)] mt-0.5">
            Confidence: {signal.confidence}%
          </div>
        </div>
        <span className="text-lg font-mono">${formatPrice(signal.price)}</span>
      </div>

      <div className="text-xs text-[var(--terminal-text-muted)] mb-3">
        {signal.reasons.slice(0, 2).join(' - ')}
      </div>

      {signal.status === 'pending' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onExecute(signal.id)}
            className="flex-1 py-3 bg-[var(--terminal-positive)] text-black rounded font-medium text-sm active:opacity-70 touch-manipulation"
          >
            Execute
          </button>
          <button
            type="button"
            onClick={() => onSkip(signal.id)}
            className="flex-1 py-3 bg-[var(--terminal-surface-hover)] text-[var(--terminal-text)] rounded font-medium text-sm active:opacity-70 touch-manipulation"
          >
            Skip
          </button>
        </div>
      )}

      {signal.status !== 'pending' && (
        <div className={`text-xs font-medium ${
          signal.status === 'executed' ? 'text-[var(--terminal-positive)]' :
          signal.status === 'skipped' ? 'text-[var(--terminal-text-muted)]' :
          'text-[var(--terminal-negative)]'
        }`}>
          {signal.status.toUpperCase()}
        </div>
      )}
    </div>
  );
}

interface BotCardProps {
  bot: BotConfig;
  onToggle: (id: string, status: 'running' | 'stopped') => void;
}

function BotCard({ bot, onToggle }: BotCardProps) {
  const isRunning = bot.status === 'running';
  const isError = bot.status === 'error';

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-semibold text-[var(--terminal-text)]">{bot.name}</div>
          <div className="text-xs text-[var(--terminal-text-muted)]">
            {bot.type.toUpperCase()} - {bot.symbol}
          </div>
        </div>
        <button
          onClick={() => onToggle(bot.id, isRunning ? 'stopped' : 'running')}
          className={`p-2 rounded-lg transition-colors ${
            isRunning
              ? 'bg-[rgba(0,214,143,0.15)] text-[var(--terminal-positive)]'
              : isError
              ? 'bg-[rgba(255,107,107,0.15)] text-[var(--terminal-negative)]'
              : 'bg-[var(--terminal-surface-hover)] text-[var(--terminal-text-muted)]'
          }`}
        >
          {isRunning ? <Pause size={18} /> : <Play size={18} />}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-[var(--terminal-text-dim)] text-xs">Trades</span>
          <div className="font-medium">{bot.totalTrades}</div>
        </div>
        <div>
          <span className="text-[var(--terminal-text-dim)] text-xs">Win Rate</span>
          <div className="font-medium">{bot.winRate?.toFixed(1) || '0'}%</div>
        </div>
        <div>
          <span className="text-[var(--terminal-text-dim)] text-xs">Profit</span>
          <div className={`font-medium ${bot.totalProfit >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            ${bot.totalProfit?.toFixed(2) || '0.00'}
          </div>
        </div>
      </div>

      {isError && bot.lastError && (
        <div className="mt-2 p-2 bg-[rgba(255,107,107,0.1)] rounded text-xs text-[var(--terminal-negative)] flex items-center gap-2">
          <AlertTriangle size={14} />
          {bot.lastError}
        </div>
      )}
    </div>
  );
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function TradingView() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [signals, setSignals] = useState<ResearchSignal[]>([]);
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [settings, setSettings] = useState<TradingSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Auto trading state
  const [autoState, setAutoState] = useState<{
    isRunning: boolean;
    isPaused: boolean;
    pauseReason: string | null;
    dailyPnlPct: number;
    consecutiveLosses: number;
    activePositions: number;
    tradesCount: number;
    winsCount: number;
    lossesCount: number;
  } | null>(null);
  const [autoHistory, setAutoHistory] = useState<ActiveTrade[]>([]);
  const [signalHistory, setSignalHistory] = useState<{
    id: string;
    symbol: string;
    detectedAt: string;
    rsi: number;
    volumeRatio: number;
    confidence: number;
    entryPrice: number;
    suggestedStopLoss: number;
    suggestedTakeProfit: number;
    executed: boolean;
    skipReason: string | null;
    backtestStatus: 'pending' | 'win' | 'loss' | 'timeout';
    backtestExitPrice: number | null;
    backtestExitAt: string | null;
    backtestPnlPct: number | null;
    backtestDurationMinutes: number | null;
  }[]>([]);
  const [topCandidates, setTopCandidates] = useState<{
    symbol: string;
    rsi: number;
    volumeRatio: number;
    price: number;
    meetsRsi: boolean;
    meetsVolume: boolean;
  }[]>([]);

  // Multi-strategy state
  const [strategies, setStrategies] = useState<{
    id: StrategyId;
    meta: StrategyMeta;
    performance: StrategyPerformance;
  }[]>([]);
  const [marketRegime, setMarketRegime] = useState<MarketRegimeData | null>(null);
  const [autoSettings, setAutoSettings] = useState<{
    strategy: StrategyId;
    strategyMode: 'manual' | 'auto';
    currentStrategy?: StrategyId;
    excludeTop10: boolean;
    excludedSymbols: string[];
    btcTrendFilter: boolean;
    btcMomentumBoost: boolean;
    btcCorrelationSkip: boolean;
  } | null>(null);
  const [refreshCountdown, setRefreshCountdown] = useState(30);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'Hey! I\'m Trader Luna. Ask me about markets, trading strategies, or execute trades.',
      timestamp: Date.now(),
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const thinkingPhrase = useThinkingMessage(isSendingChat);

  // WebSocket for live prices
  const symbols = activeTrades.map(t => t.symbol);
  const { prices } = useTradingWebSocket({ symbols, enabled: symbols.length > 0 });

  // Initialize chat session
  const initChatSession = useCallback(async () => {
    try {
      const { sessionId } = await tradingApi.createChatSession();
      setChatSessionId(sessionId);
      // Load previous messages
      const history = await tradingApi.getChatMessages(sessionId);
      if (history.length > 0) {
        const loadedMessages: ChatMessage[] = history.map((msg, i) => ({
          id: `history-${i}`,
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: Date.now() - (history.length - i) * 1000,
        }));
        setChatMessages(prev => [prev[0], ...loadedMessages]);
      }
    } catch (err) {
      console.error('Failed to init trading chat session:', err);
    }
  }, []);

  useEffect(() => {
    initChatSession();
  }, [initChatSession]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSendChat = async () => {
    if (!chatInput.trim() || isSendingChat) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatInput.trim(),
      timestamp: Date.now(),
    };

    setChatMessages(prev => [...prev, userMessage]);
    const messageText = chatInput;
    setChatInput('');
    setIsSendingChat(true);

    try {
      let currentSessionId = chatSessionId;
      if (!currentSessionId) {
        const { sessionId } = await tradingApi.createChatSession();
        currentSessionId = sessionId;
        setChatSessionId(currentSessionId);
      }

      const response = await tradingApi.sendChatMessage(currentSessionId, messageText);

      const assistantMessage: ChatMessage = {
        id: response.messageId || (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
      };

      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.error('Chat error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setChatMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${errorMsg}. Please try again.`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsSendingChat(false);
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const [tradesRes, signalsRes, botsRes, settingsRes] = await Promise.all([
          tradingApi.getActiveTrades().catch(() => ({ openPositions: [], pendingOrders: [] })),
          tradingApi.getResearchSignals(20).catch(() => []),
          tradingApi.getBots().catch(() => []),
          tradingApi.getSettings().catch(() => null),
        ]);

        setActiveTrades(tradesRes.openPositions || []);
        setSignals(signalsRes);
        setBots(botsRes);
        setSettings(settingsRes);
      } catch (error) {
        console.error('Failed to load trading data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
    const interval = setInterval(loadData, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const handleCloseTrade = async (tradeId: string) => {
    try {
      await tradingApi.stopTrade(tradeId, true);
      setActiveTrades(trades => trades.filter(t => t.id !== tradeId));
    } catch (error) {
      console.error('Failed to close trade:', error);
    }
  };

  const handleExecuteSignal = async (signalId: string) => {
    try {
      await tradingApi.confirmSignal(signalId, 'execute');
      setSignals(signals => signals.map(s =>
        s.id === signalId ? { ...s, status: 'executed' as const } : s
      ));
    } catch (error) {
      console.error('Failed to execute signal:', error);
    }
  };

  const handleSkipSignal = async (signalId: string) => {
    try {
      await tradingApi.confirmSignal(signalId, 'skip');
      setSignals(signals => signals.map(s =>
        s.id === signalId ? { ...s, status: 'skipped' as const } : s
      ));
    } catch (error) {
      console.error('Failed to skip signal:', error);
    }
  };

  const handleToggleBot = async (botId: string, status: 'running' | 'stopped') => {
    try {
      await tradingApi.updateBotStatus(botId, status);
      setBots(bots => bots.map(b =>
        b.id === botId ? { ...b, status } : b
      ));
    } catch (error) {
      console.error('Failed to toggle bot:', error);
    }
  };

  // Auto trading handlers
  const loadAutoData = useCallback(async () => {
    try {
      const [stateRes, historyRes, signalsRes, candidatesRes, strategiesRes, regimeRes, settingsRes] = await Promise.all([
        tradingApi.getAutoState().catch(() => null),
        tradingApi.getAutoHistory().catch(() => ({ trades: [] })),
        tradingApi.getSignalHistory(50).catch(() => ({ signals: [] })),
        tradingApi.getTopCandidates().catch(() => ({ candidates: [] })),
        tradingApi.getStrategies().catch(() => ({ strategies: [] })),
        tradingApi.getMarketRegime().catch(() => ({ regime: null })),
        tradingApi.getAutoSettings().catch(() => null),
      ]);
      if (stateRes?.state) setAutoState(stateRes.state);
      if (historyRes?.trades) setAutoHistory(historyRes.trades);
      if (signalsRes?.signals) setSignalHistory(signalsRes.signals);
      if (candidatesRes?.candidates) setTopCandidates(candidatesRes.candidates);
      if (strategiesRes?.strategies) setStrategies(strategiesRes.strategies);
      if (regimeRes?.regime) setMarketRegime(regimeRes.regime);
      if (settingsRes?.settings) {
        setAutoSettings({
          strategy: settingsRes.settings.strategy,
          strategyMode: settingsRes.settings.strategyMode,
          currentStrategy: settingsRes.settings.currentStrategy,
          excludeTop10: settingsRes.settings.excludeTop10,
          excludedSymbols: settingsRes.settings.excludedSymbols,
          btcTrendFilter: settingsRes.settings.btcTrendFilter,
          btcMomentumBoost: settingsRes.settings.btcMomentumBoost,
          btcCorrelationSkip: settingsRes.settings.btcCorrelationSkip,
        });
      }
    } catch (error) {
      console.error('Failed to load auto trading data:', error);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'auto') {
      let lastRefresh = Date.now();
      loadAutoData();
      setRefreshCountdown(30);

      // Countdown timer - updates every second
      const countdownInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastRefresh) / 1000);
        const remaining = Math.max(0, 30 - elapsed);
        setRefreshCountdown(remaining);

        // Auto-refresh if timer hit 0
        if (remaining === 0) {
          loadAutoData();
          lastRefresh = Date.now();
        }
      }, 1000);

      // Handle visibility change - refresh when user returns to tab
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          loadAutoData();
          lastRefresh = Date.now();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(countdownInterval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [activeTab, loadAutoData]);

  const handleStartAuto = async () => {
    try {
      const res = await tradingApi.startAutoTrading();
      if (res.state) setAutoState(res.state);
    } catch (error) {
      console.error('Failed to start auto trading:', error);
    }
  };

  const handleStopAuto = async () => {
    try {
      const res = await tradingApi.stopAutoTrading();
      if (res.state) setAutoState(res.state);
    } catch (error) {
      console.error('Failed to stop auto trading:', error);
    }
  };

  const handleUpdateAutoSettings = async (updates: Partial<typeof autoSettings>) => {
    if (!autoSettings) return;
    try {
      const newSettings = { ...autoSettings, ...updates };
      await tradingApi.updateAutoSettings(newSettings);
      setAutoSettings(newSettings);
    } catch (error) {
      console.error('Failed to update auto settings:', error);
    }
  };

  const handleSelectStrategy = async (strategyId: StrategyId) => {
    await handleUpdateAutoSettings({ strategy: strategyId });
  };

  const handleToggleStrategyMode = async (mode: 'manual' | 'auto') => {
    await handleUpdateAutoSettings({ strategyMode: mode });
  };

  const handleToggleBtcInfluence = async (key: 'btcTrendFilter' | 'btcMomentumBoost' | 'btcCorrelationSkip') => {
    if (!autoSettings) return;
    await handleUpdateAutoSettings({ [key]: !autoSettings[key] });
  };

  const handleToggleExcludeTop10 = async () => {
    if (!autoSettings) return;
    await handleUpdateAutoSettings({ excludeTop10: !autoSettings.excludeTop10 });
  };

  const pendingSignals = signals.filter(s => s.status === 'pending');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[var(--terminal-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!settings?.exchangeConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
        <AlertTriangle size={48} className="text-[var(--terminal-warning)] mb-4" />
        <h3 className="text-lg font-semibold text-[var(--terminal-text)] mb-2">
          Exchange Not Connected
        </h3>
        <p className="text-sm text-[var(--terminal-text-muted)]">
          Connect your exchange in the desktop app to enable trading features.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Paper Mode Indicator */}
      {settings.paperMode && (
        <div className="px-4 py-2 bg-[rgba(255,201,77,0.1)] border-b border-[var(--terminal-warning)]">
          <div className="flex items-center gap-2 text-[var(--terminal-warning)] text-sm">
            <div className="status-dot status-paper" />
            <span className="font-medium">Paper Trading Mode</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--terminal-border)]">
        <TabButton
          active={activeTab === 'chat'}
          label="Chat"
          onClick={() => setActiveTab('chat')}
        />
        <TabButton
          active={activeTab === 'active'}
          label="Active"
          count={activeTrades.length}
          onClick={() => setActiveTab('active')}
        />
        <TabButton
          active={activeTab === 'signals'}
          label="Signals"
          count={pendingSignals.length}
          onClick={() => setActiveTab('signals')}
        />
        <TabButton
          active={activeTab === 'bots'}
          label="Bots"
          count={bots.filter(b => b.status === 'running').length}
          onClick={() => setActiveTab('bots')}
        />
        <TabButton
          active={activeTab === 'auto'}
          label="Auto"
          count={autoState?.activePositions}
          onClick={() => setActiveTab('auto')}
        />
      </div>

      {/* Chat Content */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 hide-scrollbar">
            {chatMessages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-[var(--terminal-accent)] text-black rounded-br-md'
                      : 'bg-[var(--terminal-surface)] text-[var(--terminal-text)] rounded-bl-md'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            {isSendingChat && (
              <div className="flex justify-start">
                <div className="bg-[var(--terminal-surface)] rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-[var(--terminal-accent)] rounded-full animate-pulse" />
                    <span className="text-sm text-[var(--terminal-text-muted)]">{thinkingPhrase}...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-[var(--terminal-border)]">
            <div className="flex items-end gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendChat()}
                placeholder="Ask Trader Luna..."
                disabled={isSendingChat}
                className="flex-1 px-4 py-3 bg-[var(--terminal-surface)] border border-[var(--terminal-border)] rounded-lg text-[var(--terminal-text)] placeholder-[var(--terminal-text-muted)] text-sm"
              />
              <button
                onClick={handleSendChat}
                disabled={!chatInput.trim() || isSendingChat}
                className="p-3 bg-[var(--terminal-accent)] text-black rounded-lg disabled:opacity-50 transition-opacity"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Content */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-3 hide-scrollbar ${activeTab === 'chat' ? 'hidden' : ''}`}>
        {activeTab === 'active' && (
          <>
            {activeTrades.length === 0 ? (
              <div className="text-center py-12 text-[var(--terminal-text-muted)]">
                No active positions
              </div>
            ) : (
              activeTrades.map(trade => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  currentPrice={prices.get(trade.symbol)?.price}
                  onClose={handleCloseTrade}
                />
              ))
            )}
          </>
        )}

        {activeTab === 'signals' && (
          <>
            {pendingSignals.length === 0 && signals.length === 0 ? (
              <div className="text-center py-12 text-[var(--terminal-text-muted)]">
                No signals available
              </div>
            ) : (
              <>
                {/* Pending signals - actionable */}
                {pendingSignals.length > 0 ? (
                  pendingSignals.map(signal => (
                    <SignalCard
                      key={signal.id}
                      signal={signal}
                      onExecute={handleExecuteSignal}
                      onSkip={handleSkipSignal}
                    />
                  ))
                ) : (
                  <div className="text-center py-6 text-[var(--terminal-text-muted)] text-sm">
                    No pending signals - scanner is active
                  </div>
                )}

                {/* Recent history - executed/skipped/expired */}
                {signals.filter(s => s.status !== 'pending').length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-[var(--terminal-text-dim)] uppercase tracking-wider mb-2 px-1">
                      Recent History
                    </div>
                    {signals.filter(s => s.status !== 'pending').slice(0, 5).map(signal => (
                      <SignalCard
                        key={signal.id}
                        signal={signal}
                        onExecute={handleExecuteSignal}
                        onSkip={handleSkipSignal}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'bots' && (
          <>
            {bots.length === 0 ? (
              <div className="text-center py-12 text-[var(--terminal-text-muted)]">
                No trading bots configured
              </div>
            ) : (
              bots.map(bot => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  onToggle={handleToggleBot}
                />
              ))
            )}
          </>
        )}

        {activeTab === 'auto' && (
          <>
            {/* Control Panel */}
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Zap size={24} className={autoState?.isRunning ? 'text-[var(--terminal-accent)]' : 'text-[var(--terminal-text-muted)]'} />
                  <div>
                    <div className="font-semibold text-[var(--terminal-text)]">
                      Auto Trading
                      <span className="ml-2 text-xs text-[var(--terminal-text-muted)]">BUILD_28DEC_V8</span>
                    </div>
                    <div className={`text-sm ${
                      autoState?.isPaused ? 'text-[var(--terminal-warning)]' :
                      autoState?.isRunning ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-text-muted)]'
                    }`}>
                      {autoState?.isPaused ? 'Paused' : autoState?.isRunning ? 'Running' : 'Stopped'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={autoState?.isRunning ? handleStopAuto : handleStartAuto}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    autoState?.isRunning
                      ? 'bg-[rgba(255,107,107,0.15)] text-[var(--terminal-negative)] hover:bg-[rgba(255,107,107,0.25)]'
                      : 'bg-[var(--terminal-accent)] text-black hover:opacity-90'
                  }`}
                >
                  {autoState?.isRunning ? <Square size={18} /> : <Play size={18} />}
                  {autoState?.isRunning ? 'Stop' : 'Start'}
                </button>
              </div>

              {autoState?.isPaused && autoState.pauseReason && (
                <div className="flex items-center gap-2 p-3 bg-[rgba(255,193,7,0.1)] border border-[var(--terminal-warning)] rounded-lg text-sm text-[var(--terminal-warning)]">
                  <AlertTriangle size={16} />
                  {autoState.pauseReason}
                </div>
              )}
            </div>

            {/* Stats Dashboard */}
            <div className="card p-4 mb-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-[var(--terminal-text)]">
                    {autoState?.activePositions || 0}/3
                  </div>
                  <div className="text-xs text-[var(--terminal-text-muted)]">Active</div>
                </div>
                <div>
                  <div className={`text-2xl font-bold ${(autoState?.dailyPnlPct || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {(autoState?.dailyPnlPct || 0) >= 0 ? '+' : ''}{(autoState?.dailyPnlPct || 0).toFixed(1)}%
                  </div>
                  <div className="text-xs text-[var(--terminal-text-muted)]">Today P&L</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-[var(--terminal-text)]">
                    {autoState?.winsCount || 0}/{autoState?.lossesCount || 0}
                  </div>
                  <div className="text-xs text-[var(--terminal-text-muted)]">W/L</div>
                </div>
              </div>
              {(autoState?.consecutiveLosses || 0) >= 2 && (
                <div className="mt-3 text-center text-sm text-[var(--terminal-warning)]">
                  {autoState?.consecutiveLosses} consecutive losses
                </div>
              )}
            </div>

            {/* Market Regime */}
            {marketRegime && marketRegime.regime && (
              <div className="card p-4 mb-4">
                <div className="text-xs text-[var(--terminal-text-dim)] uppercase tracking-wider mb-3">
                  Market Regime
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      marketRegime.regime === 'trending'
                        ? 'bg-[rgba(0,214,143,0.15)] text-[var(--terminal-positive)]'
                        : marketRegime.regime === 'ranging'
                        ? 'bg-[rgba(255,193,7,0.15)] text-[var(--terminal-warning)]'
                        : 'bg-[var(--terminal-surface-hover)] text-[var(--terminal-text-muted)]'
                    }`}>
                      {marketRegime.regime.toUpperCase()}
                    </span>
                    <span className="text-sm text-[var(--terminal-text-muted)]">
                      ADX: {marketRegime.adx?.toFixed(1) || '-'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-[var(--terminal-text-dim)] text-xs">BTC Trend</span>
                    <div className={`font-medium ${
                      marketRegime.btcTrend === 'bullish' ? 'text-[var(--terminal-positive)]' :
                      marketRegime.btcTrend === 'bearish' ? 'text-[var(--terminal-negative)]' :
                      'text-[var(--terminal-text-muted)]'
                    }`}>
                      {marketRegime.btcTrend.charAt(0).toUpperCase() + marketRegime.btcTrend.slice(1)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[var(--terminal-text-dim)] text-xs">BTC Momentum</span>
                    <div className={`font-medium ${
                      marketRegime.btcMomentum > 0.3 ? 'text-[var(--terminal-positive)]' :
                      marketRegime.btcMomentum < -0.3 ? 'text-[var(--terminal-negative)]' :
                      'text-[var(--terminal-text-muted)]'
                    }`}>
                      {(marketRegime.btcMomentum || 0) > 0 ? '+' : ''}{marketRegime.btcMomentum?.toFixed(2) || '0.00'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Strategy Mode */}
            {autoSettings && (
              <div className="card p-4 mb-4">
                <div className="text-xs text-[var(--terminal-text-dim)] uppercase tracking-wider mb-3">
                  Strategy Mode
                </div>
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => handleToggleStrategyMode('manual')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      autoSettings.strategyMode === 'manual'
                        ? 'bg-[var(--terminal-accent)] text-black'
                        : 'bg-[var(--terminal-surface-hover)] text-[var(--terminal-text-muted)]'
                    }`}
                  >
                    Manual
                  </button>
                  <button
                    onClick={() => handleToggleStrategyMode('auto')}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      autoSettings.strategyMode === 'auto'
                        ? 'bg-[var(--terminal-accent)] text-black'
                        : 'bg-[var(--terminal-surface-hover)] text-[var(--terminal-text-muted)]'
                    }`}
                  >
                    Auto
                  </button>
                </div>

                {autoSettings.strategyMode === 'auto' && marketRegime && (
                  <div className="p-3 bg-[var(--terminal-surface)] rounded-lg text-sm mb-4">
                    <div className="text-[var(--terminal-text-muted)] mb-1">Auto-selected:</div>
                    <div className="font-semibold text-[var(--terminal-accent)]">
                      {strategies.find(s => s.id === (autoSettings.currentStrategy || autoSettings.strategy))?.meta.name || autoSettings.currentStrategy || autoSettings.strategy}
                    </div>
                    <div className="text-xs text-[var(--terminal-text-dim)] mt-1">
                      70% regime fit + 30% win rate
                    </div>
                  </div>
                )}

                {/* Strategy Cards */}
                <div className="space-y-2">
                  {strategies.filter(s => s.meta).map(strategy => {
                    const activeStrategy = autoSettings.strategyMode === 'auto' ? (autoSettings.currentStrategy || autoSettings.strategy) : autoSettings.strategy;
                    const isSelected = activeStrategy === strategy.id;
                    const winRate = strategy.performance?.totalTrades > 0
                      ? ((strategy.performance?.winRate || 0) * 100).toFixed(0)
                      : '-';

                    return (
                      <button
                        key={strategy.id}
                        onClick={() => autoSettings.strategyMode === 'manual' && handleSelectStrategy(strategy.id)}
                        disabled={autoSettings.strategyMode === 'auto'}
                        className={`w-full p-3 rounded-lg text-left transition-colors ${
                          isSelected
                            ? 'bg-[rgba(0,214,143,0.15)] border border-[var(--terminal-positive)]'
                            : autoSettings.strategyMode === 'auto'
                            ? 'bg-[var(--terminal-surface)] opacity-60'
                            : 'bg-[var(--terminal-surface)] hover:bg-[var(--terminal-surface-hover)]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-[var(--terminal-text)]">
                            {strategy.meta.name}
                            {isSelected && <span className="ml-2 text-[var(--terminal-positive)]">*</span>}
                          </span>
                          <span className="text-sm text-[var(--terminal-text-muted)]">
                            {winRate}% WR
                          </span>
                        </div>
                        <div className="text-xs text-[var(--terminal-text-muted)] mb-2">
                          {strategy.meta.description}
                        </div>
                        <div className="flex gap-1">
                          {(strategy.meta.suitableRegimes || []).map(regime => (
                            <span
                              key={regime}
                              className={`px-1.5 py-0.5 rounded text-xs ${
                                marketRegime?.regime === regime
                                  ? 'bg-[var(--terminal-positive)] text-black font-medium'
                                  : 'bg-[var(--terminal-surface-hover)] text-[var(--terminal-text-dim)]'
                              }`}
                            >
                              {regime}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* BTC Influence */}
            {autoSettings && (
              <div className="card p-4 mb-4">
                <div className="text-xs text-[var(--terminal-text-dim)] uppercase tracking-wider mb-3">
                  BTC Influence (Altcoins)
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-[var(--terminal-text)]">Trend Filter</div>
                      <div className="text-xs text-[var(--terminal-text-muted)]">Skip alt longs when BTC bearish</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleBtcInfluence('btcTrendFilter')}
                      className={`w-12 h-6 rounded-full transition-colors touch-manipulation ${
                        autoSettings.btcTrendFilter ? 'bg-[var(--terminal-positive)]' : 'bg-[var(--terminal-surface-hover)]'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        autoSettings.btcTrendFilter ? 'translate-x-6' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-[var(--terminal-text)]">Momentum Boost</div>
                      <div className="text-xs text-[var(--terminal-text-muted)]">Adjust size by BTC momentum</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleBtcInfluence('btcMomentumBoost')}
                      className={`w-12 h-6 rounded-full transition-colors touch-manipulation ${
                        autoSettings.btcMomentumBoost ? 'bg-[var(--terminal-positive)]' : 'bg-[var(--terminal-surface-hover)]'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        autoSettings.btcMomentumBoost ? 'translate-x-6' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-[var(--terminal-text)]">Correlation Skip</div>
                      <div className="text-xs text-[var(--terminal-text-muted)]">Skip correlated alts when BTC weak</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleBtcInfluence('btcCorrelationSkip')}
                      className={`w-12 h-6 rounded-full transition-colors touch-manipulation ${
                        autoSettings.btcCorrelationSkip ? 'bg-[var(--terminal-positive)]' : 'bg-[var(--terminal-surface-hover)]'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        autoSettings.btcCorrelationSkip ? 'translate-x-6' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Exclusions */}
            {autoSettings && (
              <div className="card p-4 mb-4">
                <div className="text-xs text-[var(--terminal-text-dim)] uppercase tracking-wider mb-3">
                  Exclusions
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-[var(--terminal-text)]">Exclude Top 10</div>
                    <div className="text-xs text-[var(--terminal-text-muted)]">Skip top 10 coins by market cap</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleExcludeTop10}
                    className={`w-12 h-6 rounded-full transition-colors touch-manipulation ${
                      autoSettings.excludeTop10 ? 'bg-[var(--terminal-positive)]' : 'bg-[var(--terminal-surface-hover)]'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      autoSettings.excludeTop10 ? 'translate-x-6' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
                {autoSettings.excludedSymbols.length > 0 && (
                  <div className="mt-3 text-xs text-[var(--terminal-text-muted)]">
                    Custom: {autoSettings.excludedSymbols.join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Top 5 Candidates */}
            <div className="flex items-center justify-between text-xs text-[var(--terminal-text-dim)] uppercase tracking-wider mb-2 px-1">
              <span>Top 5 Candidates</span>
              <span className="text-[var(--terminal-accent)] font-mono">{refreshCountdown}s</span>
            </div>
            <div className="card p-3 mb-4">
              {topCandidates.length === 0 ? (
                <div className="text-center py-4 text-[var(--terminal-text-muted)]">
                  Loading candidates...
                </div>
              ) : (
                <div className="space-y-2">
                  {topCandidates.map((c, idx) => (
                    <div key={c.symbol} className="flex items-center justify-between py-1 border-b border-[var(--terminal-border)] last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--terminal-text-dim)] w-4">{idx + 1}.</span>
                        <span className="font-medium text-[var(--terminal-text)]">
                          {c.symbol.replace('_', '/')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className={c.meetsRsi ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-text-muted)]'}>
                          RSI {c.rsi?.toFixed(1) || '-'}
                        </span>
                        <span className={c.meetsVolume ? 'text-[var(--terminal-positive)]' : 'text-[var(--terminal-text-muted)]'}>
                          Vol {c.volumeRatio?.toFixed(1) || '-'}x
                        </span>
                        {c.meetsRsi && c.meetsVolume && (
                          <span className="px-1.5 py-0.5 bg-[var(--terminal-positive)] text-black rounded text-xs font-medium">
                            SIGNAL
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-[var(--terminal-text-dim)] mt-2 text-center">
                Trigger: {(() => {
                  const activeStrat = autoSettings?.strategyMode === 'auto'
                    ? (autoSettings.currentStrategy || autoSettings.strategy)
                    : autoSettings?.strategy;
                  switch (activeStrat) {
                    case 'trend_following': return 'EMA20 > EMA50 + ADX > 25';
                    case 'mean_reversion': return 'Bollinger Band + RSI extreme';
                    case 'momentum': return 'Strong momentum + Volume';
                    case 'btc_correlation': return 'BTC correlation aligned';
                    case 'rsi_oversold':
                    default: return 'RSI < 30 + Vol ≥ 1.5x';
                  }
                })()}
              </div>
            </div>

            {/* Signal History with Backtest */}
            <div className="text-xs text-[var(--terminal-text-dim)] uppercase tracking-wider mb-2 px-1">
              Signal History (Backtest)
            </div>
            {signalHistory.length === 0 ? (
              <div className="text-center py-8 text-[var(--terminal-text-muted)]">
                No signals detected yet
              </div>
            ) : (
              signalHistory.slice(0, 10).map(signal => (
                <div key={signal.id} className="card p-3 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--terminal-text)]">
                        {signal.symbol.replace('_', '/')}
                      </span>
                      {signal.executed ? (
                        <span className="text-xs px-1.5 py-0.5 bg-[var(--terminal-accent)] text-black rounded">
                          Executed
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 bg-[var(--terminal-surface)] text-[var(--terminal-text-muted)] rounded">
                          {signal.skipReason || 'Skipped'}
                        </span>
                      )}
                    </div>
                    <div className={`text-sm font-medium ${
                      signal.backtestStatus === 'win' ? 'pnl-positive' :
                      signal.backtestStatus === 'loss' ? 'pnl-negative' :
                      signal.backtestStatus === 'timeout' ? 'text-[var(--terminal-text-muted)]' :
                      'text-[var(--terminal-warning)]'
                    }`}>
                      {signal.backtestStatus === 'win' ? `+${signal.backtestPnlPct?.toFixed(1)}%` :
                       signal.backtestStatus === 'loss' ? `${signal.backtestPnlPct?.toFixed(1)}%` :
                       signal.backtestStatus === 'timeout' ? 'Timeout' : 'Pending'}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-[var(--terminal-text-muted)]">
                    <div>
                      <span className="block text-[var(--terminal-text-dim)]">Entry</span>
                      ${formatPrice(signal.entryPrice)}
                    </div>
                    <div>
                      <span className="block text-[var(--terminal-text-dim)]">RSI</span>
                      {signal.rsi?.toFixed(1) || '-'}
                    </div>
                    <div>
                      <span className="block text-[var(--terminal-text-dim)]">Vol</span>
                      {signal.volumeRatio?.toFixed(1) || '-'}x
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-[var(--terminal-text-muted)] mt-2">
                    <div>
                      <span className="block text-[var(--terminal-text-dim)]">SL</span>
                      ${formatPrice(signal.suggestedStopLoss)}
                    </div>
                    <div>
                      <span className="block text-[var(--terminal-text-dim)]">TP</span>
                      ${formatPrice(signal.suggestedTakeProfit)}
                    </div>
                    <div>
                      <span className="block text-[var(--terminal-text-dim)]">Time</span>
                      {signal.backtestDurationMinutes ? `${signal.backtestDurationMinutes}m` : '-'}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--terminal-text-dim)] mt-2">
                    {new Date(signal.detectedAt).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}

            {/* Today's Auto Trades */}
            <div className="text-xs text-[var(--terminal-text-dim)] uppercase tracking-wider mb-2 mt-4 px-1">
              Today&apos;s Auto Trades
            </div>
            {autoHistory.length === 0 ? (
              <div className="text-center py-8 text-[var(--terminal-text-muted)]">
                No auto trades today
              </div>
            ) : (
              autoHistory.map(trade => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  currentPrice={prices.get(trade.symbol)?.price}
                  onClose={handleCloseTrade}
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
