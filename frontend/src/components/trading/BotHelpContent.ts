/**
 * Bot Help Content
 * Comprehensive documentation for all trading bot types
 */

import type { BotType } from '@/lib/api';

export interface BotHelpParameter {
  name: string;
  label: string;
  description: string;
  example?: string;
  tip?: string;
}

export interface BotHelpExample {
  title: string;
  scenario: string;
  config: Record<string, unknown>;
  expectedResult: string;
}

export interface BotHelpContent {
  type: BotType;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  howItWorks: string[];
  bestFor: string[];
  notBestFor: string[];
  parameters: BotHelpParameter[];
  examples: BotHelpExample[];
  tips: string[];
  warnings: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export const BOT_HELP_CONTENT: Record<BotType, BotHelpContent> = {
  grid: {
    type: 'grid',
    name: 'Grid Trading',
    icon: '📊',
    tagline: 'Profit from sideways markets',
    description: 'Grid trading places multiple buy and sell orders at regular price intervals within a defined range. When price moves up, it sells. When price moves down, it buys. This creates consistent small profits in ranging markets.',
    howItWorks: [
      'You define a price range (upper and lower bounds)',
      'The bot divides this range into equal "grids"',
      'Buy orders are placed at each grid level below current price',
      'Sell orders are placed at each grid level above current price',
      'When price crosses a grid line, the bot executes and places a new order in the opposite direction',
      'Each completed buy-sell cycle earns profit equal to grid spacing',
    ],
    bestFor: [
      'Sideways/ranging markets with clear support and resistance',
      'Stable trading pairs with consistent price oscillation',
      'Markets with high volatility within a predictable range',
      'Traders who want hands-off automated trading',
    ],
    notBestFor: [
      'Strong trending markets (breakouts cause losses)',
      'Highly volatile assets with unpredictable movements',
      'Low liquidity trading pairs',
    ],
    parameters: [
      {
        name: 'upperPrice',
        label: 'Upper Price',
        description: 'The top of your grid range. Price above this stops the bot.',
        example: 'If BTC is at $95,000, you might set upper to $100,000',
        tip: 'Set based on recent resistance levels or ATH',
      },
      {
        name: 'lowerPrice',
        label: 'Lower Price',
        description: 'The bottom of your grid range. Price below this stops the bot.',
        example: 'If BTC is at $95,000, you might set lower to $90,000',
        tip: 'Set based on recent support levels',
      },
      {
        name: 'gridCount',
        label: 'Number of Grids',
        description: 'How many price levels to divide the range into. More grids = more frequent smaller trades.',
        example: '10 grids in a $10,000 range = $1,000 per grid',
        tip: 'More grids need more capital but capture more price movements',
      },
      {
        name: 'totalInvestment',
        label: 'Total Investment',
        description: 'The total amount in USDT to allocate to this bot.',
        example: '$1,000 with 10 grids = ~$100 per grid level',
        tip: 'Start small to test your strategy before scaling up',
      },
    ],
    examples: [
      {
        title: 'Conservative BTC Grid',
        scenario: 'BTC is ranging between $90,000 and $100,000',
        config: {
          upperPrice: 100000,
          lowerPrice: 90000,
          gridCount: 10,
          totalInvestment: 1000,
        },
        expectedResult: 'Each completed cycle earns ~$10 profit. In active range, expect 2-5 cycles per day.',
      },
      {
        title: 'Tight ETH Range',
        scenario: 'ETH consolidating around $3,000',
        config: {
          upperPrice: 3200,
          lowerPrice: 2800,
          gridCount: 20,
          totalInvestment: 2000,
        },
        expectedResult: 'Smaller $20 grids capture more frequent movements with $5 profit per cycle.',
      },
    ],
    tips: [
      'Start with a range that covers recent price action (30-day high/low)',
      'More grids means more trades but requires more capital',
      'Monitor and adjust the range if market conditions change',
      'Consider the trading fees in your profit calculations',
    ],
    warnings: [
      'If price breaks out of your range, the bot stops working',
      'Strong downtrends can leave you holding depreciated assets',
      'Do not set ranges too wide - reduces profit frequency',
    ],
    riskLevel: 'medium',
  },

  dca: {
    type: 'dca',
    name: 'Dollar Cost Average',
    icon: '📈',
    tagline: 'Steady accumulation over time',
    description: 'DCA automatically buys a fixed amount at regular intervals, regardless of price. This strategy reduces the impact of volatility by spreading purchases over time, resulting in an average purchase price.',
    howItWorks: [
      'You set a purchase amount and interval (hourly, daily, weekly)',
      'The bot automatically buys at each interval',
      'Over time, you accumulate at an average price',
      'Works whether prices go up, down, or sideways',
    ],
    bestFor: [
      'Long-term accumulation of assets you believe in',
      'Reducing emotional decision-making',
      'Building positions without timing the market',
      'Converting regular income into crypto',
    ],
    notBestFor: [
      'Short-term trading or quick profits',
      'Markets you expect to crash',
      'Traders who want active involvement',
    ],
    parameters: [
      {
        name: 'amountPerBuy',
        label: 'Amount Per Buy',
        description: 'How much USDT to spend on each purchase.',
        example: '$50 per buy',
        tip: 'Consider your total budget and desired accumulation period',
      },
      {
        name: 'intervalMinutes',
        label: 'Interval (minutes)',
        description: 'Time between purchases. 60 = hourly, 1440 = daily, 10080 = weekly.',
        example: '1440 for daily buys',
        tip: 'Daily or weekly is recommended for most accumulation strategies',
      },
      {
        name: 'maxTotalInvestment',
        label: 'Max Total Investment',
        description: 'Optional cap on total investment. Bot stops when reached.',
        example: '$5,000 total cap',
        tip: 'Set based on your total budget for this asset',
      },
    ],
    examples: [
      {
        title: 'Daily BTC Accumulation',
        scenario: 'Building BTC position over 3 months',
        config: {
          amountPerBuy: 33,
          intervalMinutes: 1440,
          maxTotalInvestment: 3000,
        },
        expectedResult: '$33/day for 90 days = $2,970 invested, averaging out BTC price fluctuations.',
      },
      {
        title: 'Weekly ETH Strategy',
        scenario: 'Accumulating ETH from weekly paycheck',
        config: {
          amountPerBuy: 100,
          intervalMinutes: 10080,
          maxTotalInvestment: 5200,
        },
        expectedResult: '$100/week for a year = $5,200 in ETH at averaged prices.',
      },
    ],
    tips: [
      'DCA works best over long periods (months to years)',
      'Set it and forget it - that is the power of DCA',
      'Only DCA into assets you believe in long-term',
      'Combine with other strategies for selling',
    ],
    warnings: [
      'Does not protect against long-term price declines',
      'May underperform lump sum in strong bull markets',
      'Requires patience - results take time',
    ],
    riskLevel: 'low',
  },

  rsi: {
    type: 'rsi',
    name: 'RSI Strategy',
    icon: '📉',
    tagline: 'Buy oversold, sell overbought',
    description: 'RSI (Relative Strength Index) measures momentum on a 0-100 scale. This bot buys when RSI indicates oversold conditions (typically below 30) and sells when overbought (typically above 70).',
    howItWorks: [
      'RSI calculates recent price momentum (14 periods typical)',
      'RSI below 30 = oversold (potential bounce)',
      'RSI above 70 = overbought (potential drop)',
      'Bot buys when RSI crosses below your buy threshold',
      'Bot sells when RSI crosses above your sell threshold',
    ],
    bestFor: [
      'Range-bound markets with regular oscillations',
      'Assets that tend to mean-revert',
      'Catching local bottoms and tops',
    ],
    notBestFor: [
      'Strong trending markets (RSI can stay extreme for long periods)',
      'Highly volatile assets with unpredictable movements',
      'Breakout situations',
    ],
    parameters: [
      {
        name: 'rsiPeriod',
        label: 'RSI Period',
        description: 'Number of candles used to calculate RSI. Standard is 14.',
        example: '14 periods',
        tip: 'Lower periods are more sensitive, higher are smoother',
      },
      {
        name: 'buyThreshold',
        label: 'Buy Threshold',
        description: 'RSI level below which to buy. Traditional oversold is 30.',
        example: '30 for standard, 25 for more conservative',
        tip: 'Lower values mean fewer but potentially better entries',
      },
      {
        name: 'sellThreshold',
        label: 'Sell Threshold',
        description: 'RSI level above which to sell. Traditional overbought is 70.',
        example: '70 for standard, 75 for more conservative',
        tip: 'Higher values mean holding for potentially larger gains',
      },
      {
        name: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much USDT to use for each buy signal.',
        example: '$100 per trade',
      },
    ],
    examples: [
      {
        title: 'Standard RSI Strategy',
        scenario: 'Trading BTC with classic RSI parameters',
        config: {
          rsiPeriod: 14,
          buyThreshold: 30,
          sellThreshold: 70,
          amountPerTrade: 100,
        },
        expectedResult: 'Buy when RSI dips below 30, sell when it rises above 70.',
      },
      {
        title: 'Aggressive RSI',
        scenario: 'More frequent trades with tighter thresholds',
        config: {
          rsiPeriod: 7,
          buyThreshold: 35,
          sellThreshold: 65,
          amountPerTrade: 50,
        },
        expectedResult: 'More signals with faster RSI and tighter thresholds.',
      },
    ],
    tips: [
      'Combine RSI with support/resistance for better entries',
      'In strong trends, RSI can stay overbought/oversold for weeks',
      'Consider using multiple timeframes for confirmation',
      'Lower timeframes = more signals but more noise',
    ],
    warnings: [
      'RSI is a lagging indicator - it follows price',
      'Can generate false signals in trending markets',
      'Does not work well during strong momentum phases',
    ],
    riskLevel: 'medium',
  },

  ma_crossover: {
    type: 'ma_crossover',
    name: 'Moving Average Crossover',
    icon: '〰️',
    tagline: 'Follow the trend',
    description: 'This strategy uses two moving averages - a faster one and a slower one. When the fast MA crosses above the slow MA (golden cross), it signals a buy. When it crosses below (death cross), it signals a sell.',
    howItWorks: [
      'Two moving averages track price: fast (short-term) and slow (long-term)',
      'Fast MA crossing above slow MA = uptrend starting (buy signal)',
      'Fast MA crossing below slow MA = downtrend starting (sell signal)',
      'Can use Simple (SMA) or Exponential (EMA) moving averages',
    ],
    bestFor: [
      'Trending markets with clear directional moves',
      'Catching medium to long-term trends',
      'Filtering out short-term noise',
    ],
    notBestFor: [
      'Choppy, sideways markets (causes whipsaws)',
      'Short-term scalping',
      'Highly volatile ranging markets',
    ],
    parameters: [
      {
        name: 'fastPeriod',
        label: 'Fast MA Period',
        description: 'Period for the faster moving average.',
        example: '9 or 20 for EMA, 50 for SMA',
        tip: 'Common pairs: 9/21, 20/50, 50/200',
      },
      {
        name: 'slowPeriod',
        label: 'Slow MA Period',
        description: 'Period for the slower moving average.',
        example: '21 or 50 for EMA, 200 for SMA',
        tip: 'Larger gap between periods = fewer but stronger signals',
      },
      {
        name: 'maType',
        label: 'MA Type',
        description: 'Simple (SMA) or Exponential (EMA) moving average.',
        example: 'EMA for more responsive, SMA for smoother',
        tip: 'EMA reacts faster to recent prices',
      },
      {
        name: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much USDT to use for each signal.',
        example: '$200 per trade',
      },
    ],
    examples: [
      {
        title: 'Classic Golden Cross',
        scenario: 'Following major trend changes',
        config: {
          fastPeriod: 50,
          slowPeriod: 200,
          maType: 'sma',
          amountPerTrade: 500,
        },
        expectedResult: 'Catches major trend reversals but few signals.',
      },
      {
        title: 'Fast EMA Cross',
        scenario: 'More active trading with EMAs',
        config: {
          fastPeriod: 9,
          slowPeriod: 21,
          maType: 'ema',
          amountPerTrade: 100,
        },
        expectedResult: 'More frequent signals, good for swing trading.',
      },
    ],
    tips: [
      'Use longer periods for fewer but more reliable signals',
      'EMA crosses respond faster but can have more false signals',
      'Combine with volume confirmation for better accuracy',
      'Consider the overall market trend before trading crosses',
    ],
    warnings: [
      'Whipsaws in ranging markets can cause repeated losses',
      'Moving averages lag - you will miss exact tops and bottoms',
      'False signals are common in choppy markets',
    ],
    riskLevel: 'medium',
  },

  macd: {
    type: 'macd',
    name: 'MACD Strategy',
    icon: '📶',
    tagline: 'Momentum meets trend',
    description: 'MACD (Moving Average Convergence Divergence) combines trend and momentum. It uses the relationship between two EMAs to generate signals. When MACD line crosses above signal line, it is bullish. Below is bearish.',
    howItWorks: [
      'MACD line = Fast EMA minus Slow EMA (typically 12 and 26)',
      'Signal line = 9-period EMA of MACD line',
      'Histogram = MACD minus Signal (visual momentum)',
      'Buy when MACD crosses above signal line',
      'Sell when MACD crosses below signal line',
    ],
    bestFor: [
      'Identifying momentum shifts in trending markets',
      'Confirming trend direction',
      'Medium-term trading (days to weeks)',
    ],
    notBestFor: [
      'Highly volatile sideways markets',
      'Very short-term scalping',
      'Range-bound assets',
    ],
    parameters: [
      {
        name: 'fastPeriod',
        label: 'Fast EMA Period',
        description: 'Period for the fast EMA. Standard is 12.',
        example: '12 for standard MACD',
      },
      {
        name: 'slowPeriod',
        label: 'Slow EMA Period',
        description: 'Period for the slow EMA. Standard is 26.',
        example: '26 for standard MACD',
      },
      {
        name: 'signalPeriod',
        label: 'Signal Period',
        description: 'Period for the signal line EMA. Standard is 9.',
        example: '9 for standard MACD',
      },
      {
        name: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much USDT to use for each signal.',
      },
    ],
    examples: [
      {
        title: 'Standard MACD',
        scenario: 'Classic MACD settings for crypto',
        config: {
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9,
          amountPerTrade: 200,
        },
        expectedResult: 'Reliable momentum signals in trending markets.',
      },
    ],
    tips: [
      'Look for histogram expansion to confirm momentum',
      'Divergence between price and MACD can signal reversals',
      'Use with longer timeframes for more reliable signals',
      'Zero-line crossovers are significant trend confirmations',
    ],
    warnings: [
      'MACD is a lagging indicator',
      'Can give false signals in ranging markets',
      'Histogram direction changes before crossovers',
    ],
    riskLevel: 'medium',
  },

  breakout: {
    type: 'breakout',
    name: 'Breakout Trading',
    icon: '🚀',
    tagline: 'Catch the move when it starts',
    description: 'Breakout trading captures moves when price breaks through defined support or resistance levels. The bot monitors key levels and enters when price breaks out with confirmation.',
    howItWorks: [
      'You define a resistance level (upper breakout) and support level (lower breakout)',
      'Bot monitors price relative to these levels',
      'When price breaks above resistance with volume, it buys',
      'When price breaks below support, it sells or exits',
      'Uses lookback period to calculate dynamic levels',
    ],
    bestFor: [
      'Consolidation periods before big moves',
      'Assets building energy in tight ranges',
      'Catching the start of new trends',
    ],
    notBestFor: [
      'Ranging markets with many false breakouts',
      'Low volatility, stable assets',
      'Without volume confirmation',
    ],
    parameters: [
      {
        name: 'lookbackPeriod',
        label: 'Lookback Period',
        description: 'Number of candles to calculate high/low range.',
        example: '20 candles (20 hours on 1h chart)',
      },
      {
        name: 'breakoutThreshold',
        label: 'Breakout Threshold %',
        description: 'How far price must exceed the range to trigger.',
        example: '0.5% above the high',
        tip: 'Higher threshold reduces false breakouts',
      },
      {
        name: 'volumeMultiplier',
        label: 'Volume Multiplier',
        description: 'Required volume increase for confirmation.',
        example: '1.5x average volume',
        tip: 'Volume confirms breakout strength',
      },
      {
        name: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much USDT to use for breakout entries.',
      },
    ],
    examples: [
      {
        title: 'Range Breakout',
        scenario: 'BTC consolidating for a week',
        config: {
          lookbackPeriod: 168,
          breakoutThreshold: 1.0,
          volumeMultiplier: 1.5,
          amountPerTrade: 300,
        },
        expectedResult: 'Catches breakouts from weekly consolidation patterns.',
      },
    ],
    tips: [
      'Wait for candle close above/below level for confirmation',
      'Volume is crucial - weak volume breakouts often fail',
      'Use tight stop-loss just below the breakout level',
      'Consider retests of breakout level as secondary entries',
    ],
    warnings: [
      'False breakouts (fakeouts) are common',
      'Can whipsaw in ranging markets',
      'Requires good support/resistance identification',
    ],
    riskLevel: 'high',
  },

  mean_reversion: {
    type: 'mean_reversion',
    name: 'Mean Reversion',
    icon: '🎯',
    tagline: 'Price returns to average',
    description: 'Mean reversion bets that price will return to its average after extreme moves. Using Bollinger Bands, the bot buys when price touches the lower band (oversold) and sells at the upper band (overbought).',
    howItWorks: [
      'Bollinger Bands create upper and lower channels around a moving average',
      'Band width expands with volatility, contracts in calm markets',
      'Price touching lower band = potentially oversold, buy signal',
      'Price touching upper band = potentially overbought, sell signal',
      'Most effective when bands are relatively narrow (low volatility)',
    ],
    bestFor: [
      'Range-bound markets with clear boundaries',
      'Assets that tend to oscillate around a mean',
      'Low to moderate volatility environments',
    ],
    notBestFor: [
      'Strong trending markets',
      'Highly volatile, unpredictable assets',
      'During major news events',
    ],
    parameters: [
      {
        name: 'bbPeriod',
        label: 'Bollinger Period',
        description: 'Moving average period for Bollinger Bands. Standard is 20.',
        example: '20 periods',
      },
      {
        name: 'bbStdDev',
        label: 'Standard Deviations',
        description: 'Band width in standard deviations. Standard is 2.',
        example: '2.0 for standard bands',
        tip: 'Higher = wider bands, fewer but stronger signals',
      },
      {
        name: 'rsiConfirm',
        label: 'RSI Confirmation',
        description: 'Require RSI confirmation for entries.',
        example: 'true for extra safety',
        tip: 'Adds RSI filter to reduce false signals',
      },
      {
        name: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much USDT to use for each trade.',
      },
    ],
    examples: [
      {
        title: 'Standard Mean Reversion',
        scenario: 'ETH ranging in a channel',
        config: {
          bbPeriod: 20,
          bbStdDev: 2.0,
          rsiConfirm: true,
          amountPerTrade: 150,
        },
        expectedResult: 'Buy at lower band with RSI oversold, sell at upper band.',
      },
    ],
    tips: [
      'Works best when Bollinger Bands are relatively flat',
      'Avoid during band squeeze (volatility compression)',
      'Combine with RSI or other indicators for confirmation',
      'Exit if price breaks through and stays outside bands',
    ],
    warnings: [
      'Strong trends can keep price at extreme bands',
      'Band touch does not guarantee reversal',
      'Can catch falling knives in downtrends',
    ],
    riskLevel: 'medium',
  },

  momentum: {
    type: 'momentum',
    name: 'Momentum Trading',
    icon: '⚡',
    tagline: 'Ride the strong moves',
    description: 'Momentum trading follows the direction of strong price movements. This bot identifies assets with strong momentum (using RSI and volume) and trades in the direction of that momentum.',
    howItWorks: [
      'Monitors RSI for momentum strength',
      'Checks volume for confirmation',
      'Buys when upward momentum is strong (RSI rising, high volume)',
      'Sells when momentum weakens or reverses',
      'Uses trailing stop to protect profits',
    ],
    bestFor: [
      'Trending markets with clear direction',
      'Breakout situations with volume',
      'Assets showing strong price action',
    ],
    notBestFor: [
      'Sideways, choppy markets',
      'Low liquidity assets',
      'During uncertainty or consolidation',
    ],
    parameters: [
      {
        name: 'rsiPeriod',
        label: 'RSI Period',
        description: 'Period for momentum measurement.',
        example: '14 periods',
      },
      {
        name: 'momentumThreshold',
        label: 'Momentum Threshold',
        description: 'Minimum RSI for momentum confirmation.',
        example: '55 for buy signals (rising momentum)',
      },
      {
        name: 'volumeMultiplier',
        label: 'Volume Multiplier',
        description: 'Required volume increase for entry.',
        example: '1.5x average volume',
      },
      {
        name: 'trailingStopPct',
        label: 'Trailing Stop %',
        description: 'Trailing stop-loss percentage.',
        example: '3% trailing stop',
        tip: 'Protects profits while allowing room to run',
      },
      {
        name: 'amountPerTrade',
        label: 'Amount Per Trade',
        description: 'How much USDT to use for each trade.',
      },
    ],
    examples: [
      {
        title: 'Momentum Chaser',
        scenario: 'Catching strong crypto moves',
        config: {
          rsiPeriod: 14,
          momentumThreshold: 55,
          volumeMultiplier: 1.5,
          trailingStopPct: 3,
          amountPerTrade: 200,
        },
        expectedResult: 'Enters on strong moves, trails profits with 3% stop.',
      },
    ],
    tips: [
      'Momentum can last longer than expected - do not exit too early',
      'Volume confirmation is crucial for valid signals',
      'Trailing stops protect profits while staying in winners',
      'Works best in trending market conditions',
    ],
    warnings: [
      'Reversals can be sharp and sudden',
      'Can enter late in the move',
      'Requires active monitoring',
    ],
    riskLevel: 'high',
  },

  custom: {
    type: 'custom',
    name: 'Custom Strategy',
    icon: '🔧',
    tagline: 'Build your own approach',
    description: 'Custom strategies allow you to define your own trading logic with Luna. Describe your strategy and Luna will help configure it with the appropriate parameters.',
    howItWorks: [
      'Describe your trading idea to Luna',
      'Luna helps translate it into bot parameters',
      'Combines multiple indicators and conditions',
      'Fully customizable entry and exit rules',
    ],
    bestFor: [
      'Experienced traders with specific strategies',
      'Testing unique trading ideas',
      'Combining multiple indicators',
    ],
    notBestFor: [
      'Beginners (start with preset strategies)',
      'Unvalidated strategy ideas',
    ],
    parameters: [
      {
        name: 'customConfig',
        label: 'Custom Configuration',
        description: 'Your custom strategy configuration defined with Luna.',
        tip: 'Ask Luna to help you create a custom strategy',
      },
    ],
    examples: [
      {
        title: 'Custom Strategy',
        scenario: 'Work with Luna to define your approach',
        config: {},
        expectedResult: 'Luna helps you configure a custom strategy based on your requirements.',
      },
    ],
    tips: [
      'Clearly define your entry and exit rules',
      'Start with paper trading to test your idea',
      'Keep it simple - complexity does not mean better',
      'Document your strategy for future reference',
    ],
    warnings: [
      'Custom strategies need thorough testing',
      'More complex = more things that can go wrong',
      'Always use proper risk management',
    ],
    riskLevel: 'high',
  },
};

// Helper functions
export function getBotHelp(type: BotType): BotHelpContent {
  return BOT_HELP_CONTENT[type];
}

export function getAllBotHelp(): BotHelpContent[] {
  return Object.values(BOT_HELP_CONTENT);
}

export function getBotsByRiskLevel(level: 'low' | 'medium' | 'high'): BotHelpContent[] {
  return Object.values(BOT_HELP_CONTENT).filter(bot => bot.riskLevel === level);
}
