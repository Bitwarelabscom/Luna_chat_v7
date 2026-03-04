/**
 * TradeCore Client
 *
 * HTTP client for communicating with the TradeCore trading engine.
 * Used when TRADECORE_ENABLED is set to delegate bot execution to TradeCore.
 */

import { logger } from '../utils/logger.js';

// TradeCore API base URL from environment
const TRADECORE_URL = process.env.TRADECORE_URL || 'http://tradecore:9090';

// Request/Response types
export interface StartBotParams {
  userId: string;
  botId: string;
  type: string;
  symbol: string;
  config: Record<string, unknown>;
}

export interface StopBotParams {
  botId: string;
}

export interface BotStatusResponse {
  botId: string;
  userId?: string;
  status: string;
  symbol?: string;
  type?: string;
  totalProfit?: number;
  totalTrades?: number;
  lastError?: string;
  state?: unknown;
}

export interface TradeCoreResponse<T> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

export interface HealthResponse {
  status: string;
  timestamp?: string;
  version?: string;
  activeBots?: number;
}

/**
 * Check if TradeCore integration is enabled
 */
export function isTradeCoreEnabled(): boolean {
  return process.env.TRADECORE_ENABLED === 'true';
}

/**
 * Make an HTTP request to TradeCore
 */
async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<TradeCoreResponse<T>> {
  const url = `${TRADECORE_URL}${path}`;

  try {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = (await response.json()) as TradeCoreResponse<T>;

    if (!response.ok) {
      logger.error('TradeCore request failed', {
        method,
        path,
        status: response.status,
        error: data.error,
      });
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    return data;
  } catch (error) {
    logger.error('TradeCore request error', {
      method,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Start a bot in TradeCore
 */
export async function startBot(params: StartBotParams): Promise<TradeCoreResponse<{ botId: string; status: string }>> {
  logger.info('Starting bot via TradeCore', {
    botId: params.botId,
    symbol: params.symbol,
    type: params.type,
  });

  return request('POST', '/bot/start', {
    user_id: params.userId,
    bot_id: params.botId,
    type: params.type,
    symbol: params.symbol,
    config: params.config,
  });
}

/**
 * Stop a bot in TradeCore
 */
export async function stopBot(params: StopBotParams): Promise<TradeCoreResponse<{ botId: string; status: string }>> {
  logger.info('Stopping bot via TradeCore', { botId: params.botId });

  return request('POST', '/bot/stop', {
    bot_id: params.botId,
  });
}

/**
 * Get bot status from TradeCore
 */
export async function getBotStatus(botId: string): Promise<TradeCoreResponse<BotStatusResponse>> {
  return request('GET', `/bot/${botId}/status`);
}

/**
 * List active bots in TradeCore
 */
export async function listBots(userId?: string): Promise<TradeCoreResponse<{ bots: BotStatusResponse[]; count: number }>> {
  const path = userId ? `/bots?user_id=${userId}` : '/bots';
  return request('GET', path);
}

/**
 * Update bot configuration in TradeCore
 */
export async function updateBotConfig(
  botId: string,
  config: Record<string, unknown>
): Promise<TradeCoreResponse<{ botId: string }>> {
  return request('POST', `/bot/${botId}/update`, { config });
}

/**
 * Check TradeCore health
 */
export async function healthCheck(): Promise<TradeCoreResponse<HealthResponse>> {
  return request('GET', '/health');
}

/**
 * Check if TradeCore is available and healthy
 */
export async function isAvailable(): Promise<boolean> {
  try {
    const response = await healthCheck();
    return response.success && response.data?.status === 'healthy';
  } catch {
    return false;
  }
}

// Conditional Order types
export interface ConditionalOrderCondition {
  type: 'price' | 'rsi' | 'macd' | 'ema' | 'sma' | 'volume';
  operator: '<' | '<=' | '>' | '>=' | 'crosses_above' | 'crosses_below';
  value: number;
  period?: number;
}

export interface TriggerConditions {
  logic: 'AND' | 'OR';
  conditions: ConditionalOrderCondition[];
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

export interface CreateConditionalOrderParams {
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity?: string;
  quoteOrderQty?: string;
  price?: string;
  triggerConditions: TriggerConditions;
  followUp?: FollowUp;
}

export interface ConditionalOrderResponse {
  id: string;
  userId: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity?: string;
  quoteOrderQty?: string;
  status: string;
  createdAt: string;
  triggerConditions: TriggerConditions;
  followUp?: FollowUp;
}

/**
 * Create a conditional order in TradeCore
 */
export async function createConditionalOrder(
  params: CreateConditionalOrderParams
): Promise<TradeCoreResponse<ConditionalOrderResponse>> {
  logger.info('Creating conditional order via TradeCore', {
    userId: params.userId,
    symbol: params.symbol,
    side: params.side,
    conditions: params.triggerConditions.conditions.length,
  });

  return request('POST', '/conditional', {
    user_id: params.userId,
    symbol: params.symbol,
    side: params.side,
    order_type: params.orderType,
    quantity: params.quantity,
    quote_order_qty: params.quoteOrderQty,
    price: params.price,
    trigger_conditions: params.triggerConditions,
    follow_up: params.followUp,
  });
}

/**
 * List conditional orders for a user from TradeCore
 */
export async function listConditionalOrders(
  userId: string,
  status?: string
): Promise<TradeCoreResponse<{ orders: ConditionalOrderResponse[]; count: number }>> {
  let path = `/conditional?user_id=${userId}`;
  if (status) {
    path += `&status=${status}`;
  }
  return request('GET', path);
}

/**
 * Get a specific conditional order from TradeCore
 */
export async function getConditionalOrder(
  orderId: string
): Promise<TradeCoreResponse<ConditionalOrderResponse>> {
  return request('GET', `/conditional/${orderId}`);
}

/**
 * Cancel a conditional order in TradeCore
 */
export async function cancelConditionalOrder(
  orderId: string
): Promise<TradeCoreResponse<{ id: string; status: string }>> {
  logger.info('Cancelling conditional order via TradeCore', { orderId });
  return request('DELETE', `/conditional/${orderId}`);
}
