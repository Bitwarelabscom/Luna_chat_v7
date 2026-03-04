/**
 * Conditional Order Service
 *
 * Handles parsing natural language trading intents and creating conditional orders,
 * either locally or via TradeCore when enabled.
 */

import { pool as db } from '../db/index.js';
import logger from '../utils/logger.js';
import {
  parseTradingIntent,
  summarizeIntent,
  type ParseResult,
  type ParsedTradingIntent,
} from './intent-parser.js';
import * as tradecoreClient from './tradecore.client.js';
import * as botExecutorService from './bot-executor.service.js';

export interface ConditionalOrderResult {
  success: boolean;
  orderId?: string;
  summary?: string;
  error?: string;
  confidence: number;
}

/**
 * Parse natural language and create a conditional order
 */
export async function createFromNaturalLanguage(
  userId: string,
  naturalLanguageInput: string
): Promise<ConditionalOrderResult> {
  // Parse the natural language input
  const parseResult = parseTradingIntent(naturalLanguageInput);

  if (!parseResult.success || !parseResult.intent) {
    return {
      success: false,
      error: parseResult.error || 'Failed to parse trading intent',
      confidence: parseResult.confidence,
    };
  }

  const intent = parseResult.intent;

  // Generate human-readable summary
  const summary = summarizeIntent(intent);

  // Low confidence - suggest confirmation
  if (parseResult.confidence < 0.6) {
    return {
      success: false,
      error: `Low confidence parse (${(parseResult.confidence * 100).toFixed(0)}%). Please confirm: "${summary}"`,
      confidence: parseResult.confidence,
      summary,
    };
  }

  // Create the conditional order
  try {
    let orderId: string;

    if (tradecoreClient.isTradeCoreEnabled()) {
      // Use TradeCore
      const response = await tradecoreClient.createConditionalOrder({
        userId,
        symbol: intent.symbol,
        side: intent.side,
        orderType: intent.order_type,
        quantity: intent.quantity,
        quoteOrderQty: intent.quote_order_qty,
        price: intent.price,
        triggerConditions: {
          logic: intent.trigger_conditions.logic,
          conditions: intent.trigger_conditions.conditions.map(c => ({
            type: c.type,
            operator: c.operator,
            value: c.value,
            period: c.period,
          })),
        },
        followUp: intent.follow_up ? {
          trailing_stop: intent.follow_up.trailing_stop,
          stop_loss: intent.follow_up.stop_loss,
          take_profit: intent.follow_up.take_profit,
        } : undefined,
      });

      if (!response.success || !response.data) {
        return {
          success: false,
          error: response.error || 'Failed to create conditional order in TradeCore',
          confidence: parseResult.confidence,
          summary,
        };
      }

      orderId = response.data.id;
    } else {
      // Use local bot executor
      // Convert to local format
      const localOrder = await createLocalConditionalOrder(userId, intent);
      orderId = localOrder.id;
    }

    return {
      success: true,
      orderId,
      summary,
      confidence: parseResult.confidence,
    };
  } catch (error) {
    logger.error('Failed to create conditional order', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      error: `Failed to create order: ${error instanceof Error ? error.message : 'Unknown error'}`,
      confidence: parseResult.confidence,
      summary,
    };
  }
}

/**
 * Create conditional order using local bot executor service
 */
async function createLocalConditionalOrder(
  userId: string,
  intent: ParsedTradingIntent
): Promise<{ id: string }> {
  // Convert intent to local conditional order format
  // The bot-executor service uses a simpler format for backward compatibility

  // Extract primary price condition
  const priceCondition = intent.trigger_conditions.conditions.find(c => c.type === 'price');

  if (!priceCondition) {
    throw new Error('Price condition required for local conditional orders');
  }

  // Map operator to condition type
  let condition: 'above' | 'below' | 'crosses_up' | 'crosses_down';
  switch (priceCondition.operator) {
    case '>':
    case '>=':
      condition = 'above';
      break;
    case '<':
    case '<=':
      condition = 'below';
      break;
    case 'crosses_above':
      condition = 'crosses_up';
      break;
    case 'crosses_below':
      condition = 'crosses_down';
      break;
    default:
      condition = priceCondition.value > 0 ? 'above' : 'below';
  }

  // Build action
  const action: botExecutorService.ConditionalOrder['action'] = {
    side: intent.side.toLowerCase() as 'buy' | 'sell',
    type: intent.order_type.toLowerCase() as 'market' | 'limit',
    amountType: intent.quote_order_qty ? 'quote' : 'quantity',
    amount: intent.quote_order_qty
      ? parseFloat(intent.quote_order_qty)
      : parseFloat(intent.quantity || '0'),
  };

  // Add price for limit orders
  if (intent.price) {
    action.limitPrice = parseFloat(intent.price);
  }

  // Add follow-up actions
  if (intent.follow_up) {
    if (intent.follow_up.stop_loss) {
      action.stopLoss = intent.follow_up.stop_loss;
    }
    if (intent.follow_up.take_profit) {
      action.takeProfit = intent.follow_up.take_profit;
    }
    if (intent.follow_up.trailing_stop) {
      action.trailingStopPct = intent.follow_up.trailing_stop.callback_rate;
    }
  }

  const order = await botExecutorService.createConditionalOrder(userId, {
    symbol: intent.symbol,
    condition,
    triggerPrice: priceCondition.value,
    action,
  });

  // Store additional conditions as metadata (for compound triggers)
  const additionalConditions = intent.trigger_conditions.conditions.filter(c => c.type !== 'price');
  if (additionalConditions.length > 0) {
    await db.query(
      `UPDATE conditional_orders
       SET trigger_conditions = $1
       WHERE id = $2`,
      [JSON.stringify(intent.trigger_conditions), order.id]
    );
  }

  return { id: order.id };
}

