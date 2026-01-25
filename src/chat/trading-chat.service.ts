/**
 * Trading Chat Service
 *
 * A separate chat service for Trader Luna - focused purely on trading.
 * NO access to user memories, personality, email, calendar, etc.
 */

import {
  createChatCompletion,
  type ChatMessage,
} from '../llm/openai.client.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import { getTradingPrompt } from '../persona/trading.persona.js';
import * as tradingService from '../trading/trading.service.js';
import * as autoTradingService from '../trading/auto-trading.service.js';
import * as botExecutorService from '../trading/bot-executor.service.js';
import * as tradingTelegramService from '../triggers/trading-telegram.service.js';
import * as conditionalOrderService from '../trading/conditional-order.service.js';
import { parseTradingIntent, summarizeIntent } from '../trading/intent-parser.js';
import { search as searxngSearch } from '../search/searxng.client.js';
import { pool as db } from '../db/index.js';
import * as indicatorsService from '../trading/indicators.service.js';
import * as redisTradingService from '../trading/redis-trading.service.js';
import * as indicatorCalculatorService from '../trading/indicator-calculator.service.js';
import logger from '../utils/logger.js';
import type { Portfolio } from '../trading/trading.service.js';
import { getUserExchangeType, getUserMarginSettings } from '../trading/exchange.factory.js';
import { getDefaultTradingPairs, buildSymbolForExchange } from '../trading/symbol-utils.js';

/**
 * Format price for display - handles both large and tiny prices
 */
function formatPrice(price: number): string {
  if (price === 0) return '0';
  if (price >= 1) {
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 0.01) {
    return price.toFixed(4);
  }
  // For very small prices (meme coins), show significant digits
  return price.toPrecision(4);
}

// Trading-specific tools
const getPortfolioTool = {
  type: 'function' as const,
  function: {
    name: 'get_portfolio',
    description: 'Get the user\'s current portfolio holdings and balances from Binance',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const getActiveTradesTool = {
  type: 'function' as const,
  function: {
    name: 'get_active_trades',
    description: 'Get all active/open trades with their entry prices, current P&L, stop-loss and take-profit levels. ALWAYS call this when user asks about active trades, open positions, or current trades.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const getPricesTool = {
  type: 'function' as const,
  function: {
    name: 'get_prices',
    description: 'Get current prices for trading pairs. ALWAYS call this tool when user asks about prices or market conditions. Call without symbols to get all 45 tracked pairs with real-time prices and 24h change.',
    parameters: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Trading pair symbols (e.g., ["BTCUSDC", "ETHUSDC"]). Leave empty for all 45 default pairs.',
        },
      },
      required: [],
    },
  },
};

const getKlinesTool = {
  type: 'function' as const,
  function: {
    name: 'get_klines',
    description: 'Get candlestick/kline data for technical analysis',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol (e.g., "BTCUSDC")',
        },
        interval: {
          type: 'string',
          enum: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
          description: 'Candlestick interval',
        },
        limit: {
          type: 'number',
          description: 'Number of candles to retrieve (max 500, default 100)',
        },
      },
      required: ['symbol'],
    },
  },
};

const getIndicatorsTool = {
  type: 'function' as const,
  function: {
    name: 'get_indicators',
    description: `Get pre-calculated technical indicators from Redis cache. Much faster than calculating from klines.
Use this to quickly check:
- RSI (14-period) - momentum oscillator
- MACD (12,26,9) - trend/momentum indicator
- Bollinger Bands (20-period, 2 std dev) - volatility bands
- EMAs (9, 21, 50, 200) - exponential moving averages
- ATR (14-period) - average true range for volatility
- Stochastic (14,3,3) - overbought/oversold oscillator
- Volume metrics - volume SMA and ratio

Indicators are updated every minute for top 50 trading pairs.`,
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol (e.g., "BTCUSDT", "ETHUSDT")',
        },
        timeframe: {
          type: 'string',
          enum: ['1m', '5m', '15m', '1h', '4h', '1d'],
          description: 'Timeframe for indicators (default: 5m)',
        },
        allTimeframes: {
          type: 'boolean',
          description: 'If true, returns indicators for ALL timeframes at once',
        },
      },
      required: ['symbol'],
    },
  },
};

const analyzeSignalTool = {
  type: 'function' as const,
  function: {
    name: 'analyze_signal',
    description: `Get AI-analyzed trading signal with strength, confidence, and reasoning.
This tool analyzes multiple indicators together and provides:
- Signal direction (buy/sell/neutral)
- Signal strength (strong/medium/weak)
- Confidence score (0-1)
- BTC market bias (for altcoins)
- Multi-timeframe confirmation status
- Detailed reasoning based on RSI, MACD, Bollinger, EMAs, Stochastic

Use this when you need a quick trading recommendation rather than raw indicator values.`,
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol (e.g., "BTCUSDT", "SOLUSDT")',
        },
        timeframe: {
          type: 'string',
          enum: ['1m', '5m', '15m', '1h', '4h', '1d'],
          description: 'Primary timeframe for analysis (default: 5m)',
        },
      },
      required: ['symbol'],
    },
  },
};

const placeOrderTool = {
  type: 'function' as const,
  function: {
    name: 'place_order',
    description: 'Place a buy or sell order on Binance. ALWAYS confirm with user before executing. For BUY orders, you MUST include a stopLoss to protect the position.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol (e.g., "BTCUSDC")',
        },
        side: {
          type: 'string',
          enum: ['BUY', 'SELL'],
          description: 'Order side - buy or sell',
        },
        type: {
          type: 'string',
          enum: ['MARKET', 'LIMIT'],
          description: 'Order type',
        },
        quantity: {
          type: 'number',
          description: 'Amount to buy/sell (in base asset)',
        },
        price: {
          type: 'number',
          description: 'Limit price (required for LIMIT orders)',
        },
        stopLoss: {
          type: 'number',
          description: 'Stop loss price - REQUIRED for BUY orders. Set this to protect against downside risk.',
        },
        takeProfit: {
          type: 'number',
          description: 'Take profit price - optional target price to sell at for profit',
        },
      },
      required: ['symbol', 'side', 'type', 'quantity'],
    },
  },
};

const manageBotTool = {
  type: 'function' as const,
  function: {
    name: 'manage_bot',
    description: 'Create, start, stop, or configure trading bots. The trading engine executes bots automatically - just create with full parameters and start it.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'start', 'stop', 'delete', 'list', 'status'],
          description: 'Action to perform on bots',
        },
        botId: {
          type: 'string',
          description: 'Bot ID (required for start/stop/delete/status)',
        },
        config: {
          type: 'object',
          description: 'Full bot configuration for create action. Include ALL parameters - the trading engine handles execution.',
          properties: {
            name: { type: 'string', description: 'Bot name for display' },
            type: {
              type: 'string',
              enum: ['grid', 'dca', 'rsi', 'ma_crossover', 'custom'],
              description: 'Bot strategy type',
            },
            symbol: { type: 'string', description: 'Trading pair (e.g., BONK_USD, BTC_USD)' },
            parameters: {
              type: 'object',
              description: 'Strategy-specific parameters. For grid bots: lowerPrice, upperPrice, gridCount, totalInvestment, mode, stopLoss, takeProfit',
              properties: {
                // Grid bot parameters
                lowerPrice: { type: 'number', description: 'Grid lower price bound' },
                upperPrice: { type: 'number', description: 'Grid upper price bound' },
                gridCount: { type: 'number', description: 'Number of grid levels (e.g., 10, 20, 40)' },
                totalInvestment: { type: 'number', description: 'Total USD to invest in the grid' },
                mode: { type: 'string', enum: ['arithmetic', 'geometric'], description: 'Grid spacing mode (default: arithmetic)' },
                stopLoss: { type: 'number', description: 'Stop loss price - bot stops if price falls below' },
                takeProfit: { type: 'number', description: 'Take profit price - bot stops if price rises above' },
                // DCA bot parameters
                interval: { type: 'string', description: 'DCA interval (e.g., 1h, 4h, 1d)' },
                amountPerBuy: { type: 'number', description: 'Amount to buy each interval' },
                // RSI bot parameters
                rsiPeriod: { type: 'number', description: 'RSI calculation period' },
                oversoldThreshold: { type: 'number', description: 'Buy when RSI below this (e.g., 30)' },
                overboughtThreshold: { type: 'number', description: 'Sell when RSI above this (e.g., 70)' },
              },
            },
          },
          required: ['name', 'type', 'symbol', 'parameters'],
        },
      },
      required: ['action'],
    },
  },
};

const createConditionalOrderTool = {
  type: 'function' as const,
  function: {
    name: 'create_conditional_order',
    description: 'Create a conditional order that triggers when price reaches a target. Use for "if price drops below X, buy" or "when price goes above Y, sell" scenarios. Can include take-profit, stop-loss, and trailing stop.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol (e.g., "BTCUSDC")',
        },
        condition: {
          type: 'string',
          enum: ['above', 'below', 'crosses_up', 'crosses_down'],
          description: 'Price condition: "above" triggers when price >= target, "below" triggers when price <= target, "crosses_up" triggers when price crosses above target from below, "crosses_down" triggers when price crosses below target from above',
        },
        triggerPrice: {
          type: 'number',
          description: 'The price that triggers the order',
        },
        side: {
          type: 'string',
          enum: ['buy', 'sell'],
          description: 'Order side when triggered',
        },
        orderType: {
          type: 'string',
          enum: ['market', 'limit'],
          description: 'Order type when triggered (default: market)',
        },
        amountType: {
          type: 'string',
          enum: ['quantity', 'percentage', 'quote'],
          description: 'How to specify the amount: "quantity" is base asset amount, "percentage" is % of available balance (for buy: % of quote asset; for sell: % of base asset), "quote" is quote asset amount (e.g., spend 100 USDC)',
        },
        amount: {
          type: 'number',
          description: 'The amount based on amountType (e.g., 0.5 BTC for quantity, 60 for 60% percentage, 100 for 100 USDC quote)',
        },
        limitPrice: {
          type: 'number',
          description: 'Limit price if orderType is "limit"',
        },
        stopLoss: {
          type: 'number',
          description: 'Stop-loss price for the resulting position',
        },
        takeProfit: {
          type: 'number',
          description: 'Take-profit price for the resulting position',
        },
        trailingStopPct: {
          type: 'number',
          description: 'Trailing stop as percentage (e.g., 2.5 for 2.5%)',
        },
        trailingStopDollar: {
          type: 'number',
          description: 'Trailing stop as dollar amount (e.g., 800 means sell if price drops $800 from peak)',
        },
        expiresInHours: {
          type: 'number',
          description: 'Hours until the conditional order expires (optional, no expiry if not set)',
        },
      },
      required: ['symbol', 'condition', 'triggerPrice', 'side', 'amountType', 'amount'],
    },
  },
};

