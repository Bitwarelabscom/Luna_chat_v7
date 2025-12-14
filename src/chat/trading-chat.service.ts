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
import * as botExecutorService from '../trading/bot-executor.service.js';
import { search as searxngSearch } from '../search/searxng.client.js';
import { pool as db } from '../db/index.js';
import logger from '../utils/logger.js';
import type { Portfolio } from '../trading/trading.service.js';

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

const getPricesTool = {
  type: 'function' as const,
  function: {
    name: 'get_prices',
    description: 'Get current prices for specified trading pairs. Call without symbols to get all watched pairs.',
    parameters: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Trading pair symbols (e.g., ["BTCUSDC", "ETHUSDC"]). Leave empty for default pairs.',
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

const placeOrderTool = {
  type: 'function' as const,
  function: {
    name: 'place_order',
    description: 'Place a buy or sell order on Binance. ALWAYS confirm with user before executing.',
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
      },
      required: ['symbol', 'side', 'type', 'quantity'],
    },
  },
};

const manageBotTool = {
  type: 'function' as const,
  function: {
    name: 'manage_bot',
    description: 'Create, start, stop, or configure trading bots',
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
          description: 'Bot configuration (for create action)',
          properties: {
            name: { type: 'string' },
            type: {
              type: 'string',
              enum: ['grid', 'dca', 'rsi', 'ma_crossover', 'custom'],
            },
            symbol: { type: 'string' },
            parameters: { type: 'object' },
          },
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

const tradingTools = [
  getPortfolioTool,
  getPricesTool,
  getKlinesTool,
  placeOrderTool,
  manageBotTool,
  createConditionalOrderTool,
  listConditionalOrdersTool,
  cancelConditionalOrderTool,
  displayContentTool,
  getAlphaTokensTool,
  getAlphaPricesTool,
  searchAlphaTokensTool,
  searchMarketNewsTool,
];

export interface TradingChatInput {
  sessionId: string;
  userId: string;
  message: string;
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
  const { sessionId, userId, message } = input;

  // Get model config (use main chat config for trading)
  const modelConfig = await getUserModelConfig(userId, 'main_chat');

  // Get trading settings for context
  const settings = await tradingService.getSettings(userId);

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
  });

  // Handle tool calls
  let pendingDisplay: DisplayContent | undefined;

  if (completion.toolCalls && completion.toolCalls.length > 0) {
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
              const holdings = portfolio.holdings
                .map(h => `${h.asset}: ${h.amount.toFixed(6)} (${h.allocationPct.toFixed(1)}%)`)
                .join('\n');
              toolResult = `Portfolio Summary:
Total Value: $${portfolio.totalValueUsdt.toLocaleString()}
Available USDT: $${portfolio.availableUsdt.toLocaleString()}
24h P&L: ${portfolio.dailyPnl >= 0 ? '+' : ''}$${portfolio.dailyPnl.toFixed(2)} (${portfolio.dailyPnlPct.toFixed(2)}%)

Holdings:
${holdings}`;
            } else {
              toolResult = 'Unable to fetch portfolio. Please ensure Binance is connected.';
            }
            break;
          }

          case 'get_prices': {
            const symbols = args.symbols || ['BTCUSDC', 'ETHUSDC', 'BNBUSDC', 'SOLUSDC'];
            const prices = await tradingService.getPrices(userId, symbols);
            if (prices.length > 0) {
              toolResult = prices.map(p =>
                `${p.symbol}: $${p.price.toLocaleString()} (${p.change24h >= 0 ? '+' : ''}${p.change24h.toFixed(2)}%)`
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
              const latestOpen = parseFloat(klines[klines.length - 1].open);
              const latestHigh = parseFloat(klines[klines.length - 1].high);
              const latestLow = parseFloat(klines[klines.length - 1].low);
              const latestClose = parseFloat(klines[klines.length - 1].close);
              const latestVolume = parseFloat(klines[klines.length - 1].volume);
              const prevClose = parseFloat(klines[klines.length - 2].close);

              // Simple RSI calculation (14 period)
              let rsi = 'N/A';
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
                rsi = (100 - (100 / (1 + rs))).toFixed(1);
              }

              // Recent high/low
              const recentHigh = Math.max(...highs.slice(-20));
              const recentLow = Math.min(...lows.slice(-20));

              toolResult = `${args.symbol} Analysis (${args.interval || '1h'}):
Latest: O:$${latestOpen.toFixed(2)} H:$${latestHigh.toFixed(2)} L:$${latestLow.toFixed(2)} C:$${latestClose.toFixed(2)}
Change: ${((latestClose - prevClose) / prevClose * 100).toFixed(2)}%
Volume: ${latestVolume.toLocaleString()}
RSI(14): ${rsi}
20-period Range: $${recentLow.toFixed(2)} - $${recentHigh.toFixed(2)}`;
            } else {
              toolResult = `Unable to fetch klines for ${args.symbol}`;
            }
            break;
          }

          case 'place_order': {
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
              // Default to USDC if not found
              tradingSymbol = `${tradingSymbol}USDC`;
            }

            // Execute the order
            const order = await tradingService.placeOrder(userId, {
              symbol: tradingSymbol,
              side: args.side,
              type: args.type,
              quantity: args.quantity,
              price: args.price,
            });

            if (order) {
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
            break;
          }

          case 'manage_bot': {
            switch (args.action) {
              case 'list': {
                const bots = await tradingService.getBots(userId);
                if (bots.length > 0) {
                  toolResult = 'Active Bots:\n' + bots.map(b =>
                    `- ${b.name} (${b.type}): ${b.status} | ${b.symbol} | Trades: ${b.totalTrades} | P&L: $${b.totalProfit.toFixed(2)}`
                  ).join('\n');
                } else {
                  toolResult = 'No trading bots configured.';
                }
                break;
              }

              case 'create': {
                if (!args.config) {
                  toolResult = 'Bot configuration required for create action';
                } else {
                  const bot = await tradingService.createBot(userId, args.config);
                  toolResult = `Bot "${bot.name}" created successfully!\nID: ${bot.id}\nType: ${bot.type}\nSymbol: ${bot.symbol}\nStatus: ${bot.status}`;
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
                    toolResult = `Bot Status:
Name: ${bot.name}
Type: ${bot.type}
Symbol: ${bot.symbol}
Status: ${bot.status}
Total Trades: ${bot.totalTrades}
Total Profit: $${bot.totalProfit.toFixed(2)}`;
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
                let desc = `- [${o.id.slice(0, 8)}] ${o.symbol}: ${o.condition} $${o.triggerPrice.toLocaleString()} -> ${o.action.side.toUpperCase()}`;
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
    });
  }

  // Save assistant response
  const assistantMessageId = await addMessage(sessionId, 'assistant', completion.content);

  return {
    messageId: assistantMessageId,
    content: completion.content,
    tokensUsed: completion.tokensUsed || 0,
    display: pendingDisplay,
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
