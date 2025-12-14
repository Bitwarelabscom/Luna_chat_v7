import { pool } from '../db/index.js';
import { BinanceClient, type TickerPrice, type Ticker24hr, type Kline, formatQuantity } from './binance.client.js';
import { alphaClient, type AlphaToken } from './binance-alpha.client.js';
import { logger } from '../utils/logger.js';
import { encryptToken, decryptToken } from '../utils/encryption.js';

// Types
export interface TradingSettings {
  userId: string;
  binanceConnected: boolean;
  maxPositionPct: number;
  dailyLossLimitPct: number;
  requireStopLoss: boolean;
  defaultStopLossPct: number;
  allowedSymbols: string[];
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
}

export interface Portfolio {
  totalValueUsdt: number;
  availableUsdt: number;
  holdings: PortfolioHolding[];
  dailyPnl: number;
  dailyPnlPct: number;
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

export interface BotConfig {
  id: string;
  userId: string;
  name: string;
  type: 'grid' | 'dca' | 'rsi' | 'ma_crossover' | 'macd' | 'breakout' | 'mean_reversion' | 'momentum' | 'custom';
  symbol: string;
  config: Record<string, unknown>;
  status: 'running' | 'stopped' | 'error' | 'paused';
  lastError: string | null;
  totalProfit: number;
  totalTrades: number;
  winRate: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  stoppedAt: Date | null;
  marketType?: 'spot' | 'alpha';
}

// Alpha token holding
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

// Combined portfolio with Spot and Alpha
export interface CombinedPortfolio {
  spot: Portfolio | null;
  alpha: AlphaHolding[];
  totalValueUsdt: number;
}

// Binance client cache per user
const clientCache = new Map<string, { client: BinanceClient; expiresAt: number }>();
const CLIENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Encrypted API keys storage (per user in database)
async function getUserApiKeys(
  userId: string
): Promise<{ apiKey: string; apiSecret: string } | null> {
  const result = await pool.query(
    `SELECT api_key_encrypted, api_secret_encrypted
     FROM user_trading_keys
     WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  try {
    const apiKey = decryptToken(row.api_key_encrypted);
    const apiSecret = decryptToken(row.api_secret_encrypted);
    return { apiKey, apiSecret };
  } catch (error) {
    logger.error('Failed to decrypt API keys', { userId, error });
    return null;
  }
}

async function saveUserApiKeys(
  userId: string,
  apiKey: string,
  apiSecret: string
): Promise<void> {
  const encryptedApiKey = encryptToken(apiKey);
  const encryptedApiSecret = encryptToken(apiSecret);

  await pool.query(
    `INSERT INTO user_trading_keys (user_id, api_key_encrypted, api_secret_encrypted)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       api_key_encrypted = $2,
       api_secret_encrypted = $3,
       updated_at = NOW()`,
    [userId, encryptedApiKey, encryptedApiSecret]
  );

  // Invalidate cache
  clientCache.delete(userId);
}

async function getBinanceClient(userId: string): Promise<BinanceClient | null> {
  // Check cache
  const cached = clientCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client;
  }

  // Get API keys
  const keys = await getUserApiKeys(userId);
  if (!keys) {
    return null;
  }

  // Create client
  const client = new BinanceClient(keys);
  clientCache.set(userId, {
    client,
    expiresAt: Date.now() + CLIENT_CACHE_TTL,
  });

  return client;
}

// Trading Service Functions

export async function connectBinance(
  userId: string,
  apiKey: string,
  apiSecret: string
): Promise<{ success: boolean; canTrade: boolean; error?: string }> {
  // Test the connection first
  const testClient = new BinanceClient({ apiKey, apiSecret });
  const result = await testClient.testConnection();

  if (!result.success) {
    return result;
  }

  if (!result.canTrade) {
    return {
      success: false,
      canTrade: false,
      error: 'API key does not have trading permissions',
    };
  }

  // Save encrypted keys
  await saveUserApiKeys(userId, apiKey, apiSecret);

  // Update trading settings
  await pool.query(
    `INSERT INTO trading_settings (user_id, binance_connected)
     VALUES ($1, true)
     ON CONFLICT (user_id) DO UPDATE SET
       binance_connected = true,
       updated_at = NOW()`,
    [userId]
  );

  logger.info('Binance account connected', { userId });
  return { success: true, canTrade: true };
}

export async function disconnectBinance(userId: string): Promise<void> {
  await pool.query('DELETE FROM user_trading_keys WHERE user_id = $1', [userId]);
  await pool.query(
    `UPDATE trading_settings SET binance_connected = false, updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
  clientCache.delete(userId);
  logger.info('Binance account disconnected', { userId });
}

export async function getSettings(userId: string): Promise<TradingSettings> {
  const result = await pool.query(
    `INSERT INTO trading_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [userId]
  );

  // If insert returned nothing, fetch existing
  const settings =
    result.rows[0] ||
    (await pool.query('SELECT * FROM trading_settings WHERE user_id = $1', [userId])).rows[0];

  return {
    userId: settings.user_id,
    binanceConnected: settings.binance_connected,
    maxPositionPct: parseFloat(settings.max_position_pct),
    dailyLossLimitPct: parseFloat(settings.daily_loss_limit_pct),
    requireStopLoss: settings.require_stop_loss,
    defaultStopLossPct: parseFloat(settings.default_stop_loss_pct),
    allowedSymbols: settings.allowed_symbols,
    riskTolerance: settings.risk_tolerance,
  };
}

export async function updateSettings(
  userId: string,
  updates: Partial<Omit<TradingSettings, 'userId' | 'binanceConnected'>>
): Promise<TradingSettings> {
  const setClauses: string[] = [];
  const values: unknown[] = [userId];
  let paramIndex = 2;

  if (updates.maxPositionPct !== undefined) {
    setClauses.push(`max_position_pct = $${paramIndex++}`);
    values.push(updates.maxPositionPct);
  }
  if (updates.dailyLossLimitPct !== undefined) {
    setClauses.push(`daily_loss_limit_pct = $${paramIndex++}`);
    values.push(updates.dailyLossLimitPct);
  }
  if (updates.requireStopLoss !== undefined) {
    setClauses.push(`require_stop_loss = $${paramIndex++}`);
    values.push(updates.requireStopLoss);
  }
  if (updates.defaultStopLossPct !== undefined) {
    setClauses.push(`default_stop_loss_pct = $${paramIndex++}`);
    values.push(updates.defaultStopLossPct);
  }
  if (updates.allowedSymbols !== undefined) {
    setClauses.push(`allowed_symbols = $${paramIndex++}`);
    values.push(updates.allowedSymbols);
  }
  if (updates.riskTolerance !== undefined) {
    setClauses.push(`risk_tolerance = $${paramIndex++}`);
    values.push(updates.riskTolerance);
  }

  if (setClauses.length > 0) {
    setClauses.push('updated_at = NOW()');
    await pool.query(
      `UPDATE trading_settings SET ${setClauses.join(', ')} WHERE user_id = $1`,
      values
    );
  }

  return getSettings(userId);
}

export async function getPortfolio(userId: string): Promise<Portfolio | null> {
  const client = await getBinanceClient(userId);
  if (!client) {
    return null;
  }

  try {
    // Get account info and prices in parallel
    const [accountInfo, prices, tickers] = await Promise.all([
      client.getAccountInfo(),
      client.getTickerPrice() as Promise<TickerPrice[]>,
      client.getTicker24hr() as Promise<Ticker24hr[]>,
    ]);

    // Create price lookup maps
    const priceMap = new Map<string, number>();
    for (const p of prices) {
      priceMap.set(p.symbol, parseFloat(p.price));
    }

    const tickerMap = new Map<string, Ticker24hr>();
    for (const t of tickers) {
      tickerMap.set(t.symbol, t);
    }

    // Calculate holdings
    const holdings: PortfolioHolding[] = [];
    let totalValueUsdt = 0;
    let availableUsdt = 0;

    for (const balance of accountInfo.balances) {
      const amount = parseFloat(balance.free) + parseFloat(balance.locked);
      if (amount <= 0) continue;

      let valueUsdt = 0;
      let price = 0;
      let priceChange24h = 0;

      if (balance.asset === 'USDC') {
        valueUsdt = amount;
        price = 1;
        availableUsdt = parseFloat(balance.free);
      } else if (balance.asset === 'USDT' || balance.asset === 'BUSD') {
        valueUsdt = amount;
        price = 1;
        if (balance.asset === 'USDT') {
          availableUsdt += parseFloat(balance.free); // Add USDT to available
        }
      } else {
        // Try to find USDC pair first, then USDT
        const usdcSymbol = `${balance.asset}USDC`;
        const usdtSymbol = `${balance.asset}USDT`;
        const usdcPrice = priceMap.get(usdcSymbol);
        const usdtPrice = priceMap.get(usdtSymbol);
        const symbol = usdcPrice ? usdcSymbol : usdtSymbol;
        const pairPrice = usdcPrice || usdtPrice;
        if (pairPrice) {
          price = pairPrice;
          valueUsdt = amount * pairPrice;
          const ticker = tickerMap.get(symbol);
          if (ticker) {
            priceChange24h = parseFloat(ticker.priceChangePercent);
          }
        } else {
          // Try BTC pair and convert
          const btcSymbol = `${balance.asset}BTC`;
          const btcPrice = priceMap.get(btcSymbol);
          const btcUsdc = priceMap.get('BTCUSDC');
          if (btcPrice && btcUsdc) {
            price = btcPrice * btcUsdc;
            valueUsdt = amount * price;
          }
        }
      }

      if (valueUsdt > 0.01) {
        // Only include holdings worth more than $0.01
        holdings.push({
          symbol: `${balance.asset}USDC`,
          asset: balance.asset,
          amount,
          valueUsdt,
          price,
          priceChange24h,
          allocationPct: 0, // Will be calculated after total
        });
        totalValueUsdt += valueUsdt;
      }
    }

    // Calculate allocation percentages and sort by value
    for (const h of holdings) {
      h.allocationPct = (h.valueUsdt / totalValueUsdt) * 100;
    }
    holdings.sort((a, b) => b.valueUsdt - a.valueUsdt);

    // Get last snapshot for P&L calculation
    const snapshotResult = await pool.query(
      `SELECT total_value_usdt FROM portfolio_snapshots
       WHERE user_id = $1
       ORDER BY snapshot_time DESC LIMIT 1`,
      [userId]
    );

    let dailyPnl = 0;
    let dailyPnlPct = 0;
    if (snapshotResult.rows.length > 0) {
      const lastValue = parseFloat(snapshotResult.rows[0].total_value_usdt);
      dailyPnl = totalValueUsdt - lastValue;
      dailyPnlPct = (dailyPnl / lastValue) * 100;
    }

    // Save snapshot
    await pool.query(
      `INSERT INTO portfolio_snapshots (user_id, total_value_usdt, holdings, daily_pnl, daily_pnl_pct)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, totalValueUsdt, JSON.stringify(holdings), dailyPnl, dailyPnlPct]
    );

    return {
      totalValueUsdt,
      availableUsdt,
      holdings,
      dailyPnl,
      dailyPnlPct,
    };
  } catch (error) {
    logger.error('Failed to get portfolio', { userId, error });
    throw error;
  }
}

