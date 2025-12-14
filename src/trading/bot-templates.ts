/**
 * Bot Templates
 *
 * Comprehensive template definitions for all trading bot types.
 * Includes descriptions, parameter definitions, and recommended settings.
 */

export type BotType = 'grid' | 'dca' | 'rsi' | 'ma_crossover' | 'macd' | 'breakout' | 'mean_reversion' | 'momentum' | 'custom';

export interface ParameterDefinition {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string | number; label: string }>;
  required?: boolean;
}

export interface ExampleScenario {
  title: string;
  description: string;
  settings: Record<string, unknown>;
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
  parameters: ParameterDefinition[];
  examples: ExampleScenario[];
  tips: string[];
  warnings: string[];
  recommendedSettings: {
    conservative: Record<string, unknown>;
    moderate: Record<string, unknown>;
    aggressive: Record<string, unknown>;
  };
}

// ============================================
// Bot Template Definitions
// ============================================

export const BOT_TEMPLATES: Record<BotType, BotTemplate> = {
  grid: {
    type: 'grid',
    name: 'Grid Trading Bot',
    icon: 'Grid3X3',
    shortDescription: 'Buy low, sell high within a price range automatically',
    description: 'A grid trading bot divides your investment across multiple price levels, automatically buying when prices drop and selling when they rise within your defined range.',
    howItWorks: `Grid trading works by placing buy and sell orders at regular intervals (grids) within a price range:

1. You define an upper and lower price boundary
2. The bot divides this range into equal grid levels
3. When price drops to a grid level, it buys
4. When price rises to the next grid level, it sells
5. This captures profits from price oscillations

The bot profits from volatility within the range, regardless of overall market direction.`,
    bestFor: [
      'Ranging or sideways markets',
      'High volatility assets',
      'Passive income from price swings',
      'Assets trading between support and resistance',
    ],
    risks: [
      'Significant losses if price breaks out of range permanently',
      'Capital locked in grid positions',
      'Trading fees accumulate with many small trades',
      'Opportunity cost if asset trends strongly in one direction',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to trade (e.g., BTCUSDC)',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'upperPrice',
        label: 'Upper Price',
        description: 'The highest price in your grid range. Set this at a resistance level.',
        type: 'number',
        default: 100000,
        min: 0,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'lowerPrice',
        label: 'Lower Price',
        description: 'The lowest price in your grid range. Set this at a support level.',
        type: 'number',
        default: 90000,
        min: 0,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'gridCount',
        label: 'Number of Grids',
        description: 'How many grid levels to create. More grids = more trades but smaller profits per trade.',
        type: 'number',
        default: 10,
        min: 2,
        max: 50,
        step: 1,
        required: true,
      },
      {
        key: 'totalInvestment',
        label: 'Total Investment',
        description: 'Total amount to invest across all grid levels.',
        type: 'number',
        default: 1000,
        min: 10,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'mode',
        label: 'Grid Mode',
        description: 'Arithmetic: equal price gaps. Geometric: equal percentage gaps (better for volatile assets).',
        type: 'select',
        default: 'arithmetic',
        options: [
          { value: 'arithmetic', label: 'Arithmetic (Equal $)' },
          { value: 'geometric', label: 'Geometric (Equal %)' },
        ],
      },
      {
        key: 'trailingStopPct',
        label: 'Trailing Stop %',
        description: 'Optional: Close all positions if price drops this % from peak. Leave empty to disable.',
        type: 'number',
        default: null,
        min: 0.5,
        max: 50,
        step: 0.5,
        unit: '%',
      },
    ],
    examples: [
      {
        title: 'BTC Sideways Market',
        description: 'BTC ranging between $90,000 and $100,000',
        settings: {
          symbol: 'BTCUSDC',
          upperPrice: 100000,
          lowerPrice: 90000,
          gridCount: 10,
          totalInvestment: 1000,
          mode: 'arithmetic',
        },
      },
      {
        title: 'ETH Volatile Range',
        description: 'ETH with high volatility in a wider range',
        settings: {
          symbol: 'ETHUSDC',
          upperPrice: 4500,
          lowerPrice: 3500,
          gridCount: 20,
          totalInvestment: 2000,
          mode: 'geometric',
        },
      },
    ],
    tips: [
      'Set your range based on strong support and resistance levels',
      'Start with 5-10 grids and adjust based on results',
      'Use geometric mode for assets with high volatility',
      'Monitor the range - adjust if price breaks boundaries',
      'Consider fees when setting grid count (more grids = more fees)',
    ],
    warnings: [
      'Grid bots can lose money if price permanently breaks out of your range',
      'Do not use during strong trending markets',
      'Ensure you have enough capital for all grid levels',
    ],
    recommendedSettings: {
      conservative: {
        gridCount: 5,
        totalInvestment: 500,
        mode: 'arithmetic',
      },
      moderate: {
        gridCount: 10,
        totalInvestment: 1000,
        mode: 'arithmetic',
      },
      aggressive: {
        gridCount: 20,
        totalInvestment: 2000,
        mode: 'geometric',
      },
    },
  },

  dca: {
    type: 'dca',
    name: 'DCA Bot (Dollar-Cost Averaging)',
    icon: 'Calendar',
    shortDescription: 'Automatically buy at regular intervals to average your entry price',
    description: 'A DCA bot makes regular purchases at fixed intervals, regardless of price. This strategy reduces the impact of volatility by averaging your entry price over time.',
    howItWorks: `Dollar-Cost Averaging works by spreading purchases over time:

1. You set a fixed amount to invest per purchase
2. You choose an interval (e.g., every 24 hours)
3. The bot automatically buys at each interval
4. Your average entry price smooths out over time

This removes emotional decision-making and reduces timing risk.`,
    bestFor: [
      'Long-term accumulation',
      'Reducing timing risk',
      'Building positions in volatile markets',
      'Passive investing without watching charts',
    ],
    risks: [
      'May buy at higher prices in strong uptrends',
      'Capital deployed slowly - may miss rapid rallies',
      'Fees accumulate with frequent small purchases',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to accumulate',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'amountPerPurchase',
        label: 'Amount Per Purchase',
        description: 'How much to invest in each purchase',
        type: 'number',
        default: 100,
        min: 10,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'intervalHours',
        label: 'Interval (Hours)',
        description: 'Time between each purchase',
        type: 'number',
        default: 24,
        min: 1,
        max: 720,
        step: 1,
        unit: 'hours',
        required: true,
      },
      {
        key: 'totalPurchases',
        label: 'Total Purchases',
        description: 'Number of purchases to make before stopping. Set to 0 for unlimited.',
        type: 'number',
        default: 30,
        min: 0,
        max: 365,
        step: 1,
        required: true,
      },
    ],
    examples: [
      {
        title: 'Daily BTC Accumulation',
        description: '$100 daily for 30 days',
        settings: {
          symbol: 'BTCUSDC',
          amountPerPurchase: 100,
          intervalHours: 24,
          totalPurchases: 30,
        },
      },
      {
        title: 'Hourly ETH Micro-DCA',
        description: '$10 every hour for rapid accumulation',
        settings: {
          symbol: 'ETHUSDC',
          amountPerPurchase: 10,
          intervalHours: 1,
          totalPurchases: 168,
        },
      },
    ],
    tips: [
      'DCA works best for assets you believe in long-term',
      'Shorter intervals smooth out volatility more but increase fees',
      'Consider pausing during extreme market conditions',
      'Combine with a take-profit strategy for exits',
    ],
    warnings: [
      'DCA does not guarantee profits - the asset must eventually rise',
      'You may accumulate at higher prices during bull runs',
    ],
    recommendedSettings: {
      conservative: {
        amountPerPurchase: 50,
        intervalHours: 168, // Weekly
        totalPurchases: 52,
      },
      moderate: {
        amountPerPurchase: 100,
        intervalHours: 24, // Daily
        totalPurchases: 30,
      },
      aggressive: {
        amountPerPurchase: 50,
        intervalHours: 4, // Every 4 hours
        totalPurchases: 180,
      },
    },
  },

  rsi: {
    type: 'rsi',
    name: 'RSI Bot',
    icon: 'Activity',
    shortDescription: 'Buy when oversold (RSI low), sell when overbought (RSI high)',
    description: 'An RSI bot uses the Relative Strength Index indicator to identify oversold (good to buy) and overbought (good to sell) conditions.',
    howItWorks: `RSI (Relative Strength Index) measures momentum on a scale of 0-100:

1. RSI below 30 = Oversold (potential buy signal)
2. RSI above 70 = Overbought (potential sell signal)
3. The bot monitors RSI continuously
4. When RSI hits your thresholds, it executes trades
5. A cooldown prevents overtrading

RSI works best in ranging markets where price oscillates.`,
    bestFor: [
      'Mean reversion trading',
      'Ranging markets with clear oscillations',
      'Catching bounces from oversold conditions',
      'Taking profits at overbought levels',
    ],
    risks: [
      'RSI can stay oversold/overbought in strong trends',
      'False signals in trending markets',
      'May sell too early in strong rallies',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to trade',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'interval',
        label: 'Timeframe',
        description: 'Candlestick interval for RSI calculation',
        type: 'select',
        default: '15m',
        options: [
          { value: '1m', label: '1 Minute' },
          { value: '5m', label: '5 Minutes' },
          { value: '15m', label: '15 Minutes' },
          { value: '1h', label: '1 Hour' },
          { value: '4h', label: '4 Hours' },
        ],
        required: true,
      },
      {
        key: 'oversoldThreshold',
        label: 'Oversold Threshold',
        description: 'RSI below this = buy signal. Lower = stronger signal but fewer trades.',
        type: 'number',
        default: 30,
        min: 10,
        max: 40,
        step: 1,
        required: true,
      },
      {
        key: 'overboughtThreshold',
        label: 'Overbought Threshold',
        description: 'RSI above this = sell signal. Higher = stronger signal but fewer trades.',
        type: 'number',
        default: 70,
        min: 60,
        max: 90,
        step: 1,
        required: true,
      },
      {
        key: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much to trade when a signal triggers',
        type: 'number',
        default: 100,
        min: 10,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'cooldownMinutes',
        label: 'Cooldown (Minutes)',
        description: 'Minimum time between trades to prevent overtrading',
        type: 'number',
        default: 60,
        min: 5,
        max: 1440,
        step: 5,
        unit: 'minutes',
        required: true,
      },
      {
        key: 'trailingStopPct',
        label: 'Trailing Stop %',
        description: 'Optional: Protect profits with a trailing stop on buys',
        type: 'number',
        default: null,
        min: 0.5,
        max: 20,
        step: 0.5,
        unit: '%',
      },
    ],
    examples: [
      {
        title: 'Conservative RSI',
        description: 'Strict thresholds, longer cooldown',
        settings: {
          symbol: 'BTCUSDC',
          interval: '1h',
          oversoldThreshold: 25,
          overboughtThreshold: 75,
          amountPerTrade: 100,
          cooldownMinutes: 120,
        },
      },
      {
        title: 'Active RSI Trading',
        description: 'Looser thresholds, shorter timeframe',
        settings: {
          symbol: 'ETHUSDC',
          interval: '15m',
          oversoldThreshold: 35,
          overboughtThreshold: 65,
          amountPerTrade: 50,
          cooldownMinutes: 30,
        },
      },
    ],
    tips: [
      'Use longer timeframes (1h, 4h) for stronger signals',
      'Combine with trend analysis - RSI works best in ranging markets',
      'Set cooldown based on your timeframe to avoid overtrading',
      'Consider volume confirmation for stronger signals',
    ],
    warnings: [
      'RSI can generate false signals in strong trending markets',
      'Do not rely solely on RSI - consider other factors',
      'Assets can stay oversold/overbought longer than expected',
    ],
    recommendedSettings: {
      conservative: {
        interval: '4h',
        oversoldThreshold: 25,
        overboughtThreshold: 75,
        amountPerTrade: 100,
        cooldownMinutes: 240,
      },
      moderate: {
        interval: '1h',
        oversoldThreshold: 30,
        overboughtThreshold: 70,
        amountPerTrade: 100,
        cooldownMinutes: 60,
      },
      aggressive: {
        interval: '15m',
        oversoldThreshold: 35,
        overboughtThreshold: 65,
        amountPerTrade: 100,
        cooldownMinutes: 15,
      },
    },
  },

  ma_crossover: {
    type: 'ma_crossover',
    name: 'MA Crossover Bot',
    icon: 'TrendingUp',
    shortDescription: 'Trade based on moving average crossovers for trend following',
    description: 'A moving average crossover bot identifies trend changes by watching when a fast MA crosses above or below a slow MA.',
    howItWorks: `Moving Average Crossover detects trend changes:

1. Two moving averages are calculated (fast and slow)
2. Golden Cross: Fast MA crosses ABOVE slow MA = Buy signal (uptrend starting)
3. Death Cross: Fast MA crosses BELOW slow MA = Sell signal (downtrend starting)
4. The bot monitors for these crossover events
5. Trades are executed when crossovers occur

This is a classic trend-following strategy.`,
    bestFor: [
      'Trending markets',
      'Catching major trend reversals',
      'Medium to long-term trading',
      'Reducing noise from short-term fluctuations',
    ],
    risks: [
      'Lagging indicator - signals come after the move starts',
      'Whipsaws in sideways markets',
      'May miss the best entry points',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to trade',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'interval',
        label: 'Timeframe',
        description: 'Candlestick interval for MA calculation',
        type: 'select',
        default: '1h',
        options: [
          { value: '15m', label: '15 Minutes' },
          { value: '1h', label: '1 Hour' },
          { value: '4h', label: '4 Hours' },
          { value: '1d', label: '1 Day' },
        ],
        required: true,
      },
      {
        key: 'fastPeriod',
        label: 'Fast MA Period',
        description: 'Periods for the fast (short-term) moving average',
        type: 'number',
        default: 9,
        min: 3,
        max: 50,
        step: 1,
        required: true,
      },
      {
        key: 'slowPeriod',
        label: 'Slow MA Period',
        description: 'Periods for the slow (long-term) moving average',
        type: 'number',
        default: 21,
        min: 10,
        max: 200,
        step: 1,
        required: true,
      },
      {
        key: 'maType',
        label: 'MA Type',
        description: 'Type of moving average. EMA reacts faster to recent prices.',
        type: 'select',
        default: 'ema',
        options: [
          { value: 'sma', label: 'Simple (SMA)' },
          { value: 'ema', label: 'Exponential (EMA)' },
        ],
      },
      {
        key: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much to trade per signal',
        type: 'number',
        default: 200,
        min: 10,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'cooldownMinutes',
        label: 'Cooldown (Minutes)',
        description: 'Minimum time between trades',
        type: 'number',
        default: 60,
        min: 5,
        max: 1440,
        unit: 'minutes',
        required: true,
      },
      {
        key: 'trailingStopPct',
        label: 'Trailing Stop %',
        description: 'Optional: Protect position with trailing stop',
        type: 'number',
        default: null,
        min: 1,
        max: 20,
        step: 0.5,
        unit: '%',
      },
    ],
    examples: [
      {
        title: 'Classic 9/21 EMA',
        description: 'Popular fast-reacting crossover setup',
        settings: {
          symbol: 'BTCUSDC',
          interval: '1h',
          fastPeriod: 9,
          slowPeriod: 21,
          maType: 'ema',
          amountPerTrade: 200,
          cooldownMinutes: 60,
        },
      },
      {
        title: 'Golden Cross (50/200)',
        description: 'Long-term trend following',
        settings: {
          symbol: 'BTCUSDC',
          interval: '1d',
          fastPeriod: 50,
          slowPeriod: 200,
          maType: 'sma',
          amountPerTrade: 500,
          cooldownMinutes: 1440,
        },
      },
    ],
    tips: [
      'Use longer timeframes for fewer but stronger signals',
      'EMA reacts faster but may generate more false signals',
      'Classic combinations: 9/21, 12/26, 50/200',
      'Confirm crossovers with volume for better accuracy',
    ],
    warnings: [
      'MA crossovers lag - you will not catch exact tops/bottoms',
      'Sideways markets cause frequent whipsaws (false signals)',
      'Consider adding a trend filter to avoid ranging market signals',
    ],
    recommendedSettings: {
      conservative: {
        interval: '4h',
        fastPeriod: 20,
        slowPeriod: 50,
        maType: 'sma',
        amountPerTrade: 200,
        cooldownMinutes: 240,
      },
      moderate: {
        interval: '1h',
        fastPeriod: 9,
        slowPeriod: 21,
        maType: 'ema',
        amountPerTrade: 200,
        cooldownMinutes: 60,
      },
      aggressive: {
        interval: '15m',
        fastPeriod: 5,
        slowPeriod: 13,
        maType: 'ema',
        amountPerTrade: 150,
        cooldownMinutes: 30,
      },
    },
  },

  macd: {
    type: 'macd',
    name: 'MACD Bot',
    icon: 'BarChart2',
    shortDescription: 'Trade MACD crossovers and divergences for momentum signals',
    description: 'A MACD bot uses the Moving Average Convergence Divergence indicator to identify momentum shifts and potential trend reversals.',
    howItWorks: `MACD measures momentum through two lines:

1. MACD Line = 12-period EMA minus 26-period EMA
2. Signal Line = 9-period EMA of MACD Line
3. Bullish Signal: MACD crosses ABOVE Signal Line
4. Bearish Signal: MACD crosses BELOW Signal Line
5. The histogram shows the difference between lines

MACD combines trend and momentum in one indicator.`,
    bestFor: [
      'Identifying momentum shifts',
      'Confirming trend changes',
      'Finding divergences between price and momentum',
      'Medium-term trading',
    ],
    risks: [
      'Lagging indicator like all MAs',
      'False signals in choppy markets',
      'May miss early parts of moves',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to trade',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'interval',
        label: 'Timeframe',
        description: 'Candlestick interval for MACD calculation',
        type: 'select',
        default: '1h',
        options: [
          { value: '15m', label: '15 Minutes' },
          { value: '1h', label: '1 Hour' },
          { value: '4h', label: '4 Hours' },
          { value: '1d', label: '1 Day' },
        ],
        required: true,
      },
      {
        key: 'fastPeriod',
        label: 'Fast Period',
        description: 'Fast EMA period (standard: 12)',
        type: 'number',
        default: 12,
        min: 5,
        max: 30,
        step: 1,
        required: true,
      },
      {
        key: 'slowPeriod',
        label: 'Slow Period',
        description: 'Slow EMA period (standard: 26)',
        type: 'number',
        default: 26,
        min: 15,
        max: 50,
        step: 1,
        required: true,
      },
      {
        key: 'signalPeriod',
        label: 'Signal Period',
        description: 'Signal line EMA period (standard: 9)',
        type: 'number',
        default: 9,
        min: 3,
        max: 20,
        step: 1,
        required: true,
      },
      {
        key: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much to trade per signal',
        type: 'number',
        default: 150,
        min: 10,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'cooldownMinutes',
        label: 'Cooldown (Minutes)',
        description: 'Minimum time between trades',
        type: 'number',
        default: 60,
        min: 5,
        max: 1440,
        unit: 'minutes',
        required: true,
      },
      {
        key: 'trailingStopPct',
        label: 'Trailing Stop %',
        description: 'Optional: Protect position with trailing stop',
        type: 'number',
        default: null,
        min: 1,
        max: 20,
        step: 0.5,
        unit: '%',
      },
    ],
    examples: [
      {
        title: 'Standard MACD (12/26/9)',
        description: 'Classic MACD settings',
        settings: {
          symbol: 'BTCUSDC',
          interval: '1h',
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9,
          amountPerTrade: 150,
          cooldownMinutes: 60,
        },
      },
    ],
    tips: [
      'Standard settings (12/26/9) work well for most assets',
      'Use higher timeframes for stronger signals',
      'Watch for divergences between MACD and price',
      'Histogram can show momentum strength',
    ],
    warnings: [
      'MACD lags price - signals come after moves start',
      'Multiple false signals in ranging markets',
      'Consider trend direction before trading signals',
    ],
    recommendedSettings: {
      conservative: {
        interval: '4h',
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        amountPerTrade: 150,
        cooldownMinutes: 240,
      },
      moderate: {
        interval: '1h',
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        amountPerTrade: 150,
        cooldownMinutes: 60,
      },
      aggressive: {
        interval: '15m',
        fastPeriod: 8,
        slowPeriod: 17,
        signalPeriod: 9,
        amountPerTrade: 100,
        cooldownMinutes: 30,
      },
    },
  },

  breakout: {
    type: 'breakout',
    name: 'Breakout Bot',
    icon: 'Zap',
    shortDescription: 'Catch price breakouts from consolidation ranges',
    description: 'A breakout bot identifies when price breaks out of a consolidation range with volume confirmation, entering trades in the direction of the breakout.',
    howItWorks: `Breakout trading catches explosive moves:

1. Identify a consolidation range (recent high/low)
2. Wait for price to break above resistance or below support
3. Confirm with volume spike (higher than average)
4. Enter trade in breakout direction
5. Set stop-loss just inside the broken level

Breakouts often lead to strong directional moves.`,
    bestFor: [
      'Catching major price moves',
      'Trading after consolidation periods',
      'Volatile assets with clear ranges',
      'Momentum trading',
    ],
    risks: [
      'False breakouts (price reverses back into range)',
      'Slippage on fast breakouts',
      'May enter late after move has started',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to trade',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'interval',
        label: 'Timeframe',
        description: 'Candlestick interval for range calculation',
        type: 'select',
        default: '1h',
        options: [
          { value: '15m', label: '15 Minutes' },
          { value: '1h', label: '1 Hour' },
          { value: '4h', label: '4 Hours' },
        ],
        required: true,
      },
      {
        key: 'lookbackPeriod',
        label: 'Lookback Period',
        description: 'Number of candles to calculate range (e.g., 20 candles = 20-hour range on 1h)',
        type: 'number',
        default: 20,
        min: 5,
        max: 100,
        step: 1,
        required: true,
      },
      {
        key: 'breakoutThreshold',
        label: 'Breakout Threshold %',
        description: 'How far price must break beyond range to trigger (reduces false breakouts)',
        type: 'number',
        default: 0.5,
        min: 0.1,
        max: 5,
        step: 0.1,
        unit: '%',
        required: true,
      },
      {
        key: 'volumeMultiplier',
        label: 'Volume Multiplier',
        description: 'Required volume vs average (e.g., 1.5 = 50% above average)',
        type: 'number',
        default: 1.5,
        min: 1,
        max: 5,
        step: 0.1,
        required: true,
      },
      {
        key: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much to trade per breakout',
        type: 'number',
        default: 200,
        min: 10,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'cooldownMinutes',
        label: 'Cooldown (Minutes)',
        description: 'Minimum time between trades',
        type: 'number',
        default: 120,
        min: 5,
        max: 1440,
        unit: 'minutes',
        required: true,
      },
      {
        key: 'trailingStopPct',
        label: 'Trailing Stop %',
        description: 'Protect breakout profits with trailing stop',
        type: 'number',
        default: 2.5,
        min: 0.5,
        max: 20,
        step: 0.5,
        unit: '%',
      },
    ],
    examples: [
      {
        title: 'Standard Breakout',
        description: 'Conservative breakout settings',
        settings: {
          symbol: 'BTCUSDC',
          interval: '1h',
          lookbackPeriod: 20,
          breakoutThreshold: 0.5,
          volumeMultiplier: 1.5,
          amountPerTrade: 200,
          cooldownMinutes: 120,
          trailingStopPct: 2.5,
        },
      },
    ],
    tips: [
      'Higher breakout threshold reduces false signals',
      'Volume confirmation is crucial - no volume = likely false breakout',
      'Use trailing stops to capture extended moves',
      'Best after clear consolidation periods',
    ],
    warnings: [
      'Many breakouts fail (false breakouts) - use volume confirmation',
      'Slippage can be significant on fast moves',
      'Do not chase breakouts that have already moved significantly',
    ],
    recommendedSettings: {
      conservative: {
        interval: '4h',
        lookbackPeriod: 30,
        breakoutThreshold: 1.0,
        volumeMultiplier: 2.0,
        amountPerTrade: 200,
        cooldownMinutes: 240,
        trailingStopPct: 3,
      },
      moderate: {
        interval: '1h',
        lookbackPeriod: 20,
        breakoutThreshold: 0.5,
        volumeMultiplier: 1.5,
        amountPerTrade: 200,
        cooldownMinutes: 120,
        trailingStopPct: 2.5,
      },
      aggressive: {
        interval: '15m',
        lookbackPeriod: 15,
        breakoutThreshold: 0.3,
        volumeMultiplier: 1.3,
        amountPerTrade: 150,
        cooldownMinutes: 60,
        trailingStopPct: 2,
      },
    },
  },

  mean_reversion: {
    type: 'mean_reversion',
    name: 'Mean Reversion Bot',
    icon: 'RefreshCw',
    shortDescription: 'Buy dips below the moving average, sell rallies above',
    description: 'A mean reversion bot trades on the assumption that price tends to return to its average. It buys when price is significantly below the MA and sells when significantly above.',
    howItWorks: `Mean reversion assumes price returns to average:

1. Calculate a moving average (the "mean")
2. Measure how far price deviates from the mean
3. When price drops X% below MA, buy (expecting return to mean)
4. When price rises X% above MA, sell (expecting return to mean)
5. Set position size based on deviation magnitude

This works well in ranging markets with stable averages.`,
    bestFor: [
      'Ranging markets',
      'Assets with stable long-term averages',
      'Catching overshoots in both directions',
      'Statistical edge trading',
    ],
    risks: [
      'Significant losses in trending markets',
      'Price may not return to mean quickly',
      '"The market can stay irrational longer than you can stay solvent"',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to trade',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'interval',
        label: 'Timeframe',
        description: 'Candlestick interval for MA calculation',
        type: 'select',
        default: '1h',
        options: [
          { value: '15m', label: '15 Minutes' },
          { value: '1h', label: '1 Hour' },
          { value: '4h', label: '4 Hours' },
        ],
        required: true,
      },
      {
        key: 'maPeriod',
        label: 'MA Period',
        description: 'Period for the moving average (the mean)',
        type: 'number',
        default: 20,
        min: 5,
        max: 100,
        step: 1,
        required: true,
      },
      {
        key: 'deviationThreshold',
        label: 'Deviation Threshold %',
        description: 'How far from MA before triggering (e.g., 2% below/above MA)',
        type: 'number',
        default: 2,
        min: 0.5,
        max: 10,
        step: 0.5,
        unit: '%',
        required: true,
      },
      {
        key: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much to trade per signal',
        type: 'number',
        default: 150,
        min: 10,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'cooldownMinutes',
        label: 'Cooldown (Minutes)',
        description: 'Minimum time between trades',
        type: 'number',
        default: 60,
        min: 5,
        max: 1440,
        unit: 'minutes',
        required: true,
      },
      {
        key: 'trailingStopPct',
        label: 'Trailing Stop %',
        description: 'Optional: Emergency stop if deviation continues',
        type: 'number',
        default: 5,
        min: 1,
        max: 20,
        step: 0.5,
        unit: '%',
      },
    ],
    examples: [
      {
        title: 'Standard Mean Reversion',
        description: 'Trade 2% deviations from 20-period MA',
        settings: {
          symbol: 'BTCUSDC',
          interval: '1h',
          maPeriod: 20,
          deviationThreshold: 2,
          amountPerTrade: 150,
          cooldownMinutes: 60,
          trailingStopPct: 5,
        },
      },
    ],
    tips: [
      'Works best in ranging markets - avoid during strong trends',
      'Higher deviation threshold = fewer but stronger signals',
      'Use a stop-loss to protect against extended deviations',
      'Consider market regime before deploying',
    ],
    warnings: [
      'Can lose heavily in trending markets',
      'Price may deviate further before returning',
      'Always use stop-losses with mean reversion strategies',
    ],
    recommendedSettings: {
      conservative: {
        interval: '4h',
        maPeriod: 30,
        deviationThreshold: 3,
        amountPerTrade: 150,
        cooldownMinutes: 240,
        trailingStopPct: 6,
      },
      moderate: {
        interval: '1h',
        maPeriod: 20,
        deviationThreshold: 2,
        amountPerTrade: 150,
        cooldownMinutes: 60,
        trailingStopPct: 5,
      },
      aggressive: {
        interval: '15m',
        maPeriod: 15,
        deviationThreshold: 1.5,
        amountPerTrade: 100,
        cooldownMinutes: 30,
        trailingStopPct: 4,
      },
    },
  },

  momentum: {
    type: 'momentum',
    name: 'Momentum Bot',
    icon: 'Rocket',
    shortDescription: 'Ride strong price movements with momentum confirmation',
    description: 'A momentum bot identifies and trades strong directional price movements, using RSI and volume to confirm momentum strength.',
    howItWorks: `Momentum trading rides strong moves:

1. Monitor RSI for momentum strength (not oversold/overbought)
2. RSI 50-70 with rising = bullish momentum
3. RSI 30-50 with falling = bearish momentum
4. Confirm with volume above average
5. Enter in momentum direction
6. Exit when momentum weakens or reverses

"The trend is your friend" - momentum follows existing moves.`,
    bestFor: [
      'Trending markets',
      'Strong directional moves',
      'Riding breakouts and continuations',
      'Active trading',
    ],
    risks: [
      'Late entries near trend exhaustion',
      'Quick reversals can cause losses',
      'Requires active management',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to trade',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'interval',
        label: 'Timeframe',
        description: 'Candlestick interval for momentum calculation',
        type: 'select',
        default: '15m',
        options: [
          { value: '5m', label: '5 Minutes' },
          { value: '15m', label: '15 Minutes' },
          { value: '1h', label: '1 Hour' },
        ],
        required: true,
      },
      {
        key: 'rsiPeriod',
        label: 'RSI Period',
        description: 'Period for RSI calculation',
        type: 'number',
        default: 14,
        min: 7,
        max: 21,
        step: 1,
        required: true,
      },
      {
        key: 'momentumThreshold',
        label: 'Momentum Threshold',
        description: 'RSI above this = bullish, below (100-this) = bearish',
        type: 'number',
        default: 55,
        min: 50,
        max: 70,
        step: 1,
        required: true,
      },
      {
        key: 'volumeConfirmation',
        label: 'Require Volume Confirmation',
        description: 'Only trade when volume is above average',
        type: 'boolean',
        default: true,
      },
      {
        key: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much to trade per signal',
        type: 'number',
        default: 150,
        min: 10,
        unit: 'USDC',
        required: true,
      },
      {
        key: 'cooldownMinutes',
        label: 'Cooldown (Minutes)',
        description: 'Minimum time between trades',
        type: 'number',
        default: 30,
        min: 5,
        max: 1440,
        unit: 'minutes',
        required: true,
      },
      {
        key: 'trailingStopPct',
        label: 'Trailing Stop %',
        description: 'Protect momentum trades with trailing stop',
        type: 'number',
        default: 2,
        min: 0.5,
        max: 10,
        step: 0.5,
        unit: '%',
      },
    ],
    examples: [
      {
        title: 'Active Momentum',
        description: 'Catch strong moves with volume confirmation',
        settings: {
          symbol: 'BTCUSDC',
          interval: '15m',
          rsiPeriod: 14,
          momentumThreshold: 55,
          volumeConfirmation: true,
          amountPerTrade: 150,
          cooldownMinutes: 30,
          trailingStopPct: 2,
        },
      },
    ],
    tips: [
      'Best in trending markets with clear direction',
      'Volume confirmation reduces false signals',
      'Use tight trailing stops to protect gains',
      'Exit when momentum weakens (RSI moving toward 50)',
    ],
    warnings: [
      'Momentum can reverse quickly - always use stops',
      'Late entries risk buying near tops / selling near bottoms',
      'Not suitable for ranging markets',
    ],
    recommendedSettings: {
      conservative: {
        interval: '1h',
        rsiPeriod: 14,
        momentumThreshold: 60,
        volumeConfirmation: true,
        amountPerTrade: 150,
        cooldownMinutes: 60,
        trailingStopPct: 3,
      },
      moderate: {
        interval: '15m',
        rsiPeriod: 14,
        momentumThreshold: 55,
        volumeConfirmation: true,
        amountPerTrade: 150,
        cooldownMinutes: 30,
        trailingStopPct: 2,
      },
      aggressive: {
        interval: '5m',
        rsiPeriod: 10,
        momentumThreshold: 52,
        volumeConfirmation: false,
        amountPerTrade: 100,
        cooldownMinutes: 15,
        trailingStopPct: 1.5,
      },
    },
  },

  custom: {
    type: 'custom',
    name: 'Custom Bot',
    icon: 'Settings',
    shortDescription: 'Create a custom trading strategy with your own parameters',
    description: 'A custom bot allows you to define your own trading logic and parameters. Advanced users can create unique strategies.',
    howItWorks: `Custom bots let you define your own rules:

1. Specify your entry and exit conditions
2. Set your own parameters
3. Define risk management rules
4. The bot executes based on your configuration

This is for advanced users who understand trading strategy design.`,
    bestFor: [
      'Advanced traders',
      'Unique strategy requirements',
      'Combining multiple indicators',
      'Testing custom ideas',
    ],
    risks: [
      'Requires deep trading knowledge',
      'Misconfiguration can lead to losses',
      'No built-in safety rails',
    ],
    parameters: [
      {
        key: 'symbol',
        label: 'Trading Pair',
        description: 'The cryptocurrency pair to trade',
        type: 'string',
        default: 'BTCUSDC',
        required: true,
      },
      {
        key: 'config',
        label: 'Custom Configuration',
        description: 'JSON configuration for your custom strategy',
        type: 'string',
        default: '{}',
        required: true,
      },
    ],
    examples: [],
    tips: [
      'Start with paper trading to test your strategy',
      'Document your strategy logic clearly',
      'Include proper risk management',
    ],
    warnings: [
      'Custom bots have no built-in safety features',
      'Test thoroughly before using real funds',
      'You are responsible for your strategy design',
    ],
    recommendedSettings: {
      conservative: {},
      moderate: {},
      aggressive: {},
    },
  },
};

/**
 * Get all bot templates
 */
export function getAllBotTemplates(): BotTemplate[] {
  return Object.values(BOT_TEMPLATES);
}

/**
 * Get a specific bot template by type
 */
export function getBotTemplate(type: BotType): BotTemplate | undefined {
  return BOT_TEMPLATES[type];
}

/**
 * Get recommended settings for a bot type and risk profile
 */
export function getRecommendedSettings(
  type: BotType,
  riskProfile: 'conservative' | 'moderate' | 'aggressive'
): Record<string, unknown> {
  const template = BOT_TEMPLATES[type];
  if (!template) return {};
  return template.recommendedSettings[riskProfile] || {};
}

export default BOT_TEMPLATES;
