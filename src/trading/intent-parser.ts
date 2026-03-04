/**
 * Trading Intent Parser
 *
 * Parses natural language trading commands into structured conditional orders.
 *
 * Examples:
 * - "buy ETH for 15 USDC if ETH drops to 2700"
 * - "buy ETH for 15 USDC if ETH drops to 2700 and rsi is oversold"
 * - "buy ETH for 15 USDC if ETH drops to 2700 and rsi is oversold then start trailing SL when ETH hits 2800 set SL at 2770"
 * - "sell 0.5 ETH when price reaches 3000"
 * - "buy BTC worth 100 USDT if rsi below 30"
 */

export type ConditionType = 'price' | 'rsi' | 'macd' | 'ema' | 'sma' | 'volume';
export type Operator = '<' | '<=' | '>' | '>=' | 'crosses_above' | 'crosses_below';
export type Logic = 'AND' | 'OR';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export interface Condition {
  type: ConditionType;
  operator: Operator;
  value: number;
  period?: number;
}

export interface TriggerConditions {
  logic: Logic;
  conditions: Condition[];
}

export interface TrailingStopConfig {
  activation_price: number;
  callback_rate: number;
  initial_stop: number;
}

export interface FollowUp {
  trailing_stop?: TrailingStopConfig;
  stop_loss?: number;
  take_profit?: number;
}

export interface ParsedTradingIntent {
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  quantity?: string;
  quote_order_qty?: string;
  price?: string;
  trigger_conditions: TriggerConditions;
  follow_up?: FollowUp;
  raw_input: string;
}

export interface ParseResult {
  success: boolean;
  intent?: ParsedTradingIntent;
  error?: string;
  confidence: number;
}

// Common trading pairs and their quote assets
const QUOTE_ASSETS = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB'];
const BASE_ASSETS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI', 'ATOM', 'LTC', 'NEAR'];

// RSI levels
const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;

export function parseTradingIntent(input: string): ParseResult {
  const normalizedInput = input.toLowerCase().trim();

  // Check if this looks like a trading command
  if (!looksLikeTradingCommand(normalizedInput)) {
    return {
      success: false,
      error: 'Input does not appear to be a trading command',
      confidence: 0
    };
  }

  try {
    // Parse the basic order details
    const orderDetails = parseOrderDetails(normalizedInput);
    if (!orderDetails) {
      return {
        success: false,
        error: 'Could not parse order details (action, asset, amount)',
        confidence: 0.2
      };
    }

    // Parse trigger conditions
    const conditions = parseConditions(normalizedInput, orderDetails.baseAsset);
    if (conditions.length === 0) {
      return {
        success: false,
        error: 'No trigger conditions found. Use phrases like "if price drops to X" or "when rsi is oversold"',
        confidence: 0.3
      };
    }

    // Parse follow-up actions (trailing stop, stop loss, take profit)
    const followUp = parseFollowUp(normalizedInput, orderDetails.baseAsset);

    // Determine logic (AND/OR)
    const logic = determineLogic(normalizedInput);

    // Build the symbol
    const symbol = `${orderDetails.baseAsset}${orderDetails.quoteAsset}`;

    const intent: ParsedTradingIntent = {
      symbol,
      side: orderDetails.side,
      order_type: orderDetails.orderType,
      trigger_conditions: {
        logic,
        conditions
      },
      raw_input: input
    };

    // Add quantity or quote quantity
    if (orderDetails.quoteAmount) {
      intent.quote_order_qty = orderDetails.quoteAmount.toString();
    } else if (orderDetails.baseAmount) {
      intent.quantity = orderDetails.baseAmount.toString();
    }

    // Add limit price if specified
    if (orderDetails.limitPrice) {
      intent.price = orderDetails.limitPrice.toString();
    }

    // Add follow-up if present
    if (followUp) {
      intent.follow_up = followUp;
    }

    return {
      success: true,
      intent,
      confidence: calculateConfidence(intent, conditions.length)
    };
  } catch (error) {
    return {
      success: false,
      error: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      confidence: 0
    };
  }
}

