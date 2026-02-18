import { api } from './core';
import type { DisplayContent } from '@/types/display';

// Trading API Types
export type ExchangeType = 'binance' | 'crypto_com';

export interface TradingSettings {
  userId: string;
  exchangeConnected: boolean;
  activeExchange: ExchangeType | null;
  maxPositionPct: number;
  dailyLossLimitPct: number;
  requireStopLoss: boolean;
  defaultStopLossPct: number;
  allowedSymbols: string[];
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  // Paper trading mode
  paperMode: boolean;
  paperBalanceUsdc: number;
  // Stop confirmation threshold for ACTIVE tab
  stopConfirmationThresholdUsd: number;
  // Margin trading (Crypto.com only)
  marginEnabled: boolean;
  leverage: number;
}

export interface MarginPosition {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  marginUsed: number;
}

export interface MarginAccountInfo {
  totalEquity: number;
  availableMargin: number;
  usedMargin: number;
  marginRatio: number;
}

// Advanced Signal Settings (V2 Features)
export interface AdvancedSignalSettings {
  userId: string;
  featurePreset: 'basic' | 'intermediate' | 'pro';
  enableMtfConfluence: boolean;
  mtfHigherTimeframe: string;
  enableVwapEntry: boolean;
  vwapAnchorType: string;
  enableAtrStops: boolean;
  atrPeriod: number;
  atrSlMultiplier: number;
  atrTpMultiplier: number;
  enableBtcFilter: boolean;
  btcDumpThreshold: number;
  btcLookbackMinutes: number;
  enableLiquiditySweep: boolean;
  sweepWickRatio: number;
  sweepVolumeMultiplier: number;
}

// Active Trade Types (ACTIVE Tab)
export interface ActiveTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnlDollar: number;
  pnlPercent: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  trailingStopPct: number | null;
  trailingStopPrice: number | null;
  timeInTrade: number; // milliseconds since entry
  source: 'manual' | 'bot' | 'research';
  botId: string | null;
  binanceOrderId: string | null;
  status: 'filled' | 'pending' | 'new';
  type: 'position' | 'pending_order';
  filledAt: Date | null;
  createdAt: Date;
}

export interface ActiveTradesResponse {
  openPositions: ActiveTrade[];
  pendingOrders: ActiveTrade[];
}

export interface UpdateTradeSLTPParams {
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  trailingStopPct?: number | null;
}

export interface StopTradeResponse {
  success: boolean;
  requiresConfirmation?: boolean;
  tradeValue?: number;
  error?: string;
}

// Paper Portfolio Types
export interface PaperHolding {
  asset: string;
  symbol: string;
  amount: number;
  valueUsdc: number;
  price: number;
  priceChange24h: number;
  allocationPct: number;
}

export interface PaperPortfolio {
  totalValueUsdc: number;
  availableUsdc: number;
  holdings: PaperHolding[];
  dailyPnl: number;
  dailyPnlPct: number;
}

export interface PaperTradeRecord {
  id: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  total: number;
  fee: number;
  source: string;
  createdAt: string;
}

export interface PortfolioHolding {
  symbol: string;
  asset: string;
  amount: number;
  valueUsdt: number;
  price: number;
  priceChange24h: number;
  allocationPct: number;
}

export interface Portfolio {
  totalValueUsdt: number;
  availableUsdt: number;
  holdings: PortfolioHolding[];
  dailyPnl: number;
  dailyPnlPct: number;
}

export interface PriceData {
  symbol: string;
  price: number;
  change24h: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
}

export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
}

export interface TradeRecord {
  id: string;
  userId: string;
  botId: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: string;
  quantity: number;
  price: number | null;
  filledPrice: number | null;
  total: number | null;
  fee: number;
  feeAsset: string | null;
  status: string;
  binanceOrderId: string | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  notes: string | null;
  createdAt: Date;
  filledAt: Date | null;
}

// Trading Rule Types (Visual Builder)
export interface RuleConditionRecord {
  id: string;
  type: 'price' | 'indicator' | 'time' | 'change';
  symbol?: string;
  indicator?: string;
  timeframe?: string;
  operator: string;
  value: number;
}