export async function getPrices(
  userId: string,
  symbols?: string[]
): Promise<{ symbol: string; price: number; change24h: number }[]> {
  const client = await getBinanceClient(userId);
  if (!client) {
    // Return public data without auth
    const publicClient = new BinanceClient({ apiKey: '', apiSecret: '' });
    const tickers = (await publicClient.getTicker24hr()) as Ticker24hr[];

    let filtered = tickers;
    if (symbols) {
      const symbolSet = new Set(symbols);
      filtered = tickers.filter((t) => symbolSet.has(t.symbol));
    } else {
      // Default popular pairs
      const popular = new Set([
        'BTCUSDC',
        'ETHUSDC',
        'SOLUSDC',
        'XRPUSDC',
        'ADAUSDC',
        'DOGEUSDC',
        'DOTUSDC',
        'AVAXUSDC',
      ]);
      filtered = tickers.filter((t) => popular.has(t.symbol));
    }

    return filtered.map((t) => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      change24h: parseFloat(t.priceChangePercent),
    }));
  }

  try {
    const tickers = (await client.getTicker24hr()) as Ticker24hr[];
    let filtered = tickers;

    if (symbols) {
      const symbolSet = new Set(symbols);
      filtered = tickers.filter((t) => symbolSet.has(t.symbol));
    }

    return filtered.map((t) => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      change24h: parseFloat(t.priceChangePercent),
    }));
  } catch (error) {
    logger.error('Failed to get prices', { userId, error });
    throw error;
  }
}