const listConditionalOrdersTool = {
  type: 'function' as const,
  function: {
    name: 'list_conditional_orders',
    description: 'List all active conditional orders for the user',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'triggered', 'cancelled', 'all'],
          description: 'Filter by status (default: active)',
        },
      },
      required: [],
    },
  },
};

const cancelConditionalOrderTool = {
  type: 'function' as const,
  function: {
    name: 'cancel_conditional_order',
    description: 'Cancel an active conditional order',
    parameters: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'The conditional order ID to cancel',
        },
      },
      required: ['orderId'],
    },
  },
};

const displayContentTool = {
  type: 'function' as const,
  function: {
    name: 'display_content',
    description: `Control what is shown in the main display area of the trading dashboard.
Use this to:
- Switch the chart to a different symbol (e.g., user says "show ETH" or "let's look at SOL" -> show_chart with ETHUSDC/SOLUSDC)
- Show a YouTube video for educational content, tutorials, or market analysis
- Show a website/iframe for external resources like TradingView, CoinGecko, or news

Call this tool when the user asks to see something specific or when you want to visually demonstrate something.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['show_chart', 'show_youtube', 'show_website'],
          description: 'The type of content to display',
        },
        symbol: {
          type: 'string',
          description: 'Trading pair symbol for chart display (e.g., "BTCUSDC", "ETHUSDC"). Required for show_chart.',
        },
        videoId: {
          type: 'string',
          description: 'YouTube video ID (11 character string). Required for show_youtube.',
        },
        videoTitle: {
          type: 'string',
          description: 'Title of the YouTube video. Optional for show_youtube.',
        },
        url: {
          type: 'string',
          description: 'Full URL to display in iframe. Required for show_website.',
        },
        title: {
          type: 'string',
          description: 'Title for the website. Optional for show_website.',
        },
      },
      required: ['action'],
    },
  },
};

// Alpha token tools
const getAlphaTokensTool = {
  type: 'function' as const,
  function: {
    name: 'get_alpha_tokens',
    description: 'Get list of available Binance Alpha tokens with prices, market cap, and volume. Alpha tokens are early-stage tokens on various chains.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of tokens to return (default: 20, max: 50)',
        },
        sortBy: {
          type: 'string',
          enum: ['volume', 'marketCap', 'change24h'],
          description: 'Sort tokens by this field (default: volume)',
        },
      },
      required: [],
    },
  },
};

const getAlphaPricesTool = {
  type: 'function' as const,
  function: {
    name: 'get_alpha_prices',
    description: 'Get current prices for specific Binance Alpha tokens',
    parameters: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alpha token symbols (e.g., ["RAVE", "MUBARAK"])',
        },
      },
      required: ['symbols'],
    },
  },
};

const searchAlphaTokensTool = {
  type: 'function' as const,
  function: {
    name: 'search_alpha_tokens',
    description: 'Search for Alpha tokens by name or symbol',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "pepe" or "meme")',
        },
      },
      required: ['query'],
    },
  },
};

// Web search tool for market news
const searchMarketNewsTool = {
  type: 'function' as const,
  function: {
    name: 'search_market_news',
    description: `Search the web for cryptocurrency market news, events, and analysis.
Use this when asked about:
- Recent news or events affecting crypto prices
- Market analysis and predictions
- Regulatory updates
- Comparing price movements to real-world events
- Any information you don't have from built-in tools`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for market news (e.g., "Bitcoin ETF approval news", "Ethereum merge impact")',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  },
};

// Natural language conditional order tool
const parseAndCreateConditionalOrderTool = {
  type: 'function' as const,
  function: {
    name: 'parse_trading_intent',
    description: `Parse a natural language trading command and create a conditional order with compound triggers.
Use this when the user provides complex trading instructions like:
- "buy ETH for 15 USDC if ETH drops to 2700 and rsi is oversold"
- "sell 0.5 BTC when price reaches 70000 or rsi above 80"
- "buy ETH for 100 USDT if price drops to 2500 then set trailing stop at 2700 with 2% callback"

This tool understands:
- Price conditions: "drops to", "reaches", "below", "above"
- RSI conditions: "oversold", "overbought", "rsi below 30"
- MACD conditions: "macd bullish crossover", "macd bearish"
- Moving averages: "above 200 ema", "below 50 sma"
- Follow-up actions: trailing stops, stop loss, take profit

Returns a parsed intent summary for confirmation before creating the order.`,
    parameters: {
      type: 'object',
      properties: {
        naturalLanguageInput: {
          type: 'string',
          description: 'The natural language trading command from the user',
        },
        confirmCreate: {
          type: 'boolean',
          description: 'If true, create the order. If false, just parse and show summary for confirmation.',
        },
      },
      required: ['naturalLanguageInput'],
    },
  },
};