export interface RuleActionRecord {
  id: string;
  type: 'buy' | 'sell' | 'alert';
  symbol?: string;
  amountType: 'quote' | 'base' | 'percent';
  amount: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface TradingRuleRecord {
  id?: string;
  name: string;
  description: string;
  enabled: boolean;
  conditionLogic: 'AND' | 'OR';
  conditions: RuleConditionRecord[];
  actions: RuleActionRecord[];
  maxExecutions?: number;
  cooldownMinutes?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type BotType = 'grid' | 'dca' | 'rsi' | 'ma_crossover' | 'macd' | 'breakout' | 'mean_reversion' | 'momentum' | 'custom';

export interface BotConfig {
  id: string;
  userId: string;
  name: string;
  type: BotType;
  symbol: string;
  config: Record<string, unknown>;
  status: 'running' | 'stopped' | 'error' | 'paused';
  lastError: string | null;
  totalProfit: number;
  totalTrades: number;
  winRate: number;
  marketType: 'spot' | 'alpha';
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  stoppedAt: Date | null;
}

// Alpha Token Types
export interface AlphaToken {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  chain: string;
  contractAddress?: string;
  logoUrl?: string;
}

export interface AlphaHolding {
  symbol: string;
  name: string;
  amount: number;
  valueUsdt: number;
  price: number;
  priceChange24h: number;
  chain: string;
  marketCap: number;
  liquidity: number;
}

export interface CombinedPortfolio {
  spot: Portfolio | null;
  alpha: AlphaHolding[];
  totalValueUsdt: number;
}

// Bot Template Types
export interface BotParameterDefinition {
  name: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  required: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string | number; label: string }>;
  description: string;
  helpText?: string;
}

export interface BotExampleScenario {
  title: string;
  description: string;
  config: Record<string, unknown>;
  expectedOutcome: string;
}

export interface BotTemplate {
  type: BotType;
  name: string;
  icon: string;
  shortDescription: string;
  description: string;
  howItWorks: string;
  bestFor: string[];
  risks: string[];
  parameters: BotParameterDefinition[];
  examples: BotExampleScenario[];
  tips: string[];
  warnings: string[];
  recommendedSettings: {
    conservative: Record<string, unknown>;
    moderate: Record<string, unknown>;
    aggressive: Record<string, unknown>;
  };
}

export interface ResearchSettings {
  executionMode: 'auto' | 'confirm' | 'manual';
  paperLiveMode: 'paper' | 'live';
  enableAutoDiscovery: boolean;
  autoDiscoveryLimit: number;
  customSymbols: string[];
  minConfidence: number;
  // Exit order settings
  stopLossPct: number;
  takeProfitPct: number;
  takeProfit2Pct: number | null;
  trailingStopPct: number | null;
  positionSizeUsdt: number;
  positionPct: number; // Position size as % of portfolio for live mode
  maxPositions: number; // Max concurrent positions
}

export interface AutoTradingSettings {
  enabled: boolean;
  maxPositions: number;
  rsiThreshold: number;
  volumeMultiplier: number;
  minPositionPct: number;
  maxPositionPct: number;
  dailyLossLimitPct: number;
  maxConsecutiveLosses: number;
  symbolCooldownMinutes: number;
  minProfitPct: number;
  // Fixed USD position sizing
  minPositionUsd?: number;
  maxPositionUsd?: number;
  strategy: 'rsi_oversold' | 'trend_following' | 'mean_reversion' | 'momentum' | 'btc_correlation';
  strategyMode: 'manual' | 'auto';
  excludedSymbols: string[];
  excludeTop10: boolean;
  btcTrendFilter: boolean;
  btcMomentumBoost: boolean;
  btcCorrelationSkip: boolean;
  currentStrategy?: 'rsi_oversold' | 'trend_following' | 'mean_reversion' | 'momentum' | 'btc_correlation';
  // Dual-mode settings
  dualModeEnabled?: boolean;
  conservativeCapitalPct?: number;
  aggressiveCapitalPct?: number;
  trailingEnabled?: boolean;
  trailActivationPct?: number;
  trailDistancePct?: number;
  initialStopLossPct?: number;
  conservativeSymbols?: string[];
  aggressiveSymbols?: string[];
  conservativeMinConfidence?: number;
  aggressiveMinConfidence?: number;
}

export interface AutoTradingState {
  isRunning: boolean;
  isPaused: boolean;
  pauseReason: string | null;
  dailyPnlUsd: number;
  dailyPnlPct: number;
  consecutiveLosses: number;
  activePositions: number;
  tradesCount: number;
  winsCount: number;
  lossesCount: number;
}

export interface MarketRegime {
  regime: 'trending' | 'ranging' | 'volatile' | 'mixed';
  confidence: number;
  btcTrend?: string;
}

export interface StrategyInfo {
  id: string;
  meta: {
    id: string;
    name: string;
    description: string;
    suitableRegimes: string[];
    requiredIndicators: string[];
  };
  performance?: {
    winRate: number;
    totalTrades: number;
    avgProfit: number;
  };
}

export interface OrphanPosition {
  symbol: string;
  asset: string;
  amount: number;
  valueUsd: number;
  currentPrice: number;
  hasActiveTrade: boolean;
  trailingStopAdded: boolean;
}

export interface ReconciliationResult {
  orphanPositions: OrphanPosition[];
  missingFromPortfolio: string[];
  reconciled: number;
  lastReconcileAt: string;
}

export interface ResearchSignal {
  id: string;
  symbol: string;
  price: number;
  rsi1m?: number;
  rsi5m?: number;
  rsi15m?: number;
  priceDropPct?: number;
  volumeRatio?: number;
  confidence: number;
  reasons: string[];
  status: 'pending' | 'executed' | 'skipped' | 'expired' | 'failed';
  executionMode: string;
  paperLiveMode: string;
  createdAt: string;
  indicators?: {
    rsi: { value1m: number; value5m: number; value15m: number };
    macd: { value: number; signal: number; histogram: number; crossover: string | null };
    bollinger: { percentB: number; squeeze: boolean };
    ema: { trend: string; crossover: string | null };
    volume: { ratio: number; spike: boolean };
  };
  confidenceBreakdown?: {
    rsi: number;
    macd: number;
    bollinger: number;
    ema: number;
    volume: number;
    priceAction: number;
    total: number;
  };
}

export interface ResearchMetrics {
  research: {
    totalSignals: number;
    executed: number;
    skipped: number;
    expired: number;
    successRate: number;
    avgConfidence: number;
  };
  scalping: {
    paper: { trades: number; winRate: number; totalPnl: number; avgPnl: number };
    live: { trades: number; winRate: number; totalPnl: number; avgPnl: number };
    patterns: { key: string; winRate: number; trades: number; modifier: number }[];
  };
}

// Indicator Settings
export interface IndicatorWeights {
  rsi: number;
  macd: number;
  bollinger: number;
  ema: number;
  volume: number;
  priceAction: number;
}

export interface IndicatorSettings {
  userId: string;
  preset: 'conservative' | 'balanced' | 'aggressive' | 'custom';
  enableRsi: boolean;
  enableMacd: boolean;
  enableBollinger: boolean;
  enableEma: boolean;
  enableVolume: boolean;
  enablePriceAction: boolean;
  weights: IndicatorWeights;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerStddev: number;
  emaShort: number;
  emaMedium: number;
  emaLong: number;
  volumeAvgPeriod: number;
  volumeSpikeThreshold: number;
  minConfidence: number;
}

export interface IndicatorPreset {
  weights: IndicatorWeights;
  minConfidence: number;
}

export interface TradingStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
}