export async function getKlines(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Kline[]> {
  // Public endpoint - no auth needed
  const client = new BinanceClient({ apiKey: '', apiSecret: '' });
  return client.getKlines(symbol, interval, limit);
}

export async function getRecentTrades(userId: string, limit: number = 20): Promise<TradeRecord[]> {
  const result = await pool.query(
    `SELECT * FROM trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    botId: row.bot_id,
    symbol: row.symbol,
    side: row.side,
    orderType: row.order_type,
    quantity: parseFloat(row.quantity),
    price: row.price ? parseFloat(row.price) : null,
    filledPrice: row.filled_price ? parseFloat(row.filled_price) : null,
    total: row.total ? parseFloat(row.total) : null,
    fee: parseFloat(row.fee || '0'),
    feeAsset: row.fee_asset,
    status: row.status,
    binanceOrderId: row.binance_order_id,
    stopLossPrice: row.stop_loss_price ? parseFloat(row.stop_loss_price) : null,
    takeProfitPrice: row.take_profit_price ? parseFloat(row.take_profit_price) : null,
    notes: row.notes,
    createdAt: row.created_at,
    filledAt: row.filled_at,
  }));
}

export async function placeOrder(
  userId: string,
  params: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    quantity?: number;
    quoteAmount?: number; // For market orders - spend this much USDT
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    trailingStopPct?: number; // Trailing stop loss percentage (e.g., 2.5 = 2.5%)
    notes?: string;
  }
): Promise<TradeRecord> {
  const client = await getBinanceClient(userId);
  if (!client) {
    throw new Error('Binance not connected');
  }

  // Get settings for risk checks
  const settings = await getSettings(userId);

  // Validate symbol
  if (!settings.allowedSymbols.includes(params.symbol)) {
    throw new Error(`Symbol ${params.symbol} is not in allowed list`);
  }

  // Check position size limit
  if (params.quoteAmount) {
    const portfolio = await getPortfolio(userId);
    if (portfolio) {
      const maxPosition = (portfolio.totalValueUsdt * settings.maxPositionPct) / 100;
      if (params.quoteAmount > maxPosition) {
        throw new Error(
          `Order amount $${params.quoteAmount} exceeds max position size $${maxPosition.toFixed(2)} (${settings.maxPositionPct}%)`
        );
      }
    }
  }

  // Check stop loss requirement
  if (settings.requireStopLoss && params.side === 'buy' && !params.stopLoss) {
    throw new Error('Stop loss is required for buy orders');
  }

  try {
    // Get lot size filter to format quantity correctly
    let formattedQuantity: string | undefined;
    if (params.quantity) {
      const lotSize = await client.getLotSizeFilter(params.symbol);
      if (lotSize) {
        formattedQuantity = formatQuantity(params.quantity, lotSize.stepSize);
        const minQty = parseFloat(lotSize.minQty);
        if (parseFloat(formattedQuantity) < minQty) {
          throw new Error(`Quantity ${formattedQuantity} is below minimum ${minQty} for ${params.symbol}`);
        }
      } else {
        formattedQuantity = params.quantity.toString();
      }
    }

    // Place order on Binance
    const binanceOrder = await client.placeOrder({
      symbol: params.symbol,
      side: params.side.toUpperCase() as 'BUY' | 'SELL',
      type: params.type.toUpperCase() as 'MARKET' | 'LIMIT',
      quantity: formattedQuantity,
      quoteOrderQty: params.quoteAmount?.toString(),
      price: params.price?.toString(),
      timeInForce: params.type === 'limit' ? 'GTC' : undefined,
    });

    // Calculate filled price and total
    let filledPrice = 0;
    let total = 0;
    let fee = 0;
    let feeAsset = '';

    if (binanceOrder.fills && binanceOrder.fills.length > 0) {
      let totalQty = 0;
      let totalValue = 0;
      for (const fill of binanceOrder.fills) {
        const qty = parseFloat(fill.qty);
        const price = parseFloat(fill.price);
        totalQty += qty;
        totalValue += qty * price;
        fee += parseFloat(fill.commission);
        feeAsset = fill.commissionAsset;
      }
      filledPrice = totalValue / totalQty;
      total = totalValue;
    }

    // Calculate initial trailing stop price if enabled
    let trailingStopPrice: number | null = null;
    if (params.trailingStopPct && filledPrice > 0) {
      // For buys, trailing stop is below current price
      // For sells, trailing stop is above current price
      if (params.side === 'buy') {
        trailingStopPrice = filledPrice * (1 - params.trailingStopPct / 100);
      } else {
        trailingStopPrice = filledPrice * (1 + params.trailingStopPct / 100);
      }
    }

    // Save to database
    const result = await pool.query(
      `INSERT INTO trades (
        user_id, symbol, side, order_type, quantity, price, filled_price, total,
        fee, fee_asset, status, binance_order_id, stop_loss_price, take_profit_price,
        trailing_stop_pct, trailing_stop_price, trailing_stop_highest, notes, filled_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *`,
      [
        userId,
        params.symbol,
        params.side.toLowerCase(),
        params.type.toLowerCase(),
        parseFloat(binanceOrder.executedQty),
        params.price,
        filledPrice || null,
        total || null,
        fee,
        feeAsset || null,
        binanceOrder.status.toLowerCase(),
        binanceOrder.orderId.toString(),
        params.stopLoss,
        params.takeProfit,
        params.trailingStopPct || null,
        trailingStopPrice,
        filledPrice || null, // Initial highest is entry price
        params.notes,
        binanceOrder.status === 'FILLED' ? new Date() : null,
      ]
    );

    logger.info('Order placed', {
      userId,
      symbol: params.symbol,
      side: params.side,
      orderId: binanceOrder.orderId,
    });

    return {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      botId: null,
      symbol: result.rows[0].symbol,
      side: result.rows[0].side,
      orderType: result.rows[0].order_type,
      quantity: parseFloat(result.rows[0].quantity),
      price: result.rows[0].price ? parseFloat(result.rows[0].price) : null,
      filledPrice: result.rows[0].filled_price ? parseFloat(result.rows[0].filled_price) : null,
      total: result.rows[0].total ? parseFloat(result.rows[0].total) : null,
      fee: parseFloat(result.rows[0].fee),
      feeAsset: result.rows[0].fee_asset,
      status: result.rows[0].status,
      binanceOrderId: result.rows[0].binance_order_id,
      stopLossPrice: result.rows[0].stop_loss_price
        ? parseFloat(result.rows[0].stop_loss_price)
        : null,
      takeProfitPrice: result.rows[0].take_profit_price
        ? parseFloat(result.rows[0].take_profit_price)
        : null,
      notes: result.rows[0].notes,
      createdAt: result.rows[0].created_at,
      filledAt: result.rows[0].filled_at,
    };
  } catch (error) {
    logger.error('Failed to place order', { userId, params, error });
    throw error;
  }
}

export async function cancelOrder(userId: string, tradeId: string): Promise<void> {
  const client = await getBinanceClient(userId);
  if (!client) {
    throw new Error('Binance not connected');
  }

  // Get order from database
  const result = await pool.query(
    'SELECT symbol, binance_order_id FROM trades WHERE id = $1 AND user_id = $2',
    [tradeId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Trade not found');
  }

  const { symbol, binance_order_id } = result.rows[0];

  // Cancel on Binance
  await client.cancelOrder(symbol, parseInt(binance_order_id));

  // Update database
  await pool.query(
    `UPDATE trades SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
    [tradeId]
  );

  logger.info('Order cancelled', { userId, tradeId });
}

// Bot management functions

export async function getBots(userId: string): Promise<BotConfig[]> {
  const result = await pool.query(
    'SELECT * FROM trading_bots WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    symbol: row.symbol,
    config: row.config,
    status: row.status,
    lastError: row.last_error,
    totalProfit: parseFloat(row.total_profit),
    totalTrades: row.total_trades,
    winRate: parseFloat(row.win_rate),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
  }));
}