function looksLikeTradingCommand(input: string): boolean {
  const tradingKeywords = ['buy', 'sell', 'purchase', 'long', 'short', 'trade'];
  const conditionKeywords = ['if', 'when', 'once', 'after'];

  const hasTradeKeyword = tradingKeywords.some(kw => input.includes(kw));
  const hasConditionKeyword = conditionKeywords.some(kw => input.includes(kw));
  const hasAsset = [...BASE_ASSETS, ...QUOTE_ASSETS].some(asset =>
    input.toUpperCase().includes(asset)
  );

  return hasTradeKeyword && (hasConditionKeyword || hasAsset);
}

interface OrderDetails {
  side: OrderSide;
  orderType: OrderType;
  baseAsset: string;
  quoteAsset: string;
  baseAmount?: number;
  quoteAmount?: number;
  limitPrice?: number;
}

function parseOrderDetails(input: string): OrderDetails | null {
  // Determine side
  let side: OrderSide = 'BUY';
  if (input.includes('sell') || input.includes('short')) {
    side = 'SELL';
  }

  // Default to market order
  let orderType: OrderType = 'MARKET';
  if (input.includes('limit')) {
    orderType = 'LIMIT';
  }

  // Find the base asset
  let baseAsset: string | null = null;
  let quoteAsset = 'USDT'; // Default quote asset

  for (const asset of BASE_ASSETS) {
    const regex = new RegExp(`\\b${asset.toLowerCase()}\\b`, 'i');
    if (regex.test(input)) {
      baseAsset = asset;
      break;
    }
  }

  if (!baseAsset) {
    return null;
  }

  // Find quote asset
  for (const asset of QUOTE_ASSETS) {
    if (asset !== baseAsset) {
      const regex = new RegExp(`\\b${asset.toLowerCase()}\\b`, 'i');
      if (regex.test(input)) {
        quoteAsset = asset;
        break;
      }
    }
  }

  // Parse amounts
  let baseAmount: number | undefined;
  let quoteAmount: number | undefined;

  // Pattern: "buy ETH for 15 USDC" or "buy 15 USDC worth of ETH"
  const forPattern = new RegExp(`for\\s+(\\d+(?:\\.\\d+)?)\\s*${quoteAsset}`, 'i');
  const worthPattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${quoteAsset}\\s*(?:worth|of)`, 'i');

  let forMatch = input.match(forPattern);
  let worthMatch = input.match(worthPattern);

  if (forMatch) {
    quoteAmount = parseFloat(forMatch[1]);
  } else if (worthMatch) {
    quoteAmount = parseFloat(worthMatch[1]);
  }

  // Pattern: "sell 0.5 ETH" or "buy 2 ETH"
  const quantityPattern = new RegExp(`(?:buy|sell|purchase)\\s+(\\d+(?:\\.\\d+)?)\\s*${baseAsset}`, 'i');
  const quantityMatch = input.match(quantityPattern);

  if (quantityMatch && !quoteAmount) {
    baseAmount = parseFloat(quantityMatch[1]);
  }

  // Parse limit price if present
  let limitPrice: number | undefined;
  const limitPattern = /(?:at|limit|price)\s*(?:of|at|:)?\s*\$?([\d,]+(?:\.\d+)?)/i;
  const limitMatch = input.match(limitPattern);
  if (limitMatch) {
    limitPrice = parseFloat(limitMatch[1].replace(/,/g, ''));
    orderType = 'LIMIT';
  }

  return {
    side,
    orderType,
    baseAsset,
    quoteAsset,
    baseAmount,
    quoteAmount,
    limitPrice
  };
}

function parseConditions(input: string, baseAsset: string): Condition[] {
  const conditions: Condition[] = [];

  // Price conditions
  // "if ETH drops to 2700" or "when price reaches 3000" or "if price below 2700"
  const priceDropPattern = /(?:drops?|falls?|dips?)\s*(?:to|below)?\s*\$?([\d,]+(?:\.\d+)?)/i;
  const priceRisePattern = /(?:reaches?|hits?|rises?\s*to|goes?\s*(?:up\s*)?to|above)\s*\$?([\d,]+(?:\.\d+)?)/i;
  const priceBelowPattern = new RegExp(`(?:price|${baseAsset})\\s*(?:is\\s*)?(?:below|under|less\\s*than)\\s*\\$?([\\d,]+(?:\\.\\d+)?)`, 'i');
  const priceAbovePattern = new RegExp(`(?:price|${baseAsset})\\s*(?:is\\s*)?(?:above|over|greater\\s*than|more\\s*than)\\s*\\$?([\\d,]+(?:\\.\\d+)?)`, 'i');

  let priceMatch = input.match(priceDropPattern);
  if (priceMatch) {
    conditions.push({
      type: 'price',
      operator: '<=',
      value: parseFloat(priceMatch[1].replace(/,/g, ''))
    });
  }

  priceMatch = input.match(priceRisePattern);
  if (priceMatch && conditions.filter(c => c.type === 'price').length === 0) {
    conditions.push({
      type: 'price',
      operator: '>=',
      value: parseFloat(priceMatch[1].replace(/,/g, ''))
    });
  }

  priceMatch = input.match(priceBelowPattern);
  if (priceMatch && conditions.filter(c => c.type === 'price').length === 0) {
    conditions.push({
      type: 'price',
      operator: '<',
      value: parseFloat(priceMatch[1].replace(/,/g, ''))
    });
  }

  priceMatch = input.match(priceAbovePattern);
  if (priceMatch && conditions.filter(c => c.type === 'price').length === 0) {
    conditions.push({
      type: 'price',
      operator: '>',
      value: parseFloat(priceMatch[1].replace(/,/g, ''))
    });
  }

  // RSI conditions
  // "rsi is oversold" or "rsi below 30" or "rsi overbought"
  if (input.includes('rsi')) {
    const rsiOversoldPattern = /rsi\s*(?:is\s*)?(?:oversold|below\s*30|under\s*30|<\s*30)/i;
    const rsiOverboughtPattern = /rsi\s*(?:is\s*)?(?:overbought|above\s*70|over\s*70|>\s*70)/i;
    const rsiValuePattern = /rsi\s*(?:is\s*)?(?:below|under|<)\s*(\d+)/i;
    const rsiAbovePattern = /rsi\s*(?:is\s*)?(?:above|over|>)\s*(\d+)/i;

    if (rsiOversoldPattern.test(input)) {
      conditions.push({
        type: 'rsi',
        operator: '<',
        value: RSI_OVERSOLD,
        period: 14
      });
    } else if (rsiOverboughtPattern.test(input)) {
      conditions.push({
        type: 'rsi',
        operator: '>',
        value: RSI_OVERBOUGHT,
        period: 14
      });
    } else {
      const rsiMatch = input.match(rsiValuePattern);
      if (rsiMatch) {
        conditions.push({
          type: 'rsi',
          operator: '<',
          value: parseFloat(rsiMatch[1]),
          period: 14
        });
      } else {
        const rsiAboveMatch = input.match(rsiAbovePattern);
        if (rsiAboveMatch) {
          conditions.push({
            type: 'rsi',
            operator: '>',
            value: parseFloat(rsiAboveMatch[1]),
            period: 14
          });
        }
      }
    }
  }

  // MACD conditions
  // "macd crosses above signal" or "macd bullish crossover"
  if (input.includes('macd')) {
    if (input.includes('bullish') || input.includes('crosses above') || input.includes('cross above')) {
      conditions.push({
        type: 'macd',
        operator: 'crosses_above',
        value: 0, // Signal line
        period: 26
      });
    } else if (input.includes('bearish') || input.includes('crosses below') || input.includes('cross below')) {
      conditions.push({
        type: 'macd',
        operator: 'crosses_below',
        value: 0,
        period: 26
      });
    }
  }

  // EMA/SMA conditions
  // "price above 200 ema" or "below 50 sma"
  const emaPattern = /(?:price\s*)?(?:above|below|crosses?)\s*(\d+)\s*(?:day\s*)?ema/i;
  const smaPattern = /(?:price\s*)?(?:above|below|crosses?)\s*(\d+)\s*(?:day\s*)?sma/i;

  const emaMatch = input.match(emaPattern);
  if (emaMatch) {
    const period = parseInt(emaMatch[1]);
    const isAbove = input.includes('above');
    conditions.push({
      type: 'ema',
      operator: isAbove ? '>' : '<',
      value: 0, // Will be calculated dynamically
      period
    });
  }

  const smaMatch = input.match(smaPattern);
  if (smaMatch) {
    const period = parseInt(smaMatch[1]);
    const isAbove = input.includes('above');
    conditions.push({
      type: 'sma',
      operator: isAbove ? '>' : '<',
      value: 0,
      period
    });
  }

  // Volume conditions
  // "volume above 1000000" or "high volume"
  const volumePattern = /volume\s*(?:above|over|greater\s*than)\s*([\d,]+)/i;
  const volumeMatch = input.match(volumePattern);
  if (volumeMatch) {
    conditions.push({
      type: 'volume',
      operator: '>',
      value: parseFloat(volumeMatch[1].replace(/,/g, ''))
    });
  }

  return conditions;
}

function parseFollowUp(input: string, _baseAsset: string): FollowUp | undefined {
  const followUp: FollowUp = {};
  let hasFollowUp = false;

  // Look for "then" clause which indicates follow-up actions
  const thenIndex = input.indexOf('then');
  if (thenIndex === -1) {
    return undefined;
  }

  const afterThen = input.substring(thenIndex);

  // Trailing stop patterns
  // "start trailing SL when ETH hits 2800 set SL at 2770"
  // "trailing stop at 2% callback"
  const trailingActivationPattern = /(?:start|activate|enable)\s*(?:trailing|trail)\s*(?:stop|sl)\s*(?:when|at|once)\s*(?:\w+\s*)?(?:hits?|reaches?|at)\s*\$?([\d,]+(?:\.\d+)?)/i;
  const trailingSLPattern = /(?:set|initial)\s*(?:sl|stop\s*loss?)\s*(?:at|to)\s*\$?([\d,]+(?:\.\d+)?)/i;
  const callbackPattern = /(?:callback|trail)\s*(?:rate|%)?\s*(?:at|of)?\s*(\d+(?:\.\d+)?)\s*%?/i;

  const activationMatch = afterThen.match(trailingActivationPattern);
  const slMatch = afterThen.match(trailingSLPattern);
  const callbackMatch = afterThen.match(callbackPattern);

  if (activationMatch || slMatch) {
    const activationPrice = activationMatch ? parseFloat(activationMatch[1].replace(/,/g, '')) : 0;
    const initialStop = slMatch ? parseFloat(slMatch[1].replace(/,/g, '')) : 0;
    const callbackRate = callbackMatch ? parseFloat(callbackMatch[1]) : 1.0; // Default 1% callback

    if (activationPrice || initialStop) {
      followUp.trailing_stop = {
        activation_price: activationPrice,
        callback_rate: callbackRate,
        initial_stop: initialStop
      };
      hasFollowUp = true;
    }
  }

  // Simple stop loss (not trailing)
  // "set stop loss at 2600"
  if (!followUp.trailing_stop) {
    const stopLossPattern = /(?:stop\s*loss|sl)\s*(?:at|to)\s*\$?([\d,]+(?:\.\d+)?)/i;
    const stopLossMatch = afterThen.match(stopLossPattern);
    if (stopLossMatch) {
      followUp.stop_loss = parseFloat(stopLossMatch[1].replace(/,/g, ''));
      hasFollowUp = true;
    }
  }

  // Take profit
  // "take profit at 3000" or "tp at 3000"
  const takeProfitPattern = /(?:take\s*profit|tp)\s*(?:at|to)\s*\$?([\d,]+(?:\.\d+)?)/i;
  const tpMatch = afterThen.match(takeProfitPattern);
  if (tpMatch) {
    followUp.take_profit = parseFloat(tpMatch[1].replace(/,/g, ''));
    hasFollowUp = true;
  }

  return hasFollowUp ? followUp : undefined;
}

function determineLogic(input: string): Logic {
  // Count "and" vs "or" in conditions section
  const conditionSection = input.split('then')[0]; // Only look at conditions, not follow-up

  const andCount = (conditionSection.match(/\band\b/gi) || []).length;
  const orCount = (conditionSection.match(/\bor\b/gi) || []).length;

  // Default to AND if both present or neither present
  return orCount > andCount ? 'OR' : 'AND';
}

function calculateConfidence(intent: ParsedTradingIntent, conditionCount: number): number {
  let confidence = 0.5; // Base confidence

  // Has valid symbol
  if (intent.symbol && intent.symbol.length >= 6) {
    confidence += 0.1;
  }

  // Has quantity or quote quantity
  if (intent.quantity || intent.quote_order_qty) {
    confidence += 0.15;
  }

  // Has conditions
  confidence += Math.min(conditionCount * 0.1, 0.2);

  // Has follow-up actions
  if (intent.follow_up) {
    confidence += 0.05;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Generate a human-readable summary of the parsed intent
 */
export function summarizeIntent(intent: ParsedTradingIntent): string {
  const parts: string[] = [];

  // Order action
  const amount = intent.quote_order_qty
    ? `${intent.quote_order_qty} ${intent.symbol.replace(/[A-Z]+$/, '').length > 0 ? intent.symbol.slice(-4) : 'USDT'} worth of`
    : intent.quantity || 'some';

  const baseAsset = intent.symbol.replace(/USDT|USDC|BUSD|USD|BTC|ETH|BNB$/, '');
  parts.push(`${intent.side} ${amount} ${baseAsset}`);

  // Order type
  if (intent.order_type === 'LIMIT' && intent.price) {
    parts.push(`at limit price $${intent.price}`);
  }

  // Conditions
  const conditionStrs = intent.trigger_conditions.conditions.map(c => {
    switch (c.type) {
      case 'price':
        return `price ${c.operator} $${c.value}`;
      case 'rsi':
        if (c.value === RSI_OVERSOLD) return 'RSI is oversold (< 30)';
        if (c.value === RSI_OVERBOUGHT) return 'RSI is overbought (> 70)';
        return `RSI ${c.operator} ${c.value}`;
      case 'macd':
        return c.operator === 'crosses_above' ? 'MACD bullish crossover' : 'MACD bearish crossover';
      case 'ema':
        return `price ${c.operator === '>' ? 'above' : 'below'} ${c.period}-period EMA`;
      case 'sma':
        return `price ${c.operator === '>' ? 'above' : 'below'} ${c.period}-period SMA`;
      case 'volume':
        return `volume ${c.operator} ${c.value}`;
      default:
        return `${c.type} ${c.operator} ${c.value}`;
    }
  });

  const logic = intent.trigger_conditions.logic === 'OR' ? ' OR ' : ' AND ';
  parts.push(`when ${conditionStrs.join(logic)}`);

  // Follow-up
  if (intent.follow_up) {
    const followUpParts: string[] = [];

    if (intent.follow_up.trailing_stop) {
      const ts = intent.follow_up.trailing_stop;
      followUpParts.push(`trailing stop (activates at $${ts.activation_price}, initial stop $${ts.initial_stop}, ${ts.callback_rate}% callback)`);
    }

    if (intent.follow_up.stop_loss) {
      followUpParts.push(`stop loss at $${intent.follow_up.stop_loss}`);
    }

    if (intent.follow_up.take_profit) {
      followUpParts.push(`take profit at $${intent.follow_up.take_profit}`);
    }

    if (followUpParts.length > 0) {
      parts.push(`then set ${followUpParts.join(', ')}`);
    }
  }

  return parts.join(' ');
}