export interface ConditionalOrderAction {
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  amountType: 'quantity' | 'percentage' | 'quote';
  amount: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStopPct?: number;
  trailingStopDollar?: number;
}

export interface ConditionalOrder {
  id: string;
  userId: string;
  symbol: string;
  condition: 'above' | 'below' | 'crosses_up' | 'crosses_down';
  triggerPrice: number;
  action: ConditionalOrderAction;
  status: 'active' | 'triggered' | 'cancelled' | 'expired';
  expiresAt?: string;
  triggeredAt?: string;
  createdAt: string;
}

export interface CreateConditionalOrderParams {
  symbol: string;
  condition: 'above' | 'below' | 'crosses_up' | 'crosses_down';
  triggerPrice: number;
  action: ConditionalOrderAction;
  expiresInHours?: number;
}

// Trading API
export const tradingApi = {
  // Connection
  connect: (
    apiKey: string,
    apiSecret: string,
    exchange: ExchangeType = 'binance',
    marginEnabled: boolean = false,
    leverage: number = 1
  ) =>
    api<{ success: boolean; canTrade: boolean; error?: string }>('/api/trading/connect', {
      method: 'POST',
      body: { apiKey, apiSecret, exchange, marginEnabled, leverage },
    }),

  disconnect: () =>
    api<{ success: boolean }>('/api/trading/disconnect', { method: 'POST' }),

  getExchangeType: () =>
    api<{ exchange: ExchangeType | null }>('/api/trading/exchange'),

  // Margin Trading (Crypto.com only)
  getMarginLeverage: () =>
    api<{ leverage: number }>('/api/trading/margin/leverage'),

  setMarginLeverage: (leverage: number) =>
    api<{ success: boolean; leverage: number }>('/api/trading/margin/leverage', {
      method: 'PUT',
      body: { leverage },
    }),

  getMarginBalance: () =>
    api<MarginAccountInfo>('/api/trading/margin/balance'),

  getMarginPositions: () =>
    api<{ positions: MarginPosition[] }>('/api/trading/margin/positions'),

  placeMarginOrder: (params: {
    symbol: string;
    side: 'long' | 'short';
    type: 'market' | 'limit';
    quantity?: number;
    quoteAmount?: number;
    price?: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
  }) =>
    api<TradeRecord>('/api/trading/margin/order', { method: 'POST', body: params }),

  closeMarginPosition: (symbol: string, side: 'long' | 'short') =>
    api<TradeRecord>('/api/trading/margin/close', { method: 'POST', body: { symbol, side } }),

  // Settings
  getSettings: () =>
    api<TradingSettings>('/api/trading/settings'),

  updateSettings: (updates: Partial<Omit<TradingSettings, 'userId'>>) =>
    api<TradingSettings>('/api/trading/settings', { method: 'PUT', body: updates }),

  // Portfolio & Prices
  getPortfolio: () =>
    api<Portfolio>('/api/trading/portfolio'),

  getPrices: (symbols?: string[]) =>
    api<PriceData[]>(`/api/trading/prices${symbols ? `?symbols=${symbols.join(',')}` : ''}`),

  getKlines: (symbol: string, interval: string, limit?: number) =>
    api<Kline[]>(`/api/trading/klines/${symbol}?interval=${interval}${limit ? `&limit=${limit}` : ''}`),

  // Trading
  getTrades: (limit?: number) =>
    api<TradeRecord[]>(`/api/trading/trades${limit ? `?limit=${limit}` : ''}`),

  placeOrder: (params: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    quantity?: number;
    quoteAmount?: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    notes?: string;
  }) =>
    api<TradeRecord>('/api/trading/order', { method: 'POST', body: params }),

  cancelOrder: (tradeId: string) =>
    api<{ success: boolean }>(`/api/trading/order/${tradeId}`, { method: 'DELETE' }),

  getStats: (days?: number) =>
    api<TradingStats>(`/api/trading/stats${days ? `?days=${days}` : ''}`),

  // Active Trades (ACTIVE Tab)
  getActiveTrades: () =>
    api<ActiveTradesResponse>('/api/trading/active'),

  updateTradeSLTP: (tradeId: string, params: UpdateTradeSLTPParams) =>
    api<TradeRecord>(`/api/trading/trades/${tradeId}/exits`, { method: 'PATCH', body: params }),

  partialClose: (tradeId: string, quantity: number) =>
    api<TradeRecord>(`/api/trading/trades/${tradeId}/partial-close`, { method: 'POST', body: { quantity } }),

  stopTrade: (tradeId: string, skipConfirmation?: boolean) =>
    api<StopTradeResponse>(`/api/trading/trades/${tradeId}/stop`, {
      method: 'POST',
      body: { skipConfirmation: skipConfirmation || false },
    }),

  // Bots
  getBots: () =>
    api<BotConfig[]>('/api/trading/bots'),

  createBot: (config: {
    name: string;
    type: BotType;
    symbol: string;
    config: Record<string, unknown>;
    marketType?: 'spot' | 'alpha';
  }) =>
    api<BotConfig>('/api/trading/bots', { method: 'POST', body: config }),

  updateBotStatus: (botId: string, status: 'running' | 'stopped' | 'paused') =>
    api<{ success: boolean }>(`/api/trading/bots/${botId}/status`, { method: 'PATCH', body: { status } }),

  deleteBot: (botId: string) =>
    api<{ success: boolean }>(`/api/trading/bots/${botId}`, { method: 'DELETE' }),

  // Bot Templates
  getBotTemplates: () =>
    api<{ templates: BotTemplate[] }>('/api/trading/bots/templates'),

  getBotTemplate: (type: BotType) =>
    api<{ template: BotTemplate }>(`/api/trading/bots/templates/${type}`),

  getRecommendedBotSettings: (type: BotType, symbol: string, riskProfile?: 'conservative' | 'moderate' | 'aggressive') =>
    api<{ settings: Record<string, unknown>; analysis: string }>('/api/trading/bots/recommended', {
      method: 'POST',
      body: { type, symbol, riskProfile },
    }),

  // Alpha Tokens
  getAlphaTokens: (limit?: number) =>
    api<{ tokens: AlphaToken[] }>(`/api/trading/alpha/tokens${limit ? `?limit=${limit}` : ''}`),

  getAlphaPrices: (symbols: string[]) =>
    api<{ prices: Array<{ symbol: string; price: number; change24h: number }> }>(`/api/trading/alpha/prices?symbols=${symbols.join(',')}`),

  searchAlphaTokens: (query: string) =>
    api<{ tokens: AlphaToken[] }>(`/api/trading/alpha/search?q=${encodeURIComponent(query)}`),

  getHotAlphaTokens: () =>
    api<{ tokens: AlphaToken[] }>('/api/trading/alpha/hot'),

  getTopAlphaByVolume: (limit?: number) =>
    api<{ tokens: AlphaToken[] }>(`/api/trading/alpha/top-volume${limit ? `?limit=${limit}` : ''}`),

  // Combined Portfolio (Spot + Alpha)
  getCombinedPortfolio: () =>
    api<CombinedPortfolio>('/api/trading/portfolio/combined'),

  // Trading Chat
  createChatSession: () =>
    api<{ sessionId: string }>('/api/trading/chat/session', { method: 'POST' }),

  getChatMessages: (sessionId: string) =>
    api<Array<{ role: string; content: string }>>(`/api/trading/chat/session/${sessionId}/messages`),

  sendChatMessage: (sessionId: string, message: string) =>
    api<{ messageId: string; content: string; tokensUsed: number; display?: DisplayContent; tradeExecuted?: boolean }>(
      `/api/trading/chat/session/${sessionId}/send`,
      { method: 'POST', body: { message } }
    ),

  // Research Mode
  getResearchSettings: () =>
    api<ResearchSettings>('/api/trading/research/settings'),

  updateResearchSettings: (updates: Partial<ResearchSettings>) =>
    api<ResearchSettings>('/api/trading/research/settings', { method: 'PUT', body: updates }),

  getResearchSignals: (limit?: number) =>
    api<ResearchSignal[]>(`/api/trading/research/signals${limit ? `?limit=${limit}` : ''}`),

  getResearchMetrics: (days?: number) =>
    api<ResearchMetrics>(`/api/trading/research/metrics${days ? `?days=${days}` : ''}`),

  getTopPairs: (limit?: number) =>
    api<{ pairs: string[] }>(`/api/trading/research/top-pairs${limit ? `?limit=${limit}` : ''}`),

  executeSignal: (signalId: string) =>
    api<{ success: boolean; result?: string }>(`/api/trading/research/execute/${signalId}`, { method: 'POST' }),

  confirmSignal: (signalId: string, action: 'execute' | 'skip') =>
    api<{ success: boolean; result?: string }>(`/api/trading/research/confirm/${signalId}`, {
      method: 'POST',
      body: { action },
    }),

  // Indicator Settings
  getIndicatorSettings: () =>
    api<IndicatorSettings>('/api/trading/research/indicators'),

  updateIndicatorSettings: (updates: Partial<Omit<IndicatorSettings, 'userId'>>) =>
    api<IndicatorSettings>('/api/trading/research/indicators', { method: 'PUT', body: updates }),

  getIndicatorPresets: () =>
    api<Record<string, IndicatorPreset>>('/api/trading/research/indicators/presets'),

  applyIndicatorPreset: (preset: 'conservative' | 'balanced' | 'aggressive') =>
    api<IndicatorSettings>('/api/trading/research/indicators/preset', { method: 'POST', body: { preset } }),

  // Trade Rules (Conditional Orders)
  getRules: (status?: string) =>
    api<ConditionalOrder[]>(`/api/trading/rules${status ? `?status=${status}` : ''}`),

  createRule: (params: CreateConditionalOrderParams) =>
    api<ConditionalOrder>('/api/trading/rules', { method: 'POST', body: params }),

  cancelRule: (id: string) =>
    api<{ success: boolean }>(`/api/trading/rules/${id}`, { method: 'DELETE' }),

  // Paper Trading
  getPaperPortfolio: () =>
    api<PaperPortfolio>('/api/trading/paper-portfolio'),

  resetPaperPortfolio: () =>
    api<{ success: boolean; portfolio: PaperPortfolio }>('/api/trading/paper-portfolio/reset', { method: 'POST' }),

  getPaperTrades: (limit?: number, source?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit.toString());
    if (source) params.set('source', source);
    const query = params.toString();
    return api<PaperTradeRecord[]>(`/api/trading/paper-trades${query ? `?${query}` : ''}`);
  },

  // Advanced Signal Settings (V2 Features)
  getAdvancedSettings: () =>
    api<AdvancedSignalSettings>('/api/trading/settings/advanced'),

  updateAdvancedSettings: (updates: Partial<Omit<AdvancedSignalSettings, 'userId'>>) =>
    api<AdvancedSignalSettings>('/api/trading/settings/advanced', { method: 'PUT', body: updates }),

  applyFeaturePreset: (preset: 'basic' | 'intermediate' | 'pro') =>
    api<AdvancedSignalSettings>('/api/trading/settings/preset', { method: 'PUT', body: { preset } }),

  getFeaturePresets: () =>
    api<{
      presets: Record<string, { enableMtfConfluence: boolean; enableVwapEntry: boolean; enableAtrStops: boolean; enableBtcFilter: boolean; enableLiquiditySweep: boolean }>;
      descriptions: Record<string, string>;
    }>('/api/trading/settings/presets'),

  // Auto Trading
  getAutoTradingSettings: () =>
    api<{ settings: AutoTradingSettings }>('/api/trading/auto/settings').then(r => r.settings),

  updateAutoTradingSettings: (updates: Partial<AutoTradingSettings>) =>
    api<{ success: boolean; settings: AutoTradingSettings }>('/api/trading/auto/settings', { method: 'PUT', body: updates }),

  getAutoTradingState: () =>
    api<{ state: AutoTradingState }>('/api/trading/auto/state'),

  startAutoTrading: () =>
    api<{ success: boolean; state: AutoTradingState }>('/api/trading/auto/start', { method: 'POST' }),

  stopAutoTrading: () =>
    api<{ success: boolean; state: AutoTradingState }>('/api/trading/auto/stop', { method: 'POST' }),

  getMarketRegime: () =>
    api<{ regime: MarketRegime }>('/api/trading/auto/regime'),

  getAutoTradingStrategies: () =>
    api<{ strategies: StrategyInfo[] }>('/api/trading/auto/strategies'),

  reconcilePortfolio: () =>
    api<ReconciliationResult>('/api/trading/auto/reconcile', { method: 'POST' }),

  // Trading Rules (Visual Builder)
  getTradingRules: () =>
    api<{ rules: TradingRuleRecord[] }>('/api/trading/trading-rules'),

  saveTradingRule: (rule: TradingRuleRecord) =>
    api<{ success: boolean; rule: TradingRuleRecord }>('/api/trading/trading-rules', {
      method: rule.id ? 'PUT' : 'POST',
      body: rule,
    }),

  deleteTradingRule: (id: string) =>
    api<{ success: boolean }>(`/api/trading/trading-rules/${id}`, { method: 'DELETE' }),
};