export async function createBot(
  userId: string,
  config: {
    name: string;
    type: BotConfig['type'];
    symbol: string;
    config: Record<string, unknown>;
  }
): Promise<BotConfig> {
  const result = await pool.query(
    `INSERT INTO trading_bots (user_id, name, type, symbol, config)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, config.name, config.type, config.symbol, JSON.stringify(config.config)]
  );

  const row = result.rows[0];
  logger.info('Bot created', { userId, botId: row.id, type: config.type });

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    symbol: row.symbol,
    config: row.config,
    status: row.status,
    lastError: row.last_error,
    totalProfit: parseFloat(row.total_profit),
    totalTrades: row.total_trades,
    winRate: parseFloat(row.win_rate),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
  };
}

export async function updateBotStatus(
  userId: string,
  botId: string,
  status: BotConfig['status'],
  error?: string
): Promise<void> {
  const updates =
    status === 'running'
      ? 'status = $3, started_at = NOW(), last_error = NULL'
      : status === 'stopped'
        ? 'status = $3, stopped_at = NOW()'
        : 'status = $3, last_error = $4';

  await pool.query(`UPDATE trading_bots SET ${updates}, updated_at = NOW() WHERE id = $1 AND user_id = $2`, [
    botId,
    userId,
    status,
    error,
  ]);
}

export async function deleteBot(userId: string, botId: string): Promise<void> {
  await pool.query('DELETE FROM trading_bots WHERE id = $1 AND user_id = $2', [botId, userId]);
  logger.info('Bot deleted', { userId, botId });
}

export async function logBotAction(
  botId: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  await pool.query('INSERT INTO bot_logs (bot_id, action, details) VALUES ($1, $2, $3)', [
    botId,
    action,
    JSON.stringify(details),
  ]);
}

// Trading statistics

export async function getTradingStats(
  userId: string,
  days: number = 30
): Promise<{
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
}> {
  const result = await pool.query(
    `WITH trade_pnl AS (
      SELECT
        id,
        CASE
          WHEN side = 'sell' THEN total - (SELECT total FROM trades t2 WHERE t2.user_id = t1.user_id AND t2.symbol = t1.symbol AND t2.side = 'buy' AND t2.created_at < t1.created_at ORDER BY created_at DESC LIMIT 1)
          ELSE NULL
        END as pnl
      FROM trades t1
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '1 day' * $2
        AND status = 'filled'
    )
    SELECT
      COUNT(*) as total_trades,
      COUNT(CASE WHEN pnl > 0 THEN 1 END) as winning_trades,
      COUNT(CASE WHEN pnl < 0 THEN 1 END) as losing_trades,
      COALESCE(SUM(pnl), 0) as total_pnl,
      COALESCE(AVG(CASE WHEN pnl > 0 THEN pnl END), 0) as avg_win,
      COALESCE(AVG(CASE WHEN pnl < 0 THEN pnl END), 0) as avg_loss,
      COALESCE(MAX(pnl), 0) as largest_win,
      COALESCE(MIN(pnl), 0) as largest_loss
    FROM trade_pnl`,
    [userId, days]
  );

  const row = result.rows[0];
  const totalTrades = parseInt(row.total_trades);
  const winningTrades = parseInt(row.winning_trades);
  const losingTrades = parseInt(row.losing_trades);

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
    totalPnl: parseFloat(row.total_pnl),
    avgWin: parseFloat(row.avg_win),
    avgLoss: parseFloat(row.avg_loss),
    largestWin: parseFloat(row.largest_win),
    largestLoss: parseFloat(row.largest_loss),
  };
}

// ============================================
// Alpha Token Functions
// ============================================

/**
 * Get list of available Alpha tokens with prices
 */
export async function getAlphaTokens(limit: number = 50): Promise<AlphaToken[]> {
  try {
    const tokens = await alphaClient.getTokenList();
    // Sort by volume and return top tokens
    return tokens
      .sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h))
      .slice(0, limit);
  } catch (error) {
    logger.error('Failed to get Alpha tokens', { error });
    return [];
  }
}

/**
 * Get Alpha token prices for specific symbols
 */
export async function getAlphaPrices(symbols: string[]): Promise<Array<{
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  chain: string;
}>> {
  try {
    return await alphaClient.getTokenPrices(symbols);
  } catch (error) {
    logger.error('Failed to get Alpha prices', { symbols, error });
    return [];
  }
}

/**
 * Search Alpha tokens by name or symbol
 */
export async function searchAlphaTokens(query: string): Promise<AlphaToken[]> {
  try {
    return await alphaClient.searchTokens(query);
  } catch (error) {
    logger.error('Failed to search Alpha tokens', { query, error });
    return [];
  }
}

/**
 * Get Alpha token klines/candlestick data
 */
export async function getAlphaKlines(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Array<{
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}>> {
  try {
    const klines = await alphaClient.getKlines(symbol, interval, limit);
    return klines.map(k => ({
      openTime: k.openTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
  } catch (error) {
    logger.error('Failed to get Alpha klines', { symbol, error });
    return [];
  }
}

/**
 * Get hot/trending Alpha tokens
 */
export async function getHotAlphaTokens(): Promise<AlphaToken[]> {
  try {
    return await alphaClient.getHotTokens();
  } catch (error) {
    logger.error('Failed to get hot Alpha tokens', { error });
    return [];
  }
}

/**
 * Get top Alpha tokens by volume
 */
export async function getTopAlphaByVolume(limit: number = 20): Promise<AlphaToken[]> {
  try {
    return await alphaClient.getTopTokensByVolume(limit);
  } catch (error) {
    logger.error('Failed to get top Alpha tokens by volume', { error });
    return [];
  }
}

/**
 * Get combined portfolio (Spot + Alpha holdings)
 * Note: Alpha holdings require manual tracking as Binance Alpha doesn't have a wallet API
 */
export async function getCombinedPortfolio(userId: string): Promise<CombinedPortfolio> {
  // Get spot portfolio
  const spotPortfolio = await getPortfolio(userId);

  // For Alpha tokens, we would need to track holdings manually
  // Currently Alpha tokens are traded on-chain and don't have a centralized wallet API
  // This is a placeholder for future integration
  const alphaHoldings: AlphaHolding[] = [];

  const spotValue = spotPortfolio?.totalValueUsdt || 0;
  const alphaValue = alphaHoldings.reduce((sum, h) => sum + h.valueUsdt, 0);

  return {
    spot: spotPortfolio,
    alpha: alphaHoldings,
    totalValueUsdt: spotValue + alphaValue,
  };
}

// Re-export Alpha client for direct access
export { alphaClient };