/**
 * Validate a parsed trading intent
 */
export function validateIntent(intent: ParsedTradingIntent): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check symbol
  if (!intent.symbol || intent.symbol.length < 6) {
    errors.push('Invalid trading pair symbol');
  }

  // Check amount
  if (!intent.quantity && !intent.quote_order_qty) {
    errors.push('No quantity specified');
  }

  // Check conditions
  if (intent.trigger_conditions.conditions.length === 0) {
    errors.push('No trigger conditions specified');
  }

  // Validate condition values
  for (const cond of intent.trigger_conditions.conditions) {
    if (cond.type === 'price' && cond.value <= 0) {
      errors.push('Invalid price condition value');
    }
    if (cond.type === 'rsi' && (cond.value < 0 || cond.value > 100)) {
      errors.push('RSI value must be between 0 and 100');
    }
  }

  // Validate follow-up
  if (intent.follow_up?.trailing_stop) {
    const ts = intent.follow_up.trailing_stop;
    if (ts.callback_rate <= 0 || ts.callback_rate > 50) {
      errors.push('Trailing stop callback rate must be between 0 and 50%');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get active conditional orders for a user
 */
export async function getActiveOrders(userId: string): Promise<{
  orders: Array<{
    id: string;
    symbol: string;
    condition: string;
    triggerPrice: number;
    side: string;
    status: string;
    createdAt: Date;
  }>;
}> {
  if (tradecoreClient.isTradeCoreEnabled()) {
    const response = await tradecoreClient.listConditionalOrders(userId, 'active');
    if (!response.success || !response.data) {
      return { orders: [] };
    }

    return {
      orders: response.data.orders.map(o => ({
        id: o.id,
        symbol: o.symbol,
        condition: formatConditions(o.triggerConditions),
        triggerPrice: 0, // Compound conditions don't have single trigger price
        side: o.side,
        status: o.status,
        createdAt: new Date(o.createdAt),
      })),
    };
  }

  // Use local service
  const orders = await botExecutorService.getConditionalOrders(userId, 'active');
  return {
    orders: orders.map(o => ({
      id: o.id,
      symbol: o.symbol,
      condition: o.condition,
      triggerPrice: o.triggerPrice,
      side: o.action.side,
      status: o.status,
      createdAt: o.createdAt,
    })),
  };
}

/**
 * Format trigger conditions as a readable string
 */
function formatConditions(conditions: tradecoreClient.TriggerConditions): string {
  return conditions.conditions.map(c => {
    const opStr = {
      '<': 'below',
      '<=': 'at or below',
      '>': 'above',
      '>=': 'at or above',
      'crosses_above': 'crosses above',
      'crosses_below': 'crosses below',
    }[c.operator] || c.operator;

    switch (c.type) {
      case 'price':
        return `price ${opStr} $${c.value}`;
      case 'rsi':
        return `RSI(${c.period || 14}) ${opStr} ${c.value}`;
      case 'macd':
        return `MACD ${c.operator === 'crosses_above' ? 'bullish' : 'bearish'} crossover`;
      case 'ema':
        return `price ${opStr} EMA(${c.period})`;
      case 'sma':
        return `price ${opStr} SMA(${c.period})`;
      case 'volume':
        return `volume ${opStr} ${c.value}`;
      default:
        return `${c.type} ${opStr} ${c.value}`;
    }
  }).join(` ${conditions.logic} `);
}

/**
 * Parse without creating - for preview/confirmation
 */
export function parseForPreview(input: string): ParseResult {
  return parseTradingIntent(input);
}

/**
 * Export summarize function for external use
 */
export { summarizeIntent } from './intent-parser.js';