// Trading rule management tool
const manageTradingRuleTool = {
  type: 'function' as const,
  function: {
    name: 'manage_trading_rule',
    description: `Create, list, update, or delete automated trading rules. Rules execute automatically when conditions are met.

Examples of rules you can create:
- "Buy $50 of SOL when RSI drops below 30 on 5m timeframe"
- "Sell 50% of BTC when price goes above 100000"
- "Alert me when ETH drops 5% in an hour"
- "Buy $100 worth of BTC with 2% stop loss when price drops below 90000"

Rules can have multiple conditions (AND/OR logic) and multiple actions.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'update', 'delete', 'toggle'],
          description: 'Action to perform',
        },
        ruleId: {
          type: 'string',
          description: 'Rule ID (required for update/delete/toggle)',
        },
        rule: {
          type: 'object',
          description: 'Rule configuration for create/update',
          properties: {
            name: {
              type: 'string',
              description: 'Short descriptive name for the rule',
            },
            description: {
              type: 'string',
              description: 'Longer description of what the rule does',
            },
            enabled: {
              type: 'boolean',
              description: 'Whether the rule is active (default: true)',
            },
            conditionLogic: {
              type: 'string',
              enum: ['AND', 'OR'],
              description: 'How to combine multiple conditions (default: AND)',
            },
            conditions: {
              type: 'array',
              description: 'Conditions that trigger the rule',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['price', 'indicator', 'change'],
                    description: 'Condition type',
                  },
                  symbol: {
                    type: 'string',
                    description: 'Trading pair (e.g., BTCUSDT, SOLUSDT)',
                  },
                  indicator: {
                    type: 'string',
                    enum: ['rsi', 'macd', 'ema_20', 'ema_50', 'volume'],
                    description: 'Indicator name (for indicator type)',
                  },
                  timeframe: {
                    type: 'string',
                    enum: ['1m', '5m', '15m', '1h', '4h', '1d'],
                    description: 'Timeframe for indicator (default: 5m)',
                  },
                  operator: {
                    type: 'string',
                    enum: ['>', '<', '>=', '<=', 'crosses_above', 'crosses_below'],
                    description: 'Comparison operator',
                  },
                  value: {
                    type: 'number',
                    description: 'Value to compare against',
                  },
                },
                required: ['type', 'operator', 'value'],
              },
            },
            actions: {
              type: 'array',
              description: 'Actions to execute when conditions are met',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['buy', 'sell', 'alert'],
                    description: 'Action type',
                  },
                  symbol: {
                    type: 'string',
                    description: 'Trading pair for buy/sell',
                  },
                  amountType: {
                    type: 'string',
                    enum: ['quote', 'base', 'percent'],
                    description: 'Amount type: quote ($50), base (0.5 BTC), percent (50%)',
                  },
                  amount: {
                    type: 'number',
                    description: 'Amount value',
                  },
                  orderType: {
                    type: 'string',
                    enum: ['market', 'limit'],
                    description: 'Order type (default: market)',
                  },
                  stopLoss: {
                    type: 'number',
                    description: 'Stop loss percentage (e.g., 2 for 2%)',
                  },
                  takeProfit: {
                    type: 'number',
                    description: 'Take profit percentage (e.g., 5 for 5%)',
                  },
                },
                required: ['type'],
              },
            },
            maxExecutions: {
              type: 'number',
              description: 'Maximum times this rule can trigger (optional)',
            },
            cooldownMinutes: {
              type: 'number',
              description: 'Minutes to wait between triggers (optional)',
            },
          },
          required: ['name', 'conditions', 'actions'],
        },
      },
      required: ['action'],
    },
  },
};

// Auto Trading Tools
const getAutoTradingStateTool = {
  type: 'function' as const,
  function: {
    name: 'get_auto_trading_state',
    description: `Get the current state of auto trading including:
- Whether auto trading is running or paused
- Daily P&L (realized)
- Number of active positions
- Win/loss counts for today
- Pause reason if paused (e.g., max losses, daily limit)`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const getAutoTradingSettingsTool = {
  type: 'function' as const,
  function: {
    name: 'get_auto_trading_settings',
    description: `Get the user's auto trading configuration including:
- Strategy and mode (manual/auto)
- Position sizing (min/max USD)
- Risk limits (daily loss limit, max consecutive losses)
- Symbol cooldown, max positions
- Dual-mode settings if enabled`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const getAutoTradingSignalsTool = {
  type: 'function' as const,
  function: {
    name: 'get_auto_trading_signals',
    description: `Get recent auto trading signals with backtest results.
Shows signals detected, whether executed or skipped, and backtest outcome (win/loss).
Use this to see what trades the system is finding and how well they would have performed.`,
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of signals to return (default: 50, max: 100)',
        },
      },
      required: [],
    },
  },
};

const getAutoTradingHistoryTool = {
  type: 'function' as const,
  function: {
    name: 'get_auto_trading_history',
    description: `Get today's auto trade history with outcomes.
Shows actual trades executed by the auto trading system, their entry/exit prices, and P&L.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const controlAutoTradingTool = {
  type: 'function' as const,
  function: {
    name: 'control_auto_trading',
    description: `Start or stop auto trading for the user. Use with caution - this enables/disables automated trading.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop'],
          description: 'Start or stop auto trading',
        },
      },
      required: ['action'],
    },
  },
};

const getAutoTradingPerformanceTool = {
  type: 'function' as const,
  function: {
    name: 'get_auto_trading_performance',
    description: `Get performance metrics for auto trading strategies.
Shows win rate, average P&L, and total trades for each strategy.
Useful for understanding which strategies work best.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const tradingTools = [
  getPortfolioTool,
  getActiveTradesTool,
  getPricesTool,
  getKlinesTool,
  getIndicatorsTool,
  analyzeSignalTool,
  placeOrderTool,
  manageBotTool,
  createConditionalOrderTool,
  listConditionalOrdersTool,
  cancelConditionalOrderTool,
  parseAndCreateConditionalOrderTool,
  displayContentTool,
  getAlphaTokensTool,
  getAlphaPricesTool,
  searchAlphaTokensTool,
  searchMarketNewsTool,
  manageTradingRuleTool,
  // Auto trading tools
  getAutoTradingStateTool,
  getAutoTradingSettingsTool,
  getAutoTradingSignalsTool,
  getAutoTradingHistoryTool,
  controlAutoTradingTool,
  getAutoTradingPerformanceTool,
];

export interface TradingChatInput {
  sessionId: string;
  userId: string;
  message: string;
  source?: 'web' | 'telegram';  // Where the message originated from
}

// Display content types that Luna can control
export type DisplayContent =
  | { type: 'chart'; symbol: string }
  | { type: 'youtube'; videoId: string; title?: string }
  | { type: 'website'; url: string; title?: string };

export interface TradingChatOutput {
  messageId: string;
  content: string;
  tokensUsed: number;
  portfolio?: Portfolio;
  display?: DisplayContent;
  tradeExecuted?: boolean;  // True when an order was placed or a conditional order was created
}

/**
 * Get or create a trading session for the user
 */
export async function getOrCreateTradingSession(userId: string): Promise<string> {
  // Check for existing active session (from last 24 hours)
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM trading_sessions
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new session
  const result = await db.query<{ id: string }>(
    `INSERT INTO trading_sessions (id, user_id)
     VALUES (gen_random_uuid(), $1)
     RETURNING id`,
    [userId]
  );

  return result.rows[0].id;
}

/**
 * Get trading session messages
 */
export async function getSessionMessages(
  sessionId: string,
  limit = 20
): Promise<Array<{ role: string; content: string }>> {
  const result = await db.query<{ role: string; content: string }>(
    `SELECT role, content FROM trading_messages
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit]
  );

  return result.rows.reverse();
}

/**
 * Add message to trading session
 */
async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO trading_messages (id, session_id, role, content)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING id`,
    [sessionId, role, content]
  );

  return result.rows[0].id;
}

/**
 * Process a trading chat message
 */
export async function processMessage(input: TradingChatInput): Promise<TradingChatOutput> {
  const { sessionId, userId, message, source = 'web' } = input;

  // Get model config (use main chat config for trading)
  const modelConfig = await getUserModelConfig(userId, 'main_chat');

  // Get trading settings for context
  const settings = await tradingService.getSettings(userId);

  // Get user's exchange type for symbol formatting
  const userExchange = (await getUserExchangeType(userId)) || 'crypto_com';

  // Get margin settings for Crypto.com users
  const marginSettings = await getUserMarginSettings(userId);

  // Build risk settings context
  let riskContext = '';
  if (settings) {
    riskContext = `Risk Tolerance: ${settings.riskTolerance}
Max Position Size: ${settings.maxPositionPct}% of portfolio
Daily Loss Limit: ${settings.dailyLossLimitPct}%
Require Stop-Loss: ${settings.requireStopLoss ? 'Yes' : 'No'}
Default Stop-Loss: ${settings.defaultStopLossPct}%
Allowed Symbols: ${settings.allowedSymbols?.join(', ') || 'All'}`;
  }

  // Try to get portfolio for context
  let portfolioContext = '';
  try {
    const portfolio = await tradingService.getPortfolio(userId);
    if (portfolio) {
      const topHoldings = portfolio.holdings
        .slice(0, 5)
        .map(h => `${h.asset}: ${h.amount.toFixed(6)} ($${h.valueUsdt.toFixed(2)})`)
        .join('\n');
      portfolioContext = `Total Value: $${portfolio.totalValueUsdt.toLocaleString()}
Available USDT: $${portfolio.availableUsdt.toLocaleString()}
24h P&L: ${portfolio.dailyPnl >= 0 ? '+' : ''}$${portfolio.dailyPnl.toFixed(2)} (${portfolio.dailyPnlPct.toFixed(2)}%)

Top Holdings:
${topHoldings}`;
    }
  } catch {
    // Portfolio not available (not connected)
    portfolioContext = 'Binance not connected - portfolio data unavailable';
  }

  // Build system prompt with trading context
  const systemPrompt = getTradingPrompt({
    portfolio: portfolioContext,
    riskSettings: riskContext,
    exchange: userExchange,
    marginEnabled: marginSettings?.marginEnabled || false,
    leverage: marginSettings?.leverage || 1,
  });

  // Get conversation history
  const history = await getSessionMessages(sessionId, 10);

  // Build messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add history
  for (const msg of history) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  // Add current message
  messages.push({ role: 'user', content: message });

  // Save user message
  await addMessage(sessionId, 'user', message);

  // Call LLM with trading tools
  let completion = await createChatCompletion({
    messages,
    tools: tradingTools,
    provider: modelConfig.provider,
    model: modelConfig.model,
    loggingContext: {
      userId,
      sessionId,
      source: 'trading-chat',
      nodeName: 'trading_initial',
    },
  });

  // Handle tool calls - loop until no more tool calls
  let pendingDisplay: DisplayContent | undefined;
  let tradeExecuted = false;  // Track if any trading action was performed
  let toolCallIterations = 0;
  const maxToolCallIterations = 5;  // Prevent infinite loops

  while (completion.toolCalls && completion.toolCalls.length > 0 && toolCallIterations < maxToolCallIterations) {
    toolCallIterations++;
    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: completion.content || '',
      tool_calls: completion.toolCalls,
    } as ChatMessage);

    for (const toolCall of completion.toolCalls) {
      const args = JSON.parse(toolCall.function.arguments);
      let toolResult: string;

      try {
        switch (toolCall.function.name) {
          case 'get_portfolio': {
            const portfolio = await tradingService.getPortfolio(userId);
            if (portfolio) {
              // Group holdings by wallet type
              const walletLabels: Record<string, string> = {
                spot: 'Spot',
                funding: 'Funding',
                earn: 'Earn',
              };
              const holdings = portfolio.holdings
                .map(h => {
                  const wallet = h.wallet ? ` [${walletLabels[h.wallet] || h.wallet}]` : '';
                  return `${h.asset}: ${h.amount.toFixed(6)} ($${h.valueUsdt.toFixed(2)})${wallet}`;
                })
                .join('\n');
              toolResult = `Portfolio Summary (All Wallets):
Total Value: $${portfolio.totalValueUsdt.toLocaleString()}
Available for Trading (Spot): $${portfolio.availableUsdt.toLocaleString()}
24h P&L: ${portfolio.dailyPnl >= 0 ? '+' : ''}$${portfolio.dailyPnl.toFixed(2)} (${portfolio.dailyPnlPct.toFixed(2)}%)

Holdings:
${holdings || 'No holdings found'}

Note: Alpha wallet holdings are not available via API. Check Binance app for Alpha tokens.`;
            } else {
              toolResult = 'Unable to fetch portfolio. Please ensure Binance is connected.';
            }
            break;
          }

          case 'get_active_trades': {
            const activeTrades = await tradingService.getActiveTrades(userId);
            if (activeTrades.openPositions.length > 0 || activeTrades.pendingOrders.length > 0) {
              let result = '';
              if (activeTrades.openPositions.length > 0) {
                result += `**Open Positions (${activeTrades.openPositions.length}):**\n`;
                result += activeTrades.openPositions.map(t => {
                  const pnlSign = t.pnlDollar >= 0 ? '+' : '';
                  const sl = t.stopLossPrice ? `SL: $${t.stopLossPrice.toFixed(2)}` : 'No SL';
                  const tp = t.takeProfitPrice ? `TP: $${t.takeProfitPrice.toFixed(2)}` : 'No TP';
                  return `- ${t.symbol} ${t.side.toUpperCase()}: ${t.quantity} @ $${t.entryPrice.toFixed(2)} | Current: $${t.currentPrice.toFixed(2)} | P&L: ${pnlSign}$${t.pnlDollar.toFixed(2)} (${pnlSign}${t.pnlPercent.toFixed(2)}%) | ${sl} | ${tp}`;
                }).join('\n');
              }
              if (activeTrades.pendingOrders.length > 0) {
                result += `\n\n**Pending Orders (${activeTrades.pendingOrders.length}):**\n`;
                result += activeTrades.pendingOrders.map(t => {
                  return `- ${t.symbol} ${t.side.toUpperCase()}: ${t.quantity} @ $${t.entryPrice.toFixed(2)} (pending)`;
                }).join('\n');
              }
              toolResult = result;
            } else {
              toolResult = 'No active trades or pending orders.';
            }
            break;
          }

          case 'get_prices': {
            const symbols = args.symbols || getDefaultTradingPairs(userExchange);
            const prices = await tradingService.getPrices(userId, symbols);
            if (prices.length > 0) {
              toolResult = prices.map(p =>
                `${p.symbol}: $${formatPrice(p.price)} (${p.change24h >= 0 ? '+' : ''}${p.change24h.toFixed(2)}%)`
              ).join('\n');
            } else {
              toolResult = 'Unable to fetch prices.';
            }
            break;
          }

          case 'get_klines': {
            const klines = await tradingService.getKlines(
              args.symbol,
              args.interval || '1h',
              args.limit || 50
            );
            if (klines.length > 0) {
              // Parse strings to numbers for TA calculations
              const closes = klines.map(k => parseFloat(k.close));
              const highs = klines.map(k => parseFloat(k.high));
              const lows = klines.map(k => parseFloat(k.low));
              const volumes = klines.map(k => parseFloat(k.volume));
              const latestOpen = parseFloat(klines[klines.length - 1].open);
              const latestHigh = parseFloat(klines[klines.length - 1].high);
              const latestLow = parseFloat(klines[klines.length - 1].low);
              const latestClose = parseFloat(klines[klines.length - 1].close);
              const latestVolume = parseFloat(klines[klines.length - 1].volume);
              const prevClose = parseFloat(klines[klines.length - 2].close);

              // Simple RSI calculation (14 period)
              let rsi = 'N/A';
              let rsiNum = 50;
              if (closes.length >= 14) {
                let gains = 0, losses = 0;
                for (let i = closes.length - 14; i < closes.length; i++) {
                  const change = closes[i] - closes[i - 1];
                  if (change > 0) gains += change;
                  else losses -= change;
                }
                const avgGain = gains / 14;
                const avgLoss = losses / 14;
                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                rsiNum = 100 - (100 / (1 + rs));
                rsi = rsiNum.toFixed(1);
              }

              // Recent high/low
              const recentHigh = Math.max(...highs.slice(-20));
              const recentLow = Math.min(...lows.slice(-20));

              // Basic analysis result
              let basicResult = `${args.symbol} Analysis (${args.interval || '1h'}):
Latest: O:$${formatPrice(latestOpen)} H:$${formatPrice(latestHigh)} L:$${formatPrice(latestLow)} C:$${formatPrice(latestClose)}
Change: ${((latestClose - prevClose) / prevClose * 100).toFixed(2)}%
Volume: ${latestVolume.toLocaleString()}
RSI(14): ${rsi}
20-period Range: $${formatPrice(recentLow)} - $${formatPrice(recentHigh)}`;

              // Get advanced settings
              let advancedAnalysis = '';
              try {
                const advSettings = await indicatorsService.getAdvancedSignalSettings(userId);

                // Convert klines to format expected by indicator functions
                const klinesData = klines.map(k => ({
                  open: parseFloat(k.open),
                  high: parseFloat(k.high),
                  low: parseFloat(k.low),
                  close: parseFloat(k.close),
                  volume: parseFloat(k.volume),
                }));

                // MTF Confluence - Only meaningful if analyzing 5m timeframe
                if (advSettings.enableMtfConfluence && (args.interval === '5m' || !args.interval)) {
                  try {
                    const klines1h = await tradingService.getKlines(args.symbol, '1h', 60);
                    if (klines1h.length >= 21) {
                      const closes1h = klines1h.map(k => parseFloat(k.close));
                      const mtf = indicatorsService.calculateMTFConfluence(closes, closes1h, rsiNum);
                      advancedAnalysis += `\n\n**MTF Confluence (1H)**:
1H Trend: ${mtf.trend1h.toUpperCase()} | Price ${mtf.priceAbove21EMA1h ? 'above' : 'below'} 21 EMA
Confluence: ${mtf.confluence5m1h.replace(/_/g, ' ').toUpperCase()} (score: ${(mtf.confluenceScore * 100).toFixed(0)}%)`;
                    }
                  } catch (err) {
                    logger.warn('Failed to fetch 1h klines for MTF', { error: (err as Error).message });
                  }
                }

                // VWAP Analysis
                if (advSettings.enableVwapEntry && klinesData.length >= 24) {
                  // Find 24h low anchor
                  const last24h = klinesData.slice(-24);
                  const low24hIndex = last24h.reduce((minIdx, k, idx, arr) =>
                    k.low < arr[minIdx].low ? idx : minIdx, 0);
                  const anchorIndex = klinesData.length - 24 + low24hIndex;

                  const vwap = indicatorsService.calculateVWAP(klinesData, anchorIndex);
                  advancedAnalysis += `\n\n**VWAP Analysis** (anchored to 24h low):
VWAP: $${formatPrice(vwap.vwap)} | Price ${vwap.priceReclaimingVWAP ? 'RECLAIMING' : 'below VWAP'}
${vwap.buyingPowerConfirmed ? 'Buying power confirmed - volume supporting move' : 'Awaiting volume confirmation'}`;
                }

                // ATR-Based Stops
                if (advSettings.enableAtrStops && klinesData.length >= advSettings.atrPeriod) {
                  const atrResult = indicatorsService.calculateATR(klinesData, advSettings.atrPeriod);
                  const stops = indicatorsService.calculateDynamicStops(
                    latestClose,
                    atrResult.atr,
                    advSettings.atrSlMultiplier,
                    advSettings.atrTpMultiplier
                  );
                  advancedAnalysis += `\n\n**ATR-Based Levels** (ATR: $${formatPrice(atrResult.atr)}, ${atrResult.volatilityLevel} volatility):
Stop-Loss: $${formatPrice(stops.stopLoss)} (-${advSettings.atrSlMultiplier}x ATR)
Take-Profit: $${formatPrice(stops.takeProfit)} (+${advSettings.atrTpMultiplier}x ATR)
Risk/Reward: 1:${stops.riskRewardRatio.toFixed(1)}`;
                }

                // BTC Correlation Filter - only for altcoins
                if (advSettings.enableBtcFilter && !args.symbol.startsWith('BTC')) {
                  try {
                    const btcKlines1m = await tradingService.getKlines('BTCUSDC', '1m', advSettings.btcLookbackMinutes);
                    if (btcKlines1m.length >= 2) {
                      const btcResult = indicatorsService.checkBTCCorrelationFromKlines(
                        btcKlines1m.map(k => ({
                          open: parseFloat(k.open),
                          high: parseFloat(k.high),
                          low: parseFloat(k.low),
                          close: parseFloat(k.close),
                          volume: parseFloat(k.volume),
                        })),
                        advSettings.btcDumpThreshold,
                        advSettings.btcLookbackMinutes
                      );
                      if (btcResult.btcDumping) {
                        advancedAnalysis += `\n\n**BTC CORRELATION ALERT**:
BTC ${advSettings.btcLookbackMinutes}m Change: ${btcResult.btcChange30m.toFixed(2)}%
${btcResult.reason}
ALTCOIN LONGS PAUSED - Wait for BTC stabilization`;
                      } else {
                        advancedAnalysis += `\n\n**BTC Correlation**: OK (${btcResult.btcChange30m.toFixed(2)}% in ${advSettings.btcLookbackMinutes}m)`;
                      }
                    }
                  } catch (err) {
                    logger.warn('Failed to check BTC correlation', { error: (err as Error).message });
                  }
                }

                // Liquidity Sweep Detection
                if (advSettings.enableLiquiditySweep && klinesData.length >= 20) {
                  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
                  const rsiValues = indicatorsService.calculateRSISeries(closes, 14);
                  const sweep = indicatorsService.detectLiquiditySweep(
                    klinesData,
                    recentLow,
                    avgVolume,
                    rsiValues,
                    advSettings.sweepWickRatio,
                    advSettings.sweepVolumeMultiplier
                  );
                  if (sweep.detected) {
                    advancedAnalysis += `\n\n**LIQUIDITY SWEEP DETECTED** (${(sweep.confidence * 100).toFixed(0)}% confidence):
Stop-hunt at $${formatPrice(sweep.supportLevel || 0)} with recovery
${sweep.rsiBullishDivergence ? 'RSI bullish divergence confirmed' : 'No RSI divergence'}
${sweep.sweepCandle?.volumeSpike ? 'Volume spike on sweep candle' : 'Normal volume'}
HIGH-PROBABILITY LONG SETUP`;
                  }
                }

                // Add preset indicator
                if (advSettings.featurePreset !== 'basic') {
                  advancedAnalysis += `\n\n[Strategy: ${advSettings.featurePreset.toUpperCase()}]`;
                }

              } catch (err) {
                logger.warn('Failed to calculate advanced indicators', { error: (err as Error).message });
              }

              toolResult = basicResult + advancedAnalysis;
            } else {
              toolResult = `Unable to fetch klines for ${args.symbol}`;
            }
            break;
          }

          case 'get_indicators': {
            // Normalize symbol to Binance USDT format (indicator cache uses Binance pairs)
            let indicatorSymbol = args.symbol?.toUpperCase() || '';

            // Convert Crypto.com USD format to Binance USDT format
            // IMPORTANT: Check underscore format FIRST before plain USD check
            if (indicatorSymbol.includes('_USD')) {
              // Handle underscore format like XRP_USD or BTC_USDT
              indicatorSymbol = indicatorSymbol.replace(/_USD[TC]?$/, 'USDT').replace('_', '');
            } else if (indicatorSymbol.endsWith('USDC')) {
              indicatorSymbol = indicatorSymbol.slice(0, -4) + 'USDT';
            } else if (indicatorSymbol.endsWith('USD') && !indicatorSymbol.endsWith('USDT') && !indicatorSymbol.endsWith('BUSD')) {
              indicatorSymbol = indicatorSymbol.slice(0, -3) + 'USDT';
            } else {
              // Check if no quote currency at all
              const hasQuoteCurrency = ['USDT', 'BUSD', 'BTC', 'ETH', 'BNB'].some(
                q => indicatorSymbol.endsWith(q)
              );
              if (!hasQuoteCurrency) {
                indicatorSymbol = `${indicatorSymbol}USDT`;
              }
            }

            if (args.allTimeframes) {
              // Get indicators for all timeframes
              const allIndicators = await indicatorCalculatorService.getIndicatorsForSymbol(indicatorSymbol);
              const timeframes = Object.keys(allIndicators).filter(tf => allIndicators[tf as keyof typeof allIndicators] !== null);

              if (timeframes.length === 0) {
                toolResult = `No indicator data available for ${indicatorSymbol}. It may not be in the top 50 pairs.`;
              } else {
                const results: string[] = [`**${indicatorSymbol} Indicators (All Timeframes)**\n`];

                for (const tf of timeframes) {
                  const ind = allIndicators[tf as keyof typeof allIndicators];
                  if (!ind) continue;

                  let tfResult = `\n**${tf}**:`;
                  if (ind.rsi !== undefined) tfResult += ` RSI: ${ind.rsi.toFixed(1)}`;
                  if (ind.macd_histogram !== undefined) {
                    tfResult += ` | MACD: ${ind.macd_histogram > 0 ? 'Bullish' : 'Bearish'} (${ind.macd_histogram.toFixed(4)})`;
                  }
                  if (ind.ema_9 !== undefined && ind.ema_21 !== undefined) {
                    tfResult += ` | EMA9>${' '}EMA21: ${ind.ema_9 > ind.ema_21 ? 'Yes' : 'No'}`;
                  }
                  if (ind.atr !== undefined) tfResult += ` | ATR: $${formatPrice(ind.atr)}`;
                  if (ind.stoch_k !== undefined) tfResult += ` | Stoch: ${ind.stoch_k.toFixed(0)}`;

                  results.push(tfResult);
                }

                toolResult = results.join('');
              }
            } else {
              // Get indicators for single timeframe
              const timeframe = args.timeframe || '5m';
              const indicators = await redisTradingService.getIndicators(indicatorSymbol, timeframe);

              if (!indicators) {
                toolResult = `No indicator data for ${indicatorSymbol} on ${timeframe}. It may not be in the top 50 pairs or data is still loading.`;
              } else {
                let result = `**${indicatorSymbol} Technical Indicators (${timeframe})**\n`;

                // RSI
                if (indicators.rsi !== undefined) {
                  const rsiStatus = indicators.rsi < 30 ? 'OVERSOLD' : indicators.rsi > 70 ? 'OVERBOUGHT' : 'Neutral';
                  result += `\n**RSI (14)**: ${indicators.rsi.toFixed(1)} - ${rsiStatus}`;
                }

                // MACD
                if (indicators.macd_line !== undefined && indicators.macd_signal !== undefined) {
                  const macdCross = indicators.macd_line > indicators.macd_signal ? 'Bullish' : 'Bearish';
                  result += `\n**MACD**: Line: ${indicators.macd_line.toFixed(4)} | Signal: ${indicators.macd_signal.toFixed(4)} | Histogram: ${indicators.macd_histogram?.toFixed(4)} (${macdCross})`;
                }

                // Bollinger Bands
                if (indicators.bollinger_upper !== undefined && indicators.bollinger_lower !== undefined) {
                  result += `\n**Bollinger Bands**: Upper: $${formatPrice(indicators.bollinger_upper)} | Middle: $${formatPrice(indicators.bollinger_middle || 0)} | Lower: $${formatPrice(indicators.bollinger_lower)}`;
                }

                // EMAs
                result += `\n**EMAs**: `;
                const emas: string[] = [];
                if (indicators.ema_9 !== undefined) emas.push(`9: $${formatPrice(indicators.ema_9)}`);
                if (indicators.ema_21 !== undefined) emas.push(`21: $${formatPrice(indicators.ema_21)}`);
                if (indicators.ema_50 !== undefined) emas.push(`50: $${formatPrice(indicators.ema_50)}`);
                if (indicators.ema_200 !== undefined) emas.push(`200: $${formatPrice(indicators.ema_200)}`);
                result += emas.join(' | ');

                // Trend analysis
                if (indicators.ema_9 !== undefined && indicators.ema_21 !== undefined && indicators.ema_50 !== undefined) {
                  if (indicators.ema_9 > indicators.ema_21 && indicators.ema_21 > indicators.ema_50) {
                    result += ` (BULLISH alignment)`;
                  } else if (indicators.ema_9 < indicators.ema_21 && indicators.ema_21 < indicators.ema_50) {
                    result += ` (BEARISH alignment)`;
                  }
                }

                // ATR
                if (indicators.atr !== undefined) {
                  result += `\n**ATR (14)**: $${formatPrice(indicators.atr)}`;
                }

                // Stochastic
                if (indicators.stoch_k !== undefined && indicators.stoch_d !== undefined) {
                  const stochStatus = indicators.stoch_k < 20 ? 'OVERSOLD' : indicators.stoch_k > 80 ? 'OVERBOUGHT' : 'Neutral';
                  result += `\n**Stochastic**: %K: ${indicators.stoch_k.toFixed(1)} | %D: ${indicators.stoch_d.toFixed(1)} - ${stochStatus}`;
                }

                // Volume
                if (indicators.volume_ratio !== undefined) {
                  const volStatus = indicators.volume_ratio > 1.5 ? 'HIGH' : indicators.volume_ratio < 0.5 ? 'LOW' : 'Normal';
                  result += `\n**Volume**: ${indicators.volume_ratio.toFixed(2)}x avg (${volStatus})`;
                }

                // Age of data
                const ageSeconds = Math.floor((Date.now() - indicators.timestamp) / 1000);
                result += `\n\n_Updated ${ageSeconds}s ago_`;

                toolResult = result;
              }
            }
            break;
          }

          case 'analyze_signal': {
            // Normalize symbol to Binance USDT format (indicator cache uses Binance pairs)
            let signalSymbol = args.symbol?.toUpperCase() || '';

            // Convert Crypto.com USD format to Binance USDT format
            if (signalSymbol.endsWith('USD') && !signalSymbol.endsWith('USDT') && !signalSymbol.endsWith('BUSD')) {
              signalSymbol = signalSymbol.slice(0, -3) + 'USDT';
            } else if (signalSymbol.endsWith('USDC')) {
              signalSymbol = signalSymbol.slice(0, -4) + 'USDT';
            } else if (signalSymbol.endsWith('_USD')) {
              signalSymbol = signalSymbol.slice(0, -4) + 'USDT';
            } else {
              const hasQuote = ['USDT', 'BUSD', 'BTC', 'ETH', 'BNB'].some(
                q => signalSymbol.endsWith(q)
              );
              if (!hasQuote) {
                signalSymbol = `${signalSymbol}USDT`;
              }
            }

            const timeframe = args.timeframe || '5m';
            const analysis = await indicatorCalculatorService.analyzeSignals(signalSymbol, timeframe);

            if (analysis.confidence === 0 && analysis.signal === 'neutral') {
              toolResult = `No actionable signal for ${signalSymbol} on ${timeframe}. ${analysis.reasons.join(', ')}`;
            } else {
              const signalEmoji = analysis.signal === 'buy' ? '📈' : analysis.signal === 'sell' ? '📉' : '➖';
              const strengthEmoji = analysis.strength === 'strong' ? '💪' : analysis.strength === 'medium' ? '👍' : '👌';

              let result = `**${signalSymbol} Signal Analysis (${timeframe})**\n\n`;
              result += `${signalEmoji} **Signal**: ${analysis.signal.toUpperCase()} ${strengthEmoji} (${analysis.strength})\n`;
              result += `**Confidence**: ${(analysis.confidence * 100).toFixed(0)}%\n`;

              if (analysis.btcBias && signalSymbol !== 'BTCUSDT') {
                const btcEmoji = analysis.btcBias === 'bullish' ? '🟢' : analysis.btcBias === 'bearish' ? '🔴' : '⚪';
                result += `**BTC Bias**: ${btcEmoji} ${analysis.btcBias}\n`;
              }

              if (analysis.multiTfConfirmed !== undefined) {
                result += `**Multi-TF Confirmed**: ${analysis.multiTfConfirmed ? '✅ Yes' : '❌ No'}\n`;
              }

              result += `\n**Reasons**:\n`;
              for (const reason of analysis.reasons) {
                result += `- ${reason}\n`;
              }

              toolResult = result;
            }
            break;
          }

          case 'place_order': {
            logger.info('place_order tool called', { userId, source, args });
            // Normalize symbol to match allowed symbols
            let tradingSymbol = args.symbol?.toUpperCase() || '';
            // Extract base currency (remove common quote currencies)
            const quoteCurrencies = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB'];
            for (const quote of quoteCurrencies) {
              if (tradingSymbol.endsWith(quote) && tradingSymbol.length > quote.length) {
                tradingSymbol = tradingSymbol.slice(0, -quote.length);
                break;
              }
            }
            // Get trading settings to find allowed symbol
            const tradeSettings = await tradingService.getSettings(userId);
            const matchedSymbol = tradeSettings.allowedSymbols.find(
              (s) => s.startsWith(tradingSymbol)
            );
            if (matchedSymbol) {
              tradingSymbol = matchedSymbol;
            } else {
              // Build symbol with exchange-specific quote currency (USD for Crypto.com, USDC for Binance)
              tradingSymbol = buildSymbolForExchange(tradingSymbol, userExchange);
            }

            // Only require Telegram confirmation when message came FROM Telegram
            if (source === 'telegram') {
              // Create pending order for Telegram confirmation
              const pendingOrder = await tradingTelegramService.createPendingOrder(userId, {
                symbol: tradingSymbol,
                side: args.side,
                orderType: args.type,
                quantity: args.quantity,
                price: args.price,
                stopLoss: args.stopLoss,
                takeProfit: args.takeProfit,
              });

              if (pendingOrder) {
                let confirmMsg = `Order sent for confirmation!

Symbol: ${tradingSymbol}
Side: ${args.side}
Type: ${args.type}
Quantity: ${args.quantity}
${args.price ? `Price: $${args.price}` : 'Price: Market'}`;
                if (args.stopLoss) confirmMsg += `\nStop Loss: $${args.stopLoss}`;
                if (args.takeProfit) confirmMsg += `\nTake Profit: $${args.takeProfit}`;
                confirmMsg += `\n\nPlease tap "Yes, Execute" below to confirm (expires in 5 minutes).`;
                toolResult = confirmMsg;
              } else {
                toolResult = 'Failed to create pending order. Please try again.';
              }
            } else {
              // Web chat - execute directly
              const order = await tradingService.placeOrder(userId, {
                symbol: tradingSymbol,
                side: args.side,
                type: args.type,
                quantity: args.quantity,
                price: args.price,
                stopLoss: args.stopLoss,
                takeProfit: args.takeProfit,
              });

              if (order) {
                tradeExecuted = true;  // Signal frontend to refresh portfolio/trades
                toolResult = `Order placed successfully!
Order ID: ${order.binanceOrderId}
Symbol: ${order.symbol}
Side: ${order.side}
Type: ${order.orderType}
Quantity: ${order.quantity}
${order.price ? `Price: $${order.price}` : 'Price: Market'}
Status: ${order.status}`;
              } else {
                toolResult = 'Failed to place order. Please check connection and try again.';
              }
            }
            break;
          }

          case 'manage_bot': {
            switch (args.action) {
              case 'list': {
                const bots = await tradingService.getBots(userId);
                if (bots.length > 0) {
                  toolResult = 'Trading Bots:\n' + bots.map(b =>
                    `- ID: ${b.id}\n  Name: ${b.name} (${b.type})\n  Symbol: ${b.symbol} | Status: ${b.status}\n  Trades: ${b.totalTrades} | P&L: $${b.totalProfit.toFixed(2)}`
                  ).join('\n\n');
                } else {
                  toolResult = 'No trading bots configured.';
                }
                break;
              }

              case 'create': {
                if (!args.config) {
                  toolResult = 'Bot configuration required for create action';
                } else {
                  // Map tool parameters to createBot format
                  const botConfig = {
                    name: args.config.name,
                    type: args.config.type,
                    symbol: args.config.symbol,
                    config: args.config.parameters || {}, // parameters -> config for storage
                  };
                  const bot = await tradingService.createBot(userId, botConfig);
                  toolResult = `Bot "${bot.name}" created successfully!
ID: ${bot.id}
Type: ${bot.type}
Symbol: ${bot.symbol}
Status: ${bot.status}

The trading engine will execute this bot automatically. Use "start bot ${bot.id}" to activate it.`;
                }
                break;
              }

              case 'start': {
                if (!args.botId) {
                  toolResult = 'Bot ID required for start action';
                } else {
                  await tradingService.updateBotStatus(userId, args.botId, 'running');
                  toolResult = `Bot ${args.botId} started successfully`;
                }
                break;
              }

              case 'stop': {
                if (!args.botId) {
                  toolResult = 'Bot ID required for stop action';
                } else {
                  await tradingService.updateBotStatus(userId, args.botId, 'stopped');
                  toolResult = `Bot ${args.botId} stopped successfully`;
                }
                break;
              }

              case 'delete': {
                if (!args.botId) {
                  toolResult = 'Bot ID required for delete action';
                } else {
                  await tradingService.deleteBot(userId, args.botId);
                  toolResult = `Bot ${args.botId} deleted successfully`;
                }
                break;
              }

              case 'status': {
                if (!args.botId) {
                  toolResult = 'Bot ID required for status action';
                } else {
                  const bots = await tradingService.getBots(userId);
                  const bot = bots.find(b => b.id === args.botId);
                  if (bot) {
                    let statusText = `Bot Status:
ID: ${bot.id}
Name: ${bot.name}
Type: ${bot.type}
Symbol: ${bot.symbol}
Status: ${bot.status}
Total Trades: ${bot.totalTrades}
Total Profit: $${bot.totalProfit.toFixed(2)}`;

                    // Add configuration details based on bot type
                    if (bot.config && typeof bot.config === 'object') {
                      const cfg = bot.config as Record<string, unknown>;
                      if (bot.type === 'grid') {
                        statusText += `\n\nGrid Configuration:`;
                        if (cfg.lowerPrice) statusText += `\nLower Price: $${formatPrice(cfg.lowerPrice as number)}`;
                        if (cfg.upperPrice) statusText += `\nUpper Price: $${formatPrice(cfg.upperPrice as number)}`;
                        if (cfg.gridCount) statusText += `\nGrid Count: ${cfg.gridCount}`;
                        if (cfg.totalInvestment) statusText += `\nTotal Investment: $${cfg.totalInvestment}`;
                        if (cfg.mode) statusText += `\nMode: ${cfg.mode}`;
                        if (cfg.stopLoss) statusText += `\nStop Loss: $${formatPrice(cfg.stopLoss as number)}`;
                        if (cfg.takeProfit) statusText += `\nTake Profit: $${formatPrice(cfg.takeProfit as number)}`;
                      } else if (bot.type === 'dca') {
                        statusText += `\n\nDCA Configuration:`;
                        if (cfg.amountPerBuy) statusText += `\nAmount Per Buy: $${cfg.amountPerBuy}`;
                        if (cfg.interval) statusText += `\nInterval: ${cfg.interval}`;
                      } else if (bot.type === 'rsi') {
                        statusText += `\n\nRSI Configuration:`;
                        if (cfg.rsiPeriod) statusText += `\nRSI Period: ${cfg.rsiPeriod}`;
                        if (cfg.oversoldThreshold) statusText += `\nOversold: ${cfg.oversoldThreshold}`;
                        if (cfg.overboughtThreshold) statusText += `\nOverbought: ${cfg.overboughtThreshold}`;
                      }
                    }

                    if (bot.lastError) {
                      statusText += `\n\nLast Error: ${bot.lastError}`;
                    }

                    toolResult = statusText;
                  } else {
                    toolResult = `Bot ${args.botId} not found`;
                  }
                }
                break;
              }

              default:
                toolResult = `Unknown bot action: ${args.action}`;
            }
            break;
          }

          case 'create_conditional_order': {
            // Validate required fields
            if (!args.symbol || !args.condition || !args.triggerPrice || !args.side || !args.amountType || args.amount === undefined) {
              toolResult = 'Missing required fields: symbol, condition, triggerPrice, side, amountType, amount';
              break;
            }

            // Build the action object
            const action: botExecutorService.ConditionalOrder['action'] = {
              side: args.side,
              type: args.orderType || 'market',
              amountType: args.amountType,
              amount: args.amount,
            };

            // Add optional fields
            if (args.limitPrice) action.limitPrice = args.limitPrice;
            if (args.stopLoss) action.stopLoss = args.stopLoss;
            if (args.takeProfit) action.takeProfit = args.takeProfit;
            if (args.trailingStopPct) action.trailingStopPct = args.trailingStopPct;
            if (args.trailingStopDollar) action.trailingStopDollar = args.trailingStopDollar;

            const conditionalOrder = await botExecutorService.createConditionalOrder(
              userId,
              {
                symbol: args.symbol,
                condition: args.condition,
                triggerPrice: args.triggerPrice,
                action,
                expiresInHours: args.expiresInHours,
              }
            );

            tradeExecuted = true;  // Signal frontend to refresh rules/trades

            // Build response
            let orderDetails = `Conditional Order Created!
ID: ${conditionalOrder.id}
Symbol: ${args.symbol}
Condition: When price is ${args.condition} $${args.triggerPrice.toLocaleString()}
Action: ${args.side.toUpperCase()} ${args.amountType === 'percentage' ? `${args.amount}% of available balance` : args.amountType === 'quote' ? `$${args.amount} worth` : `${args.amount} units`}
Order Type: ${args.orderType || 'market'}`;

            if (args.stopLoss) orderDetails += `\nStop-Loss: $${args.stopLoss.toLocaleString()}`;
            if (args.takeProfit) orderDetails += `\nTake-Profit: $${args.takeProfit.toLocaleString()}`;
            if (args.trailingStopPct) orderDetails += `\nTrailing Stop: ${args.trailingStopPct}%`;
            if (args.trailingStopDollar) orderDetails += `\nTrailing Stop: $${args.trailingStopDollar} drop from peak`;
            if (conditionalOrder.expiresAt) orderDetails += `\nExpires: ${new Date(conditionalOrder.expiresAt).toISOString()}`;

            toolResult = orderDetails;
            break;
          }

          case 'list_conditional_orders': {
            const status = args.status || 'active';
            const orders = await botExecutorService.getConditionalOrders(userId, status === 'all' ? undefined : status);

            if (orders.length === 0) {
              toolResult = status === 'all' ? 'No conditional orders found.' : `No ${status} conditional orders.`;
            } else {
              const orderList = orders.map(o => {
                let desc = `- [${o.id}] ${o.symbol}: ${o.condition} $${o.triggerPrice.toLocaleString()} -> ${o.action.side.toUpperCase()}`;
                if (o.action.amountType === 'percentage') desc += ` ${o.action.amount}%`;
                else if (o.action.amountType === 'quote') desc += ` $${o.action.amount}`;
                else desc += ` ${o.action.amount}`;
                desc += ` (${o.status})`;
                return desc;
              }).join('\n');

              toolResult = `Conditional Orders (${status}):\n${orderList}`;
            }
            break;
          }

          case 'cancel_conditional_order': {
            if (!args.orderId) {
              toolResult = 'Order ID is required';
              break;
            }

            const cancelled = await botExecutorService.cancelConditionalOrder(userId, args.orderId);
            toolResult = cancelled
              ? `Conditional order ${args.orderId} cancelled successfully.`
              : `Failed to cancel order ${args.orderId}. It may not exist or already be triggered.`;
            break;
          }

          case 'display_content': {
            const action = args.action as string;

            switch (action) {
              case 'show_chart': {
                if (!args.symbol) {
                  toolResult = 'Error: symbol is required for show_chart';
                  break;
                }
                let symbol = args.symbol.toUpperCase();
                // Remove common quote currencies if present (we'll add USDC)
                const quoteCurrencies = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB'];
                for (const quote of quoteCurrencies) {
                  if (symbol.endsWith(quote) && symbol.length > quote.length) {
                    symbol = symbol.slice(0, -quote.length);
                    break;
                  }
                }
                // Add USDC as the standard quote currency
                const normalizedSymbol = `${symbol}USDC`;
                pendingDisplay = {
                  type: 'chart',
                  symbol: normalizedSymbol,
                };
                toolResult = `Switching display to ${normalizedSymbol} chart`;
                break;
              }

              case 'show_youtube': {
                if (!args.videoId) {
                  toolResult = 'Error: videoId is required for show_youtube';
                  break;
                }
                pendingDisplay = {
                  type: 'youtube',
                  videoId: args.videoId,
                  title: args.videoTitle,
                };
                toolResult = `Showing YouTube video: ${args.videoTitle || args.videoId}`;
                break;
              }

              case 'show_website': {
                if (!args.url) {
                  toolResult = 'Error: url is required for show_website';
                  break;
                }
                // Validate URL for security
                try {
                  const parsed = new URL(args.url);
                  if (!['http:', 'https:'].includes(parsed.protocol)) {
                    toolResult = 'Error: Only http and https URLs are allowed';
                    break;
                  }
                } catch {
                  toolResult = 'Error: Invalid URL format';
                  break;
                }
                pendingDisplay = {
                  type: 'website',
                  url: args.url,
                  title: args.title,
                };
                toolResult = `Showing website: ${args.title || args.url}`;
                break;
              }

              default:
                toolResult = `Unknown display action: ${action}`;
            }
            break;
          }

          case 'get_alpha_tokens': {
            const limit = Math.min(args.limit || 20, 50);
            const tokens = await tradingService.getAlphaTokens(limit);

            if (tokens.length === 0) {
              toolResult = 'No Alpha tokens found or service unavailable';
            } else {
              const sortBy = args.sortBy || 'volume';
              let sorted = [...tokens];

              if (sortBy === 'marketCap') {
                sorted.sort((a, b) => parseFloat(b.marketCap) - parseFloat(a.marketCap));
              } else if (sortBy === 'change24h') {
                sorted.sort((a, b) => parseFloat(b.percentChange24h) - parseFloat(a.percentChange24h));
              }
              // Already sorted by volume by default

              const tokenList = sorted.slice(0, limit).map((t, i) =>
                `${i + 1}. ${t.symbol} (${t.name}) - $${parseFloat(t.price).toFixed(6)} | ` +
                `24h: ${parseFloat(t.percentChange24h).toFixed(2)}% | ` +
                `Vol: $${(parseFloat(t.volume24h) / 1e6).toFixed(2)}M | ` +
                `Chain: ${t.chainName}`
              ).join('\n');

              toolResult = `Top ${Math.min(limit, sorted.length)} Alpha Tokens (by ${sortBy}):\n${tokenList}`;
            }
            break;
          }

          case 'get_alpha_prices': {
            const symbols = args.symbols as string[];
            if (!symbols || symbols.length === 0) {
              toolResult = 'Error: symbols array is required';
              break;
            }

            const prices = await tradingService.getAlphaPrices(symbols);

            if (prices.length === 0) {
              toolResult = `No prices found for: ${symbols.join(', ')}`;
            } else {
              const priceList = prices.map(p =>
                `${p.symbol} (${p.name}): $${p.price.toFixed(6)} | ` +
                `24h: ${p.change24h >= 0 ? '+' : ''}${p.change24h.toFixed(2)}% | ` +
                `Vol: $${(p.volume24h / 1e6).toFixed(2)}M | ` +
                `MCap: $${(p.marketCap / 1e6).toFixed(2)}M | ` +
                `Chain: ${p.chain}`
              ).join('\n');

              toolResult = `Alpha Token Prices:\n${priceList}`;
            }
            break;
          }

          case 'search_alpha_tokens': {
            const query = args.query as string;
            if (!query) {
              toolResult = 'Error: search query is required';
              break;
            }

            const results = await tradingService.searchAlphaTokens(query);

            if (results.length === 0) {
              toolResult = `No Alpha tokens found matching "${query}"`;
            } else {
              const searchResults = results.slice(0, 10).map((t, i) =>
                `${i + 1}. ${t.symbol} (${t.name}) - $${parseFloat(t.price).toFixed(6)} | ` +
                `24h: ${parseFloat(t.percentChange24h).toFixed(2)}% | ` +
                `Chain: ${t.chainName}`
              ).join('\n');

              toolResult = `Alpha tokens matching "${query}":\n${searchResults}`;
            }
            break;
          }

          case 'search_market_news': {
            const query = args.query as string;
            if (!query) {
              toolResult = 'Error: search query is required';
              break;
            }

            const maxResults = Math.min(args.maxResults || 5, 10);

            try {
              const searchResults = await searxngSearch(query, {
                engines: ['google', 'bing', 'duckduckgo'],
                categories: ['news', 'general'],
                maxResults,
              });

              if (searchResults.length === 0) {
                toolResult = `No news results found for "${query}". Try a different search term.`;
              } else {
                const resultList = searchResults.map((r, i) =>
                  `${i + 1}. **${r.title}**\n   ${r.snippet || 'No description'}\n   Source: ${r.url}`
                ).join('\n\n');

                toolResult = `Search results for "${query}":\n\n${resultList}\n\n` +
                  `Found ${searchResults.length} result(s). Use this information to answer the user's question about market news or events.`;
              }
            } catch (error) {
              toolResult = `Search failed: ${(error as Error).message}. Web search may be unavailable.`;
            }
            break;
          }

          case 'parse_trading_intent': {
            const naturalLanguageInput = args.naturalLanguageInput as string;
            const confirmCreate = args.confirmCreate as boolean || false;

            if (!naturalLanguageInput) {
              toolResult = 'Error: naturalLanguageInput is required';
              break;
            }

            // Parse the intent
            const parseResult = parseTradingIntent(naturalLanguageInput);

            if (!parseResult.success || !parseResult.intent) {
              toolResult = `Could not parse trading intent: ${parseResult.error}\n\nPlease rephrase your command. Examples:\n- "buy ETH for 15 USDC if ETH drops to 2700"\n- "sell 0.5 BTC when price reaches 70000"\n- "buy ETH if rsi is oversold and price below 2500"`;
              break;
            }

            // Generate summary
            const summary = summarizeIntent(parseResult.intent);

            if (!confirmCreate) {
              // Just show the parsed intent for confirmation
              toolResult = `Parsed Trading Intent (${(parseResult.confidence * 100).toFixed(0)}% confidence):\n\n${summary}\n\nShould I create this conditional order? Say "yes" or "confirm" to proceed.`;
              break;
            }

            // Validate the intent
            const validation = conditionalOrderService.validateIntent(parseResult.intent);
            if (!validation.valid) {
              toolResult = `Validation failed:\n- ${validation.errors.join('\n- ')}\n\nPlease correct and try again.`;
              break;
            }

            // Create the order
            const result = await conditionalOrderService.createFromNaturalLanguage(
              userId,
              naturalLanguageInput
            );

            if (result.success) {
              tradeExecuted = true;
              toolResult = `Conditional Order Created!\n\nID: ${result.orderId}\nSummary: ${result.summary}\n\nThe order will execute automatically when all conditions are met.`;
            } else {
              toolResult = `Failed to create order: ${result.error}`;
            }
            break;
          }

          case 'manage_trading_rule': {
            const ruleAction = args.action as string;
            const ruleId = args.ruleId as string | undefined;
            const ruleConfig = args.rule as {
              name: string;
              description?: string;
              enabled?: boolean;
              conditionLogic?: 'AND' | 'OR';
              conditions: Array<{
                type: 'price' | 'indicator' | 'change';
                symbol?: string;
                indicator?: string;
                timeframe?: string;
                operator: string;
                value: number;
              }>;
              actions: Array<{
                type: 'buy' | 'sell' | 'alert';
                symbol?: string;
                amountType?: 'quote' | 'base' | 'percent';
                amount?: number;
                orderType?: 'market' | 'limit';
                stopLoss?: number;
                takeProfit?: number;
              }>;
              maxExecutions?: number;
              cooldownMinutes?: number;
            } | undefined;

            switch (ruleAction) {
              case 'list': {
                const rules = await tradingService.getTradingRules(userId);
                if (rules.length === 0) {
                  toolResult = 'No trading rules configured. You can ask me to create one!';
                } else {
                  const ruleList = rules.map((r, i) => {
                    const condStr = r.conditions.map(c => {
                      if (c.type === 'indicator') {
                        return `${c.indicator?.toUpperCase()}(${c.timeframe}) ${c.operator} ${c.value}`;
                      } else if (c.type === 'price') {
                        return `${c.symbol} price ${c.operator} $${c.value}`;
                      } else if (c.type === 'change') {
                        return `${c.symbol} change ${c.operator} ${c.value}%`;
                      }
                      return `${c.type} ${c.operator} ${c.value}`;
                    }).join(` ${r.conditionLogic} `);

                    const actStr = r.actions.map(a => {
                      if (a.type === 'alert') return 'Send Alert';
                      const amt = a.amountType === 'quote' ? `$${a.amount}` :
                        a.amountType === 'percent' ? `${a.amount}%` : `${a.amount}`;
                      return `${a.type.toUpperCase()} ${amt}`;
                    }).join(', ');

                    return `${i + 1}. **${r.name}** [${r.enabled ? 'ACTIVE' : 'DISABLED'}]\n   ID: ${r.id}\n   When: ${condStr}\n   Then: ${actStr}`;
                  }).join('\n\n');

                  toolResult = `Trading Rules (${rules.length}):\n\n${ruleList}`;
                }
                break;
              }

              case 'create': {
                if (!ruleConfig) {
                  toolResult = 'Error: rule configuration is required for create action';
                  break;
                }

                // Generate unique IDs for conditions and actions
                const generateId = () => Math.random().toString(36).substring(2, 9);

                const ruleInput = {
                  name: ruleConfig.name,
                  description: ruleConfig.description || '',
                  enabled: ruleConfig.enabled !== false,
                  conditionLogic: ruleConfig.conditionLogic || 'AND' as const,
                  conditions: ruleConfig.conditions.map(c => ({
                    id: generateId(),
                    type: c.type,
                    symbol: c.symbol,
                    indicator: c.indicator,
                    timeframe: c.timeframe || '5m',
                    operator: c.operator,
                    value: c.value,
                  })),
                  actions: ruleConfig.actions.map(a => ({
                    id: generateId(),
                    type: a.type,
                    symbol: a.symbol,
                    amountType: a.amountType || 'quote' as const,
                    amount: a.amount || 0,
                    orderType: a.orderType || 'market' as const,
                    stopLoss: a.stopLoss,
                    takeProfit: a.takeProfit,
                  })),
                  maxExecutions: ruleConfig.maxExecutions,
                  cooldownMinutes: ruleConfig.cooldownMinutes,
                };

                const newRule = await tradingService.createTradingRule(userId, ruleInput);

                // Format conditions for display
                const condDisplay = newRule.conditions.map(c => {
                  if (c.type === 'indicator') {
                    return `${c.indicator?.toUpperCase()}(${c.timeframe}) ${c.operator} ${c.value}`;
                  } else if (c.type === 'price') {
                    return `${c.symbol} price ${c.operator} $${c.value}`;
                  }
                  return `${c.type} ${c.operator} ${c.value}`;
                }).join(` ${newRule.conditionLogic} `);

                const actDisplay = newRule.actions.map(a => {
                  if (a.type === 'alert') return 'Send Alert';
                  const amt = a.amountType === 'quote' ? `$${a.amount}` :
                    a.amountType === 'percent' ? `${a.amount}%` : `${a.amount}`;
                  let result = `${a.type.toUpperCase()} ${amt}`;
                  if (a.stopLoss) result += ` (SL: ${a.stopLoss}%)`;
                  if (a.takeProfit) result += ` (TP: ${a.takeProfit}%)`;
                  return result;
                }).join(', ');

                toolResult = `Trading Rule Created!\n\n**${newRule.name}**\nID: ${newRule.id}\nStatus: ${newRule.enabled ? 'ACTIVE' : 'DISABLED'}\n\nConditions: ${condDisplay}\nActions: ${actDisplay}`;

                if (newRule.maxExecutions) {
                  toolResult += `\nMax Executions: ${newRule.maxExecutions}`;
                }
                if (newRule.cooldownMinutes) {
                  toolResult += `\nCooldown: ${newRule.cooldownMinutes} minutes`;
                }

                toolResult += '\n\nThe rule will execute automatically when conditions are met.';
                break;
              }

              case 'delete': {
                if (!ruleId) {
                  toolResult = 'Error: ruleId is required for delete action';
                  break;
                }

                await tradingService.deleteTradingRule(userId, ruleId);
                toolResult = `Trading rule ${ruleId} has been deleted.`;
                break;
              }

              case 'toggle': {
                if (!ruleId) {
                  toolResult = 'Error: ruleId is required for toggle action';
                  break;
                }

                // Get current rule
                const rules = await tradingService.getTradingRules(userId);
                const currentRule = rules.find(r => r.id === ruleId);
                if (!currentRule) {
                  toolResult = `Rule ${ruleId} not found.`;
                  break;
                }

                // Toggle enabled status
                const updatedRule = await tradingService.updateTradingRule(userId, ruleId, {
                  ...currentRule,
                  enabled: !currentRule.enabled,
                });

                toolResult = `Trading rule "${updatedRule.name}" is now ${updatedRule.enabled ? 'ENABLED' : 'DISABLED'}.`;
                break;
              }

              case 'update': {
                if (!ruleId || !ruleConfig) {
                  toolResult = 'Error: ruleId and rule configuration are required for update action';
                  break;
                }

                const generateId = () => Math.random().toString(36).substring(2, 9);

                const updateInput = {
                  id: ruleId,
                  name: ruleConfig.name,
                  description: ruleConfig.description || '',
                  enabled: ruleConfig.enabled !== false,
                  conditionLogic: ruleConfig.conditionLogic || 'AND' as const,
                  conditions: ruleConfig.conditions.map(c => ({
                    id: generateId(),
                    type: c.type,
                    symbol: c.symbol,
                    indicator: c.indicator,
                    timeframe: c.timeframe || '5m',
                    operator: c.operator,
                    value: c.value,
                  })),
                  actions: ruleConfig.actions.map(a => ({
                    id: generateId(),
                    type: a.type,
                    symbol: a.symbol,
                    amountType: a.amountType || 'quote' as const,
                    amount: a.amount || 0,
                    orderType: a.orderType || 'market' as const,
                    stopLoss: a.stopLoss,
                    takeProfit: a.takeProfit,
                  })),
                  maxExecutions: ruleConfig.maxExecutions,
                  cooldownMinutes: ruleConfig.cooldownMinutes,
                };

                const updated = await tradingService.updateTradingRule(userId, ruleId, updateInput);
                toolResult = `Trading rule "${updated.name}" has been updated.`;
                break;
              }

              default:
                toolResult = `Unknown rule action: ${ruleAction}. Valid actions: create, list, update, delete, toggle`;
            }
            break;
          }

          // Auto Trading Tools
          case 'get_auto_trading_state': {
            const state = await autoTradingService.getState(userId);
            const settings = await autoTradingService.getSettings(userId);
            const statusEmoji = settings.enabled && state.isRunning ? '🟢' : state.isPaused ? '🟡' : '🔴';
            toolResult = `**Auto Trading Status** ${statusEmoji}

Enabled: ${settings.enabled ? 'Yes' : 'No'}
Running: ${state.isRunning ? 'Yes' : 'No'}${state.isPaused ? ` (Paused: ${state.pauseReason})` : ''}
Active Positions: ${state.activePositions}
Today's P&L: ${state.dailyPnlUsd >= 0 ? '+' : ''}$${state.dailyPnlUsd.toFixed(2)} (${state.dailyPnlPct.toFixed(2)}%)
Trades Today: ${state.tradesCount} (${state.winsCount} wins, ${state.lossesCount} losses)
Consecutive Losses: ${state.consecutiveLosses}`;
            break;
          }

          case 'get_auto_trading_settings': {
            const settings = await autoTradingService.getSettings(userId);
            toolResult = `**Auto Trading Settings**

Enabled: ${settings.enabled ? 'Yes' : 'No'}
Strategy: ${settings.strategy} (${settings.strategyMode} mode)
Position Size: $${settings.minPositionUsd} - $${settings.maxPositionUsd}
Max Positions: ${settings.maxPositions}
Daily Loss Limit: ${settings.dailyLossLimitPct}%
Max Consecutive Losses: ${settings.maxConsecutiveLosses}
Symbol Cooldown: ${settings.symbolCooldownMinutes} minutes
Min Profit Threshold: ${settings.minProfitPct}%
Dual Mode: ${settings.dualModeEnabled ? 'Enabled' : 'Disabled'}
Exclude Top 10: ${settings.excludeTop10 ? 'Yes' : 'No'}
BTC Trend Filter: ${settings.btcTrendFilter ? 'On' : 'Off'}`;
            break;
          }

          case 'get_auto_trading_signals': {
            const limit = Math.min((args.limit as number) || 50, 100);
            const signals = await autoTradingService.getSignalHistory(userId, limit);
            if (signals.length === 0) {
              toolResult = 'No auto trading signals in history.';
            } else {
              const signalList = signals.slice(0, 15).map(s => {
                const statusIcon = s.executed ? '✅' : '⏭️';
                const backtestIcon = s.backtestStatus === 'win' ? '🟢' : s.backtestStatus === 'loss' ? '🔴' : '⏳';
                const symbol = s.symbol.replace('_USD', '').replace('USDT', '');
                return `${statusIcon} ${symbol}: RSI ${s.rsi.toFixed(1)}, Conf ${(s.confidence * 100).toFixed(0)}% ${backtestIcon}${s.skipReason ? ` (${s.skipReason})` : ''}`;
              }).join('\n');
              toolResult = `**Recent Auto Trading Signals** (${signals.length} total)\n\n${signalList}`;
            }
            break;
          }

          case 'get_auto_trading_history': {
            const history = await autoTradingService.getHistory(userId);
            if (history.length === 0) {
              toolResult = 'No auto trades today.';
            } else {
              const tradeList = history.slice(0, 15).map(t => {
                const pnlPct = t.closePrice && t.entryPrice
                  ? (((t.closePrice - t.entryPrice) / t.entryPrice) * 100).toFixed(2)
                  : 'open';
                const outcomeIcon = t.outcome === 'win' ? '🟢' : t.outcome === 'loss' ? '🔴' : '⏳';
                const symbol = t.symbol.replace('_USD', '').replace('USDT', '');
                return `${outcomeIcon} ${symbol}: $${t.entryPrice.toFixed(4)} -> ${t.closePrice ? '$' + t.closePrice.toFixed(4) : 'open'} (${pnlPct}%)`;
              }).join('\n');
              toolResult = `**Today's Auto Trades** (${history.length})\n\n${tradeList}`;
            }
            break;
          }

          case 'control_auto_trading': {
            const action = args.action as string;
            if (action === 'start') {
              await autoTradingService.startAutoTrading(userId);
              const state = await autoTradingService.getState(userId);
              toolResult = `Auto trading started! Active positions: ${state.activePositions}, Daily P&L: $${state.dailyPnlUsd.toFixed(2)}`;
            } else {
              await autoTradingService.stopAutoTrading(userId);
              toolResult = 'Auto trading stopped.';
            }
            break;
          }

          case 'get_auto_trading_performance': {
            const performance = await autoTradingService.getStrategyPerformance(userId);
            if (Object.keys(performance).length === 0) {
              toolResult = 'No strategy performance data available yet. Execute some auto trades to collect data.';
            } else {
              const perfList = Object.entries(performance).map(([strategy, stats]) => {
                const winRate = stats.totalTrades > 0 ? ((stats.wins / stats.totalTrades) * 100).toFixed(0) : '0';
                return `**${strategy}**: ${stats.totalTrades} trades, ${winRate}% win rate, avg P&L ${stats.avgPnlPct >= 0 ? '+' : ''}${stats.avgPnlPct.toFixed(2)}%`;
              }).join('\n');
              toolResult = `**Strategy Performance**\n\n${perfList}`;
            }
            break;
          }

          default:
            toolResult = `Unknown tool: ${toolCall.function.name}`;
        }
      } catch (error) {
        logger.error('Trading tool error', {
          tool: toolCall.function.name,
          error: (error as Error).message,
        });
        toolResult = `Error executing ${toolCall.function.name}: ${(error as Error).message}`;
      }

      // Add tool result to conversation
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      } as ChatMessage);
    }

    // Get final response after tool execution
    completion = await createChatCompletion({
      messages,
      tools: tradingTools,
      provider: modelConfig.provider,
      model: modelConfig.model,
      loggingContext: {
        userId,
        sessionId,
        source: 'trading-chat',
        nodeName: 'trading_tool_followup',
      },
    });
  }

  // Handle empty response gracefully
  let responseContent = completion.content;
  if (!responseContent || responseContent.trim() === '') {
    logger.warn('Empty response from trading LLM', { sessionId, userId, toolCallIterations, tradeExecuted });
    // Provide a fallback response based on what happened
    if (tradeExecuted) {
      // Trade was actually executed during tool processing
      responseContent = 'Order has been executed. Check your portfolio for the updated position.';
    } else if (toolCallIterations > 0) {
      responseContent = 'I processed your request. Is there anything else you need?';
    } else {
      responseContent = 'I processed your request but couldn\'t generate a detailed response. Please try again or rephrase your question.';
    }
  }

  // Save assistant response
  const assistantMessageId = await addMessage(sessionId, 'assistant', responseContent);

  return {
    messageId: assistantMessageId,
    content: responseContent,
    tokensUsed: completion.tokensUsed || 0,
    display: pendingDisplay,
    tradeExecuted,
  };
}

/**
 * Create trading recommendation and log it
 */
export async function logRecommendation(
  userId: string,
  symbol: string,
  action: string,
  entry: number,
  stopLoss: number,
  takeProfit: number,
  reasoning: string,
  confidence: string
): Promise<void> {
  await db.query(
    `INSERT INTO trading_recommendations
     (id, user_id, symbol, action, entry_price, stop_loss, take_profit, reasoning, confidence)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, symbol, action, entry, stopLoss, takeProfit, reasoning, confidence]
  );
}
