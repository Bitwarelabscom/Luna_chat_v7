import { pool } from '../db/index.js';
import redis from '../db/redis.js';
import { CryptoComClient } from './crypto-com.client.js';
import * as redisTradingService from './redis-trading.service.js';
import { alphaClient, type AlphaToken } from './binance-alpha.client.js';
import { logger } from '../utils/logger.js';
import { encryptToken, decryptToken } from '../utils/encryption.js';
import * as tradeNotification from './trade-notification.service.js';
import * as tradecore from './tradecore.client.js';
import * as paperPortfolio from './paper-portfolio.service.js';

// Portfolio cache configuration
const PORTFOLIO_CACHE_PREFIX = 'trading:portfolio:';
const PORTFOLIO_CACHE_TTL = 60; // 60 seconds

/**
 * Calculate ATR-based stop-loss price
 * Uses the ATR value from Redis indicators to set a volatility-adjusted stop
 */
async function calculateAtrStopLoss(
  symbol: string,
  currentPrice: number,
  atrMultiplier: number,
  side: 'buy' | 'sell'
): Promise<number | null> {
  try {
    // Get ATR from cached indicators (prefer 5m timeframe for scalping, 1h for swings)
    const indicators = await redisTradingService.getIndicators(symbol, '5m');

    if (!indicators?.atr) {
      // Fallback to 1h timeframe
      const hourlyIndicators = await redisTradingService.getIndicators(symbol, '1h');
      if (!hourlyIndicators?.atr) {
        logger.warn('No ATR available for symbol', { symbol });
        return null;
      }

      const atrValue = hourlyIndicators.atr;
      // For buy orders, stop is below entry; for sell orders, stop is above
      return side === 'buy'
        ? currentPrice - (atrValue * atrMultiplier)
        : currentPrice + (atrValue * atrMultiplier);
    }

    const atrValue = indicators.atr;
    return side === 'buy'
      ? currentPrice - (atrValue * atrMultiplier)
      : currentPrice + (atrValue * atrMultiplier);
  } catch (error) {
    logger.error('Failed to calculate ATR-based stop-loss', {
      symbol,
      error: (error as Error).message,
    });
    return null;
  }
}
import {
  getMarginClient,
  getUserExchangeType,
  getUserMarginSettings,
  invalidateClientCache,
  getExchangeClient,
  createExchangeClient,
} from './exchange.factory.js';
import type { ExchangeType, Kline, Ticker24hr, TickerPrice, IExchangeClient } from './exchange.interface.js';
import * as symbolUtils from './symbol-utils.js';
import { toCryptoComSymbol, toBinanceSymbol, getDefaultTradingPairs } from './symbol-utils.js';

// Helper function to format quantity for Crypto.com API
// Rounds DOWN to the nearest step size to ensure we don't exceed holdings
function formatQuantity(qty: number, stepSize: string = '0.00000001'): string {
  const step = parseFloat(stepSize);

  if (step >= 1) {
    // For large step sizes (e.g., 10000 for BONK), round down to nearest multiple
    const rounded = Math.floor(qty / step) * step;
    return rounded.toString();
  }

  // For small step sizes, use precision-based formatting
  const precision = Math.max(0, Math.ceil(-Math.log10(step)));
  const multiplier = Math.pow(10, precision);
  const rounded = Math.floor(qty * multiplier) / multiplier;
  return rounded.toFixed(precision);
}

// Helper function to map exchange order status to database-compatible status
function mapOrderStatusToDb(status: string): string {
  const upperStatus = status.toUpperCase();
  switch (upperStatus) {
    case 'FILLED':
      return 'filled';
    case 'PARTIALLY_FILLED':
      return 'partially_filled';
    case 'CANCELED':
    case 'CANCELLED':
      return 'cancelled';
    case 'REJECTED':
      return 'rejected';
    case 'EXPIRED':
      return 'expired';
    case 'NEW':
    case 'ACTIVE':
    case 'PENDING':
    default:
      return 'pending';
  }
}

// Types
export interface TradingSettings {
  userId: string;
  binanceConnected: boolean; // Deprecated - use exchangeConnected
  exchangeConnected: boolean;
  activeExchange: ExchangeType | null;
  maxPositionPct: number;
  dailyLossLimitPct: number;
  requireStopLoss: boolean;
  defaultStopLossPct: number;
  // ATR-based dynamic stop-loss
  useAtrStopLoss: boolean;
  atrMultiplier: number; // e.g., 1.5 = 1.5x ATR below entry
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
  wallet?: 'spot' | 'funding' | 'earn';  // Which wallet the asset is in
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

// Exchange client cache per user - Crypto.com only
const clientCache = new Map<string, { client: IExchangeClient; expiresAt: number }>();
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
  apiSecret: string,
  exchange: ExchangeType = 'crypto_com',
  marginEnabled: boolean = false,
  leverage: number = 1
): Promise<void> {
  const encryptedApiKey = encryptToken(apiKey);
  const encryptedApiSecret = encryptToken(apiSecret);

  await pool.query(
    `INSERT INTO user_trading_keys (user_id, api_key_encrypted, api_secret_encrypted, exchange, margin_enabled, leverage)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       api_key_encrypted = $2,
       api_secret_encrypted = $3,
       exchange = $4,
       margin_enabled = $5,
       leverage = $6,
       updated_at = NOW()`,
    [userId, encryptedApiKey, encryptedApiSecret, exchange, marginEnabled, leverage]
  );

  // Invalidate cache
  clientCache.delete(userId);
  invalidateClientCache(userId);
}

async function getCryptoComClient(userId: string): Promise<IExchangeClient | null> {
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

  // Create Crypto.com client
  const client = createExchangeClient('crypto_com', keys);
  clientCache.set(userId, {
    client,
    expiresAt: Date.now() + CLIENT_CACHE_TTL,
  });

  return client;
}

// Legacy alias for backwards compatibility
const getBinanceClient = getCryptoComClient;

// Trading Service Functions

/**
 * Connect an exchange account (Binance or Crypto.com)
 */
export async function connectExchange(
  userId: string,
  apiKey: string,
  apiSecret: string,
  exchange: ExchangeType,
  marginEnabled: boolean = false,
  leverage: number = 1
): Promise<{ success: boolean; canTrade: boolean; error?: string }> {
  // Create and test the client
  const testClient = createExchangeClient(exchange, { apiKey, apiSecret });
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

  // Validate margin settings for Crypto.com
  if (exchange === 'crypto_com' && marginEnabled) {
    const validLeverage = Math.min(Math.max(leverage, 1), 10);
    await saveUserApiKeys(userId, apiKey, apiSecret, exchange, true, validLeverage);
  } else {
    await saveUserApiKeys(userId, apiKey, apiSecret, exchange, false, 1);
  }

  // Update trading settings
  await pool.query(
    `INSERT INTO trading_settings (user_id, exchange_connected, active_exchange)
     VALUES ($1, true, $2)
     ON CONFLICT (user_id) DO UPDATE SET
       exchange_connected = true,
       active_exchange = $2,
       updated_at = NOW()`,
    [userId, exchange]
  );

  logger.info('Crypto.com account connected', { userId, exchange });
  return { success: true, canTrade: true };
}

/**
 * Disconnect exchange account
 */
export async function disconnectExchange(userId: string): Promise<void> {
  await pool.query('DELETE FROM user_trading_keys WHERE user_id = $1', [userId]);
  await pool.query(
    `UPDATE trading_settings SET
       binance_connected = false,
       exchange_connected = false,
       active_exchange = NULL,
       updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
  clientCache.delete(userId);
  invalidateClientCache(userId);
  logger.info('Exchange account disconnected', { userId });
}

/**
 * Disconnect Binance account (backward compatible wrapper)
 */
export async function disconnectBinance(userId: string): Promise<void> {
  return disconnectExchange(userId);
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

  // Get margin settings from user_trading_keys if connected
  const marginSettings = await getUserMarginSettings(userId);

  return {
    userId: settings.user_id,
    binanceConnected: settings.binance_connected || false,
    exchangeConnected: settings.exchange_connected || settings.binance_connected || false,
    activeExchange: settings.active_exchange || (settings.binance_connected ? 'binance' : null),
    maxPositionPct: parseFloat(settings.max_position_pct),
    dailyLossLimitPct: parseFloat(settings.daily_loss_limit_pct),
    requireStopLoss: settings.require_stop_loss,
    defaultStopLossPct: parseFloat(settings.default_stop_loss_pct),
    useAtrStopLoss: settings.use_atr_stop_loss || false,
    atrMultiplier: parseFloat(settings.atr_multiplier || '1.5'),
    allowedSymbols: settings.allowed_symbols,
    riskTolerance: settings.risk_tolerance,
    paperMode: settings.paper_mode || false,
    paperBalanceUsdc: parseFloat(settings.paper_balance_usdc || '10000'),
    stopConfirmationThresholdUsd: parseFloat(settings.stop_confirmation_threshold_usd || '0'),
    marginEnabled: marginSettings?.marginEnabled || false,
    leverage: marginSettings?.leverage || 1,
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
  if (updates.useAtrStopLoss !== undefined) {
    setClauses.push(`use_atr_stop_loss = $${paramIndex++}`);
    values.push(updates.useAtrStopLoss);
  }
  if (updates.atrMultiplier !== undefined) {
    setClauses.push(`atr_multiplier = $${paramIndex++}`);
    values.push(updates.atrMultiplier);
  }
  if (updates.allowedSymbols !== undefined) {
    setClauses.push(`allowed_symbols = $${paramIndex++}`);
    values.push(updates.allowedSymbols);
  }
  if (updates.riskTolerance !== undefined) {
    setClauses.push(`risk_tolerance = $${paramIndex++}`);
    values.push(updates.riskTolerance);
  }
  if (updates.paperMode !== undefined) {
    setClauses.push(`paper_mode = $${paramIndex++}`);
    values.push(updates.paperMode);
  }
  if (updates.paperBalanceUsdc !== undefined) {
    setClauses.push(`paper_balance_usdc = $${paramIndex++}`);
    values.push(updates.paperBalanceUsdc);
  }
  if (updates.stopConfirmationThresholdUsd !== undefined) {
    setClauses.push(`stop_confirmation_threshold_usd = $${paramIndex++}`);
    values.push(updates.stopConfirmationThresholdUsd);
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

/**
 * Get portfolio for Crypto.com exchange
 */
async function getCryptoComPortfolio(userId: string): Promise<Portfolio | null> {
  const client = await getExchangeClient(userId) as CryptoComClient | null;
  if (!client) {
    return null;
  }

  try {
    // Get account info and prices
    const [accountInfo, tickerResult] = await Promise.all([
      client.getAccountInfo(),
      client.getTicker24hr(),
    ]);

    const tickers = Array.isArray(tickerResult) ? tickerResult : [tickerResult];

    // Create price lookup map
    const priceMap = new Map<string, { price: number; change: number }>();
    for (const t of tickers) {
      priceMap.set(t.symbol, {
        price: parseFloat(t.lastPrice),
        change: parseFloat(t.priceChangePercent),
      });
    }

    const holdings: PortfolioHolding[] = [];
    let totalValueUsdt = 0;
    let availableUsdt = 0;

    for (const balance of accountInfo.balances) {
      const free = parseFloat(balance.free);
      const locked = parseFloat(balance.locked);
      const amount = free + locked;

      if (amount <= 0) continue;

      let valueUsdt = 0;
      let price = 0;
      let priceChange24h = 0;

      if (balance.asset === 'USDC' || balance.asset === 'USDT' || balance.asset === 'USD') {
        valueUsdt = amount;
        price = 1;
        availableUsdt += free;
      } else {
        // Try to find price - symbols are normalized to Binance format (no underscore)
        const usdtSymbol = `${balance.asset}USDT`;
        const usdcSymbol = `${balance.asset}USDC`;
        const usdSymbol = `${balance.asset}USD`;
        const priceInfo = priceMap.get(usdtSymbol) || priceMap.get(usdcSymbol) || priceMap.get(usdSymbol);

        if (priceInfo) {
          price = priceInfo.price;
          valueUsdt = amount * price;
          priceChange24h = priceInfo.change;
        }
      }

      if (valueUsdt > 0.01) {
        holdings.push({
          symbol: `${balance.asset}USDT`,
          asset: balance.asset,
          amount,
          valueUsdt,
          price,
          priceChange24h,
          allocationPct: 0,
          wallet: 'spot',
        });
        totalValueUsdt += valueUsdt;
      }
    }

    // Calculate allocation percentages
    for (const holding of holdings) {
      holding.allocationPct = totalValueUsdt > 0 ? (holding.valueUsdt / totalValueUsdt) * 100 : 0;
    }

    // Sort by value descending
    holdings.sort((a, b) => b.valueUsdt - a.valueUsdt);

    return {
      totalValueUsdt,
      availableUsdt,
      holdings,
      dailyPnl: 0,
      dailyPnlPct: 0,
    };
  } catch (error) {
    logger.error('Failed to get Crypto.com portfolio', { userId, error: (error as Error).message });
    throw error;
  }
}

/**
 * Invalidate portfolio cache for a user (call after trades)
 */
export async function invalidatePortfolioCache(userId: string): Promise<void> {
  const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${userId}`;
  await redis.del(cacheKey);
}

export async function getPortfolio(userId: string): Promise<Portfolio | null> {
  // Check if paper mode is enabled
  const settings = await getSettings(userId);
  if (settings.paperMode) {
    // Return paper portfolio instead of real portfolio (no caching - changes immediately)
    const paperPort = await paperPortfolio.getPaperPortfolio(userId);
    return {
      totalValueUsdt: paperPort.totalValueUsdc,
      availableUsdt: paperPort.availableUsdc,
      holdings: paperPort.holdings.map(h => ({
        symbol: h.symbol,
        asset: h.asset,
        amount: h.amount,
        valueUsdt: h.valueUsdc,
        price: h.price,
        priceChange24h: h.priceChange24h,
        allocationPct: h.allocationPct,
        wallet: 'spot' as const,
      })),
      dailyPnl: paperPort.dailyPnl,
      dailyPnlPct: paperPort.dailyPnlPct,
    };
  }

  // Check portfolio cache first (60s TTL)
  const cacheKey = `${PORTFOLIO_CACHE_PREFIX}${userId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Portfolio;
    }
  } catch (err) {
    logger.warn('Failed to read portfolio cache', { userId, error: (err as Error).message });
  }

  // Check which exchange the user is using
  const exchangeType = await getUserExchangeType(userId);

  // For Crypto.com, use the factory and simplified portfolio
  if (exchangeType === 'crypto_com') {
    const portfolio = await getCryptoComPortfolio(userId);
    if (portfolio) {
      // Cache the result
      try {
        await redis.setex(cacheKey, PORTFOLIO_CACHE_TTL, JSON.stringify(portfolio));
      } catch (err) {
        logger.warn('Failed to cache portfolio', { userId, error: (err as Error).message });
      }
    }
    return portfolio;
  }

  // For Binance, use the existing detailed portfolio logic
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
    const allWallets = accountInfo.balances;

    // Create price lookup maps
    const priceMap = new Map<string, number>();
    for (const p of prices) {
      priceMap.set(p.symbol, parseFloat(p.price));
    }

    const tickerMap = new Map<string, Ticker24hr>();
    for (const t of tickers) {
      tickerMap.set(t.symbol, t);
    }

    // Helper to calculate asset value in USDT
    const calculateAssetValue = (asset: string, amount: number): { valueUsdt: number; price: number; priceChange24h: number } => {
      let valueUsdt = 0;
      let price = 0;
      let priceChange24h = 0;

      if (asset === 'USDC' || asset === 'USDT' || asset === 'BUSD') {
        valueUsdt = amount;
        price = 1;
      } else {
        // Try USDC pair first, then USDT
        const usdcSymbol = `${asset}USDC`;
        const usdtSymbol = `${asset}USDT`;
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
          const btcSymbol = `${asset}BTC`;
          const btcPrice = priceMap.get(btcSymbol);
          const btcUsdc = priceMap.get('BTCUSDC');
          if (btcPrice && btcUsdc) {
            price = btcPrice * btcUsdc;
            valueUsdt = amount * price;
          }
        }
      }

      return { valueUsdt, price, priceChange24h };
    };

    // Calculate holdings from account balances
    const holdings: PortfolioHolding[] = [];
    let totalValueUsdt = 0;
    let availableUsdt = 0;

    // Process all balances from Crypto.com
    for (const balance of allWallets) {
      const amount = parseFloat(balance.free) + parseFloat(balance.locked);
      if (amount <= 0) continue;

      const { valueUsdt, price, priceChange24h } = calculateAssetValue(balance.asset, amount);

      // Track available USD in spot
      if (balance.asset === 'USD') {
        availableUsdt = parseFloat(balance.free);
      } else if (balance.asset === 'USDC' || balance.asset === 'USDT') {
        availableUsdt += parseFloat(balance.free);
      }

      if (valueUsdt > 0.01) {
        holdings.push({
          symbol: `${balance.asset}_USD`,
          asset: balance.asset,
          amount,
          valueUsdt,
          price,
          priceChange24h,
          allocationPct: 0,
          wallet: 'spot',
        });
        totalValueUsdt += valueUsdt;
      }
    }

    // Calculate allocation percentages and sort by value
    for (const h of holdings) {
      h.allocationPct = totalValueUsdt > 0 ? (h.valueUsdt / totalValueUsdt) * 100 : 0;
    }
    holdings.sort((a, b) => b.valueUsdt - a.valueUsdt);

    // Get today's first snapshot for P&L calculation (baseline for the day)
    let snapshotResult = await pool.query(
      `SELECT total_value_usdt FROM portfolio_snapshots
       WHERE user_id = $1 AND DATE(snapshot_time) = CURRENT_DATE
       ORDER BY snapshot_time ASC LIMIT 1`,
      [userId]
    );

    // Fallback to yesterday's last snapshot if no snapshot exists today
    if (snapshotResult.rows.length === 0) {
      snapshotResult = await pool.query(
        `SELECT total_value_usdt FROM portfolio_snapshots
         WHERE user_id = $1 AND snapshot_time < CURRENT_DATE
         ORDER BY snapshot_time DESC LIMIT 1`,
        [userId]
      );
    }

    let dailyPnl = 0;
    let dailyPnlPct = 0;
    if (snapshotResult.rows.length > 0) {
      const baselineValue = parseFloat(snapshotResult.rows[0].total_value_usdt);
      if (baselineValue > 0) {
        dailyPnl = totalValueUsdt - baselineValue;
        dailyPnlPct = (dailyPnl / baselineValue) * 100;
        // Clamp to avoid DB overflow - DECIMAL(12,4) max is 99999999.9999
        dailyPnlPct = Math.max(-99999999, Math.min(99999999, dailyPnlPct));
      }
    }

    // Save snapshot
    await pool.query(
      `INSERT INTO portfolio_snapshots (user_id, total_value_usdt, holdings, daily_pnl, daily_pnl_pct)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, totalValueUsdt, JSON.stringify(holdings), dailyPnl, dailyPnlPct]
    );

    const portfolio = {
      totalValueUsdt,
      availableUsdt,
      holdings,
      dailyPnl,
      dailyPnlPct,
    };

    // Cache the result
    try {
      await redis.setex(cacheKey, PORTFOLIO_CACHE_TTL, JSON.stringify(portfolio));
    } catch (err) {
      logger.warn('Failed to cache portfolio', { userId, error: (err as Error).message });
    }

    return portfolio;
  } catch (error) {
    logger.error('Failed to get portfolio', { userId, error });
    throw error;
  }
}

/**
 * Get symbol info including step size for quantity rounding
 */
export async function getSymbolInfo(symbol: string): Promise<{
  symbol: string;
  stepSize: string;
  minQty: string;
  minNotional: string;
} | null> {
  const cryptoClient = new CryptoComClient({ apiKey: '', apiSecret: '' });
  return cryptoClient.getSymbolInfo(symbol);
}

export async function getPrices(
  _userId: string,
  symbols?: string[]
): Promise<{ symbol: string; price: number; change24h: number }[]> {
  // Use default Crypto.com pairs if no symbols specified
  const targetSymbols = symbols || getDefaultTradingPairs('crypto_com');
  const symbolSet = new Set(targetSymbols.map(s => toCryptoComSymbol(s)));

  logger.debug('getPrices called', { targetCount: targetSymbols.length, sampleSymbols: targetSymbols.slice(0, 5) });

  const results: { symbol: string; price: number; change24h: number }[] = [];
  const foundSymbols = new Set<string>();

  try {
    const cryptoClient = new CryptoComClient({ apiKey: '', apiSecret: '' });
    const cryptoTickers = await cryptoClient.getTicker24hr();
    const tickerArray = Array.isArray(cryptoTickers) ? cryptoTickers : [cryptoTickers];

    logger.debug('Crypto.com tickers received', { count: tickerArray.length });

    for (const t of tickerArray) {
      const normalizedSymbol = toCryptoComSymbol(t.symbol);
      if (symbolSet.has(normalizedSymbol) && !foundSymbols.has(normalizedSymbol)) {
        results.push({
          symbol: normalizedSymbol,
          price: parseFloat(t.lastPrice),
          change24h: parseFloat(t.priceChangePercent),
        });
        foundSymbols.add(normalizedSymbol);
      }
    }

    logger.info('getPrices completed', { requested: targetSymbols.length, found: results.length });
  } catch (error) {
    logger.warn('Failed to fetch Crypto.com prices', { error });
  }

  return results;
}

export async function getKlines(
  symbol: string,
  interval: string,
  limit: number = 100
): Promise<Kline[]> {
  // Use Crypto.com for klines - public endpoint
  const client = new CryptoComClient({ apiKey: '', apiSecret: '' });
  const cryptoSymbol = toCryptoComSymbol(symbol);
  return client.getKlines(cryptoSymbol, interval, limit);
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

/**
 * Execute a paper trade using simulated balance
 */
async function executePaperOrder(
  userId: string,
  params: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    quantity?: number;
    quoteAmount?: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    trailingStopPct?: number;
    notes?: string;
  },
  settings: TradingSettings
): Promise<TradeRecord> {
  // Get current price from Binance public API
  const currentPrice = await paperPortfolio.getCurrentPrice(params.symbol);

  // Calculate quantity if quoteAmount is specified
  let quantity = params.quantity;
  if (params.quoteAmount && !quantity) {
    quantity = params.quoteAmount / currentPrice;
  }

  if (!quantity || quantity <= 0) {
    throw new Error('Quantity or quoteAmount must be specified');
  }

  // Validate symbol - check if symbol matches any allowed symbol (handles format differences)
  const isSymbolAllowed = settings.allowedSymbols.some(allowed =>
    symbolUtils.symbolsEqual(params.symbol, allowed)
  );
  if (!isSymbolAllowed) {
    throw new Error(`Symbol ${params.symbol} is not in allowed list`);
  }

  // Check position size limit
  if (params.quoteAmount) {
    const portfolio = await paperPortfolio.getPaperPortfolio(userId);
    const maxPosition = (portfolio.totalValueUsdc * settings.maxPositionPct) / 100;
    if (params.quoteAmount > maxPosition) {
      throw new Error(
        `Order amount $${params.quoteAmount} exceeds max position size $${maxPosition.toFixed(2)} (${settings.maxPositionPct}%)`
      );
    }
  }

  // Auto-apply stop loss from settings if required and not provided
  let stopLossPrice = params.stopLoss;
  if (settings.requireStopLoss && params.side === 'buy' && !stopLossPrice) {
    // Try ATR-based stop loss first if enabled
    if (settings.useAtrStopLoss) {
      const atrStop = await calculateAtrStopLoss(
        params.symbol,
        currentPrice,
        settings.atrMultiplier,
        params.side
      );
      if (atrStop !== null) {
        stopLossPrice = atrStop;
        logger.info('Auto-applied ATR-based stop loss', {
          userId,
          symbol: params.symbol,
          currentPrice,
          atrMultiplier: settings.atrMultiplier,
          stopLossPrice,
        });
      }
    }

    // Fall back to percentage-based stop if ATR not available or disabled
    if (!stopLossPrice) {
      stopLossPrice = currentPrice * (1 - settings.defaultStopLossPct / 100);
      logger.info('Auto-applied percentage stop loss from settings', {
        userId,
        symbol: params.symbol,
        currentPrice,
        stopLossPct: settings.defaultStopLossPct,
        stopLossPrice,
      });
    }
  }

  // Execute paper trade
  const paperTrade = await paperPortfolio.executePaperTrade(userId, {
    symbol: params.symbol,
    side: params.side,
    quantity,
    price: currentPrice,
    source: 'manual',
    stopLoss: stopLossPrice,
    takeProfit: params.takeProfit,
  });

  const total = quantity * currentPrice;
  const fee = total * 0.001; // 0.1% simulated fee

  logger.info('[PAPER] Order executed', {
    userId,
    symbol: params.symbol,
    side: params.side,
    quantity,
    price: currentPrice,
    total,
  });

  // Return as TradeRecord format for compatibility
  return {
    id: paperTrade.id,
    userId,
    botId: null,
    symbol: params.symbol,
    side: params.side,
    orderType: params.type,
    quantity,
    price: params.price || null,
    filledPrice: currentPrice,
    total,
    fee,
    feeAsset: params.symbol.endsWith('USDT') ? 'USDT' : 'USDC',
    status: 'filled',
    binanceOrderId: `PAPER-${paperTrade.id.slice(0, 8)}`,
    stopLossPrice: params.stopLoss || null,
    takeProfitPrice: params.takeProfit || null,
    notes: params.notes ? `[PAPER] ${params.notes}` : '[PAPER TRADE]',
    createdAt: paperTrade.createdAt,
    filledAt: paperTrade.createdAt,
  };
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
  // Get settings for risk checks and paper mode
  const settings = await getSettings(userId);

  // Handle paper trading mode
  if (settings.paperMode) {
    return executePaperOrder(userId, params, settings);
  }

  const client = await getBinanceClient(userId);
  if (!client) {
    throw new Error('Binance not connected');
  }

  // Validate symbol - check if symbol matches any allowed symbol (handles format differences)
  const isSymbolAllowed = settings.allowedSymbols.some(allowed =>
    symbolUtils.symbolsEqual(params.symbol, allowed)
  );
  if (!isSymbolAllowed) {
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

  // Auto-apply stop loss from settings if required and not provided
  let stopLossPrice = params.stopLoss;
  if (settings.requireStopLoss && params.side === 'buy' && !stopLossPrice) {
    // Get current price to calculate stop loss
    const currentPrice = await paperPortfolio.getCurrentPrice(params.symbol);

    // Try ATR-based stop loss first if enabled
    if (settings.useAtrStopLoss) {
      const atrStop = await calculateAtrStopLoss(
        params.symbol,
        currentPrice,
        settings.atrMultiplier,
        params.side
      );
      if (atrStop !== null) {
        stopLossPrice = atrStop;
        logger.info('Auto-applied ATR-based stop loss', {
          userId,
          symbol: params.symbol,
          currentPrice,
          atrMultiplier: settings.atrMultiplier,
          stopLossPrice,
        });
      }
    }

    // Fall back to percentage-based stop if ATR not available or disabled
    if (!stopLossPrice) {
      stopLossPrice = currentPrice * (1 - settings.defaultStopLossPct / 100);
      logger.info('Auto-applied percentage stop loss from settings', {
        userId,
        symbol: params.symbol,
        currentPrice,
        stopLossPct: settings.defaultStopLossPct,
        stopLossPrice,
      });
    }
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
        // Fallback: use integer quantity for high-volume coins (like BONK, SHIB)
        // or 8 decimal places for others
        const qty = params.quantity;
        if (qty > 1000) {
          // Large quantity - likely a high-supply token, use whole units
          formattedQuantity = Math.floor(qty).toString();
        } else if (qty > 1) {
          // Medium quantity - use 2 decimals
          formattedQuantity = qty.toFixed(2);
        } else {
          // Small quantity - use 8 decimals
          formattedQuantity = qty.toFixed(8);
        }
        logger.warn('Using fallback quantity formatting', {
          symbol: params.symbol,
          original: params.quantity,
          formatted: formattedQuantity,
        });
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

    // Track the actual executed quantity
    let actualExecutedQty = parseFloat(binanceOrder.executedQty) || 0;

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
      // Use actual filled quantity from fills
      actualExecutedQty = totalQty;
    }

    // For market orders, if no fills yet but we have a requested quantity, use that
    // The order will be filled immediately for market orders
    if (actualExecutedQty === 0 && formattedQuantity) {
      actualExecutedQty = parseFloat(formattedQuantity);
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
        trailing_stop_pct, trailing_stop_price, trailing_stop_highest, notes, filled_at, exchange
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *`,
      [
        userId,
        params.symbol,
        params.side.toLowerCase(),
        params.type.toLowerCase(),
        actualExecutedQty,
        params.price,
        filledPrice || null,
        total || null,
        fee,
        feeAsset || null,
        mapOrderStatusToDb(binanceOrder.status),
        binanceOrder.orderId.toString(),
        stopLossPrice,
        params.takeProfit,
        params.trailingStopPct || null,
        trailingStopPrice,
        filledPrice || null, // Initial highest is entry price
        params.notes,
        binanceOrder.status === 'FILLED' ? new Date() : null,
        'crypto_com',
      ]
    );

    logger.info('Order placed', {
      userId,
      symbol: params.symbol,
      side: params.side,
      orderId: binanceOrder.orderId,
    });

    // Invalidate portfolio cache after trade
    await invalidatePortfolioCache(userId);

    // Send Telegram notification
    const tradeRecord = result.rows[0];
    const isFilled = tradeRecord.status === 'filled';
    if (isFilled) {
      tradeNotification.notifyOrderFilled(userId, {
        id: tradeRecord.id,
        symbol: tradeRecord.symbol,
        side: tradeRecord.side,
        quantity: parseFloat(tradeRecord.quantity),
        filledPrice: tradeRecord.filled_price ? parseFloat(tradeRecord.filled_price) : undefined,
        total: tradeRecord.total ? parseFloat(tradeRecord.total) : undefined,
        stopLossPrice: tradeRecord.stop_loss_price ? parseFloat(tradeRecord.stop_loss_price) : undefined,
        takeProfitPrice: tradeRecord.take_profit_price ? parseFloat(tradeRecord.take_profit_price) : undefined,
      }).catch((err) => logger.error('Failed to send trade notification', { error: err }));
    } else {
      tradeNotification.notifyOrderPlaced(userId, {
        id: tradeRecord.id,
        symbol: tradeRecord.symbol,
        side: tradeRecord.side,
        quantity: parseFloat(tradeRecord.quantity),
        price: tradeRecord.price ? parseFloat(tradeRecord.price) : undefined,
        stopLossPrice: tradeRecord.stop_loss_price ? parseFloat(tradeRecord.stop_loss_price) : undefined,
        takeProfitPrice: tradeRecord.take_profit_price ? parseFloat(tradeRecord.take_profit_price) : undefined,
      }).catch((err) => logger.error('Failed to send trade notification', { error: err }));
    }

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

  // Cancel on Crypto.com
  await client.cancelOrder(toCryptoComSymbol(symbol), binance_order_id);

  // Update database
  await pool.query(
    `UPDATE trades SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
    [tradeId]
  );

  logger.info('Order cancelled', { userId, tradeId });

  // Send Telegram notification
  tradeNotification.notifyOrderCancelled(userId, tradeId, symbol, 'unknown', null, 'cancelled')
    .catch((err) => logger.error('Failed to send cancel notification', { error: err }));
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
  if (status === 'running') {
    await pool.query(
      `UPDATE trading_bots SET status = $3, started_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [botId, userId, status]
    );
  } else if (status === 'stopped') {
    await pool.query(
      `UPDATE trading_bots SET status = $3, stopped_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [botId, userId, status]
    );
  } else {
    // error status - includes last_error
    await pool.query(
      `UPDATE trading_bots SET status = $3, last_error = $4, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [botId, userId, status, error]
    );
  }
}

export async function deleteBot(userId: string, botId: string): Promise<void> {
  // Stop bot in TradeCore if running
  if (tradecore.isTradeCoreEnabled()) {
    try {
      await tradecore.stopBot({ botId });
    } catch (error) {
      logger.warn('Failed to stop bot in TradeCore before delete', { botId, error });
    }
  }

  await pool.query('DELETE FROM trading_bots WHERE id = $1 AND user_id = $2', [botId, userId]);
  logger.info('Bot deleted', { userId, botId });
}

/**
 * Start a bot - delegates to TradeCore when enabled
 */
export async function startBot(userId: string, botId: string): Promise<{ success: boolean; error?: string }> {
  // Get bot config from database
  const result = await pool.query(
    'SELECT * FROM trading_bots WHERE id = $1 AND user_id = $2',
    [botId, userId]
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Bot not found' };
  }

  const bot = result.rows[0];

  // Check if already running
  if (bot.status === 'running') {
    return { success: false, error: 'Bot is already running' };
  }

  // Delegate to TradeCore if enabled
  if (tradecore.isTradeCoreEnabled()) {
    const response = await tradecore.startBot({
      userId,
      botId,
      type: bot.type,
      symbol: bot.symbol,
      config: bot.config,
    });

    if (!response.success) {
      logger.error('TradeCore failed to start bot', { botId, error: response.error });
      await updateBotStatus(userId, botId, 'error', response.error || 'Failed to start in TradeCore');
      return { success: false, error: response.error };
    }

    // Mark as TradeCore managed and running
    await pool.query(
      `UPDATE trading_bots SET
        status = 'running',
        tradecore_managed = true,
        started_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
       WHERE id = $1`,
      [botId]
    );

    logger.info('Bot started via TradeCore', { userId, botId, symbol: bot.symbol });
    return { success: true };
  }

  // Legacy mode - just update status (actual execution handled by bot-executor)
  await updateBotStatus(userId, botId, 'running');
  logger.info('Bot started (legacy mode)', { userId, botId });
  return { success: true };
}

/**
 * Stop a bot - delegates to TradeCore when enabled
 */
export async function stopBot(userId: string, botId: string): Promise<{ success: boolean; error?: string }> {
  // Get bot config from database
  const result = await pool.query(
    'SELECT * FROM trading_bots WHERE id = $1 AND user_id = $2',
    [botId, userId]
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Bot not found' };
  }

  const bot = result.rows[0];

  // Check if already stopped
  if (bot.status === 'stopped') {
    return { success: false, error: 'Bot is already stopped' };
  }

  // Delegate to TradeCore if enabled and bot is TradeCore managed
  if (tradecore.isTradeCoreEnabled() && bot.tradecore_managed) {
    const response = await tradecore.stopBot({ botId });

    if (!response.success) {
      logger.error('TradeCore failed to stop bot', { botId, error: response.error });
      // Still update local status to stopped
    }

    // Mark as stopped locally
    await pool.query(
      `UPDATE trading_bots SET
        status = 'stopped',
        tradecore_managed = false,
        stopped_at = NOW(),
        updated_at = NOW()
       WHERE id = $1`,
      [botId]
    );

    logger.info('Bot stopped via TradeCore', { userId, botId });
    return { success: true };
  }

  // Legacy mode - just update status
  await updateBotStatus(userId, botId, 'stopped');
  logger.info('Bot stopped (legacy mode)', { userId, botId });
  return { success: true };
}

/**
 * Get bot status from TradeCore if enabled and bot is managed
 */
export async function getBotStatus(userId: string, botId: string): Promise<{
  status: string;
  totalProfit?: number;
  totalTrades?: number;
  lastError?: string;
} | null> {
  const result = await pool.query(
    'SELECT * FROM trading_bots WHERE id = $1 AND user_id = $2',
    [botId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const bot = result.rows[0];

  // Get live status from TradeCore if managed
  if (tradecore.isTradeCoreEnabled() && bot.tradecore_managed) {
    const response = await tradecore.getBotStatus(botId);
    if (response.success && response.data) {
      return {
        status: response.data.status,
        totalProfit: response.data.totalProfit,
        totalTrades: response.data.totalTrades,
        lastError: response.data.lastError,
      };
    }
  }

  // Return local status
  return {
    status: bot.status,
    totalProfit: parseFloat(bot.total_profit),
    totalTrades: bot.total_trades,
    lastError: bot.last_error,
  };
}

/**
 * Update bot configuration - syncs with TradeCore if managed
 */
export async function updateBotConfig(
  userId: string,
  botId: string,
  config: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const result = await pool.query(
    'SELECT * FROM trading_bots WHERE id = $1 AND user_id = $2',
    [botId, userId]
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Bot not found' };
  }

  const bot = result.rows[0];

  // Update in TradeCore if managed
  if (tradecore.isTradeCoreEnabled() && bot.tradecore_managed) {
    const response = await tradecore.updateBotConfig(botId, config);
    if (!response.success) {
      logger.error('TradeCore failed to update bot config', { botId, error: response.error });
      return { success: false, error: response.error };
    }
  }

  // Update local database
  await pool.query(
    `UPDATE trading_bots SET config = $2, updated_at = NOW() WHERE id = $1`,
    [botId, JSON.stringify(config)]
  );

  logger.info('Bot config updated', { userId, botId });
  return { success: true };
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
    winRate: totalTrades > 0 ? winningTrades / totalTrades : 0, // Returns 0-1, not percentage
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

// ============================================
// Active Trades Functions (ACTIVE Tab)
// ============================================

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

/**
 * Get active trades - filled positions with SL/TP and pending orders
 * Only returns live trades (not paper)
 */
export async function getActiveTrades(userId: string): Promise<ActiveTradesResponse> {
  // Get current prices from Crypto.com
  const publicClient = new CryptoComClient({ apiKey: '', apiSecret: '' });
  const tickersResult = await publicClient.getTicker24hr();
  const tickers = (Array.isArray(tickersResult) ? tickersResult : [tickersResult]) as Ticker24hr[];
  const priceMap = new Map<string, number>();
  for (const t of tickers) {
    priceMap.set(t.symbol, parseFloat(t.lastPrice));
  }

  // Query open positions - ALL filled trades that haven't been closed
  // Filter out: zero-quantity trades, paper trades, and auto-close records
  const positionsResult = await pool.query(
    `SELECT * FROM trades
     WHERE user_id = $1
       AND status = 'filled'
       AND closed_at IS NULL
       AND quantity > 0
       AND (notes IS NULL OR notes NOT LIKE '[PAPER]%')
       AND (notes IS NULL OR notes NOT LIKE 'Auto-close:%')
     ORDER BY created_at DESC`,
    [userId]
  );

  // Query pending orders
  const pendingResult = await pool.query(
    `SELECT * FROM trades
     WHERE user_id = $1
       AND status IN ('pending', 'new')
       AND (notes IS NULL OR notes NOT LIKE '[PAPER]%')
     ORDER BY created_at DESC`,
    [userId]
  );

  const mapToActiveTrade = (row: Record<string, unknown>, type: 'position' | 'pending_order'): ActiveTrade => {
    const entryPrice = row.filled_price ? parseFloat(row.filled_price as string) : parseFloat(row.price as string) || 0;
    const symbol = row.symbol as string;
    // Normalize symbol to Binance format for lookup (getTicker24hr returns Binance format)
    const currentPrice = priceMap.get(toBinanceSymbol(symbol)) || entryPrice;
    const quantity = parseFloat(row.quantity as string);
    const side = row.side as 'buy' | 'sell';

    // Calculate P&L for filled positions
    let pnlDollar = 0;
    let pnlPercent = 0;
    if (type === 'position' && entryPrice > 0) {
      if (side === 'buy') {
        pnlDollar = (currentPrice - entryPrice) * quantity;
        pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      } else {
        pnlDollar = (entryPrice - currentPrice) * quantity;
        pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
      }
    }

    // Determine source from botId and notes
    let source: 'manual' | 'bot' | 'research' = 'manual';
    const botId = row.bot_id as string | null;
    const notes = row.notes as string | null;
    if (botId) {
      source = 'bot';
    } else if (notes && (notes.toLowerCase().includes('research') || notes.toLowerCase().includes('signal'))) {
      source = 'research';
    }

    const filledAt = row.filled_at as Date | null;
    const createdAt = row.created_at as Date;
    const timeInTrade = filledAt ? Date.now() - new Date(filledAt).getTime() : 0;

    return {
      id: row.id as string,
      symbol,
      side,
      quantity,
      entryPrice,
      currentPrice,
      pnlDollar,
      pnlPercent,
      stopLossPrice: row.stop_loss_price ? parseFloat(row.stop_loss_price as string) : null,
      takeProfitPrice: row.take_profit_price ? parseFloat(row.take_profit_price as string) : null,
      trailingStopPct: row.trailing_stop_pct ? parseFloat(row.trailing_stop_pct as string) : null,
      trailingStopPrice: row.trailing_stop_price ? parseFloat(row.trailing_stop_price as string) : null,
      timeInTrade,
      source,
      botId,
      binanceOrderId: row.binance_order_id as string | null,
      status: row.status as 'filled' | 'pending' | 'new',
      type,
      filledAt,
      createdAt,
    };
  };

  const openPositions = positionsResult.rows.map(row => mapToActiveTrade(row, 'position'));
  const pendingOrders = pendingResult.rows.map(row => mapToActiveTrade(row, 'pending_order'));

  // Sort by P&L ascending (worst performing first)
  openPositions.sort((a, b) => a.pnlDollar - b.pnlDollar);

  return { openPositions, pendingOrders };
}

/**
 * Update SL/TP/trailing stop on a trade
 */
export async function updateTradeSLTP(
  userId: string,
  tradeId: string,
  params: UpdateTradeSLTPParams
): Promise<TradeRecord> {
  // Verify trade belongs to user and is filled
  const result = await pool.query(
    'SELECT * FROM trades WHERE id = $1 AND user_id = $2',
    [tradeId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Trade not found');
  }

  const trade = result.rows[0];
  if (trade.status !== 'filled') {
    throw new Error('Can only update SL/TP on filled trades');
  }
  if (trade.closed_at) {
    throw new Error('Cannot update SL/TP on closed trades');
  }

  // Build update query
  const updates: string[] = [];
  const values: unknown[] = [tradeId];
  let paramIndex = 2;

  if (params.stopLossPrice !== undefined) {
    updates.push(`stop_loss_price = $${paramIndex++}`);
    values.push(params.stopLossPrice);
  }
  if (params.takeProfitPrice !== undefined) {
    updates.push(`take_profit_price = $${paramIndex++}`);
    values.push(params.takeProfitPrice);
  }
  if (params.trailingStopPct !== undefined) {
    updates.push(`trailing_stop_pct = $${paramIndex++}`);
    values.push(params.trailingStopPct);

    // Recalculate trailing stop price if setting a new percentage
    if (params.trailingStopPct !== null && trade.filled_price) {
      const filledPrice = parseFloat(trade.filled_price);
      const side = trade.side;
      let trailingStopPrice: number;
      if (side === 'buy') {
        trailingStopPrice = filledPrice * (1 - params.trailingStopPct / 100);
      } else {
        trailingStopPrice = filledPrice * (1 + params.trailingStopPct / 100);
      }
      updates.push(`trailing_stop_price = $${paramIndex++}`);
      values.push(trailingStopPrice);
      updates.push(`trailing_stop_highest = $${paramIndex++}`);
      values.push(filledPrice);
    } else if (params.trailingStopPct === null) {
      updates.push(`trailing_stop_price = NULL`);
      updates.push(`trailing_stop_highest = NULL`);
    }
  }

  if (updates.length === 0) {
    throw new Error('No updates provided');
  }

  updates.push('updated_at = NOW()');

  const updateResult = await pool.query(
    `UPDATE trades SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );

  const row = updateResult.rows[0];
  logger.info('Trade SL/TP updated', { userId, tradeId, params });

  return {
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
  };
}

/**
 * Partial close a position
 */
export async function partialClosePosition(
  userId: string,
  tradeId: string,
  closeQuantity: number
): Promise<TradeRecord> {
  const client = await getBinanceClient(userId);
  if (!client) {
    throw new Error('Binance not connected');
  }

  // Get trade
  const result = await pool.query(
    'SELECT * FROM trades WHERE id = $1 AND user_id = $2',
    [tradeId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Trade not found');
  }

  const trade = result.rows[0];
  if (trade.status !== 'filled') {
    throw new Error('Can only partial close filled positions');
  }
  if (trade.closed_at) {
    throw new Error('Position already closed');
  }

  const currentQuantity = parseFloat(trade.quantity);
  if (closeQuantity >= currentQuantity) {
    throw new Error('Close quantity must be less than position quantity. Use stopTrade for full close.');
  }
  if (closeQuantity <= 0) {
    throw new Error('Close quantity must be positive');
  }

  // Get lot size filter to format quantity correctly
  const lotSize = await client.getLotSizeFilter(trade.symbol);
  let formattedQuantity: string;
  if (lotSize) {
    formattedQuantity = formatQuantity(closeQuantity, lotSize.stepSize);
    const minQty = parseFloat(lotSize.minQty);
    if (parseFloat(formattedQuantity) < minQty) {
      throw new Error(`Close quantity ${formattedQuantity} is below minimum ${minQty}`);
    }
  } else {
    formattedQuantity = closeQuantity.toString();
  }

  // Execute opposite side market order for partial close
  const closeSide = trade.side === 'buy' ? 'SELL' : 'BUY';
  const binanceOrder = await client.placeOrder({
    symbol: trade.symbol,
    side: closeSide,
    type: 'MARKET',
    quantity: formattedQuantity,
  });

  // Calculate filled price
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

  // Update original trade quantity
  const newQuantity = currentQuantity - parseFloat(formattedQuantity);
  await pool.query(
    `UPDATE trades SET quantity = $2, updated_at = NOW() WHERE id = $1`,
    [tradeId, newQuantity]
  );

  // Record the partial close as a new trade
  const closeResult = await pool.query(
    `INSERT INTO trades (
      user_id, symbol, side, order_type, quantity, filled_price, total,
      fee, fee_asset, status, binance_order_id, notes, filled_at
    ) VALUES ($1, $2, $3, 'market', $4, $5, $6, $7, $8, 'filled', $9, $10, NOW())
    RETURNING *`,
    [
      userId,
      trade.symbol,
      closeSide.toLowerCase(),
      parseFloat(formattedQuantity),
      filledPrice,
      total,
      fee,
      feeAsset || null,
      binanceOrder.orderId.toString(),
      `Partial close of ${tradeId}`,
    ]
  );

  logger.info('Position partially closed', {
    userId,
    tradeId,
    closeQuantity: formattedQuantity,
    remainingQuantity: newQuantity,
  });

  const row = closeResult.rows[0];
  return {
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
    stopLossPrice: null,
    takeProfitPrice: null,
    notes: row.notes,
    createdAt: row.created_at,
    filledAt: row.filled_at,
  };
}

/**
 * Stop a trade - close filled position at market or cancel pending order
 */
export async function stopTrade(
  userId: string,
  tradeId: string,
  skipConfirmation: boolean = false
): Promise<{ success: boolean; requiresConfirmation?: boolean; tradeValue?: number; error?: string }> {
  // Get trade
  const result = await pool.query(
    'SELECT * FROM trades WHERE id = $1 AND user_id = $2',
    [tradeId, userId]
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Trade not found' };
  }

  const trade = result.rows[0];

  // Get current price for value calculation from Crypto.com
  const publicClient = new CryptoComClient({ apiKey: '', apiSecret: '' });
  let currentPrice = 0;
  try {
    const cryptoSymbol = toCryptoComSymbol(trade.symbol);
    const ticker = (await publicClient.getTicker24hr(cryptoSymbol)) as Ticker24hr;
    currentPrice = parseFloat(ticker.lastPrice);
  } catch {
    // Use filled price as fallback
    currentPrice = trade.filled_price ? parseFloat(trade.filled_price) : parseFloat(trade.price || '0');
  }

  const quantity = parseFloat(trade.quantity);
  const tradeValue = currentPrice * quantity;

  // Check confirmation threshold
  if (!skipConfirmation) {
    const settings = await getSettings(userId);
    if (settings.stopConfirmationThresholdUsd > 0 && tradeValue >= settings.stopConfirmationThresholdUsd) {
      return { success: false, requiresConfirmation: true, tradeValue };
    }
  }

  // Handle based on trade status
  if (trade.status === 'pending' || trade.status === 'new') {
    // Cancel pending order
    try {
      await cancelOrder(userId, tradeId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to cancel order' };
    }
  } else if (trade.status === 'filled' && !trade.closed_at) {
    // Close filled position at market using user's configured exchange
    const client = await getExchangeClient(userId);
    if (!client) {
      return { success: false, error: 'Exchange not connected' };
    }

    try {
      // Convert symbol to exchange format
      const exchangeSymbol = toCryptoComSymbol(trade.symbol);

      // Get lot size filter if available
      let formattedQuantity: string;
      if (client.getLotSizeFilter) {
        const lotSize = await client.getLotSizeFilter(exchangeSymbol);
        if (lotSize) {
          formattedQuantity = formatQuantity(quantity, lotSize.stepSize);
        } else {
          formattedQuantity = quantity.toString();
        }
      } else {
        formattedQuantity = quantity.toString();
      }

      // Execute opposite side market order
      const closeSide = trade.side === 'buy' ? 'SELL' : 'BUY';
      const order = await client.placeOrder({
        symbol: exchangeSymbol,
        side: closeSide,
        type: 'MARKET',
        quantity: formattedQuantity,
      });

      // Calculate filled price from order response
      let filledPrice = order.averagePrice || 0;
      let total = order.total || 0;

      // Fallback to fills array if averagePrice not available
      if (!filledPrice && order.fills && order.fills.length > 0) {
        let totalQty = 0;
        let totalValue = 0;
        for (const fill of order.fills) {
          totalQty += parseFloat(fill.qty);
          totalValue += parseFloat(fill.qty) * parseFloat(fill.price);
        }
        filledPrice = totalValue / totalQty;
        total = totalValue;
      }

      // Update original trade as closed
      await pool.query(
        `UPDATE trades SET
          closed_at = NOW(),
          close_price = $2,
          close_reason = 'manual',
          close_order_id = $3
        WHERE id = $1`,
        [tradeId, filledPrice, order.orderId]
      );

      logger.info('Position stopped (manual close)', {
        userId,
        tradeId,
        symbol: trade.symbol,
        closePrice: filledPrice,
      });

      // Send notification
      const entryPrice = trade.filled_price ? parseFloat(trade.filled_price) : 0;
      tradeNotification.notifyTpSlTriggered(userId, tradeId, trade.symbol, trade.side, 'stop_loss', entryPrice, filledPrice, quantity)
        .catch(err => logger.error('Failed to send stop notification', { error: err }));

      return { success: true, tradeValue: total };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to close position';

      // Handle case where asset was already sold manually on exchange
      if (errorMessage.includes('insufficient balance') || errorMessage.includes('Account has insufficient') || errorMessage.includes('INSUFFICIENT_AVAILABLE_BALANCE')) {
        logger.info('Position already closed externally, marking as closed', { userId, tradeId, symbol: trade.symbol });

        // Mark trade as closed (position was sold externally)
        await pool.query(
          `UPDATE trades SET
            closed_at = NOW(),
            close_price = $2,
            close_reason = 'manual',
            notes = COALESCE(notes, '') || ' [Closed externally - insufficient balance on stop]'
          WHERE id = $1`,
          [tradeId, currentPrice]
        );

        return { success: true, tradeValue: currentPrice * quantity };
      }

      logger.error('Failed to stop trade', { userId, tradeId, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  } else {
    return { success: false, error: 'Trade cannot be stopped (already closed or invalid status)' };
  }
}

// ============ Margin Trading Functions (Crypto.com) ============

/**
 * Get user's margin leverage
 */
export async function getMarginLeverage(userId: string): Promise<number> {
  const marginSettings = await getUserMarginSettings(userId);
  return marginSettings?.leverage || 1;
}

/**
 * Set user's margin leverage (1-10x)
 */
export async function setMarginLeverage(userId: string, leverage: number): Promise<void> {
  const validLeverage = Math.min(Math.max(Math.floor(leverage), 1), 10);

  // Update database
  await pool.query(
    `UPDATE user_trading_keys SET leverage = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, validLeverage]
  );

  // Update client if connected
  const client = await getMarginClient(userId);
  if (client) {
    await client.setLeverage(validLeverage);
  }

  // Invalidate cache
  invalidateClientCache(userId);
  logger.info('Margin leverage updated', { userId, leverage: validLeverage });
}

/**
 * Get margin account info
 */
export async function getMarginAccountInfo(userId: string): Promise<{
  totalEquity: number;
  availableMargin: number;
  usedMargin: number;
  marginRatio: number;
} | null> {
  const client = await getMarginClient(userId);
  if (!client) {
    return null;
  }

  return client.getMarginAccountInfo();
}

/**
 * Get open margin positions
 */
export async function getMarginPositions(userId: string): Promise<Array<{
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  marginUsed: number;
}>> {
  const client = await getMarginClient(userId);
  if (!client) {
    return [];
  }

  return client.getMarginPositions();
}

/**
 * Place a margin order (long or short)
 */
export async function placeMarginOrder(
  userId: string,
  params: {
    symbol: string;
    side: 'long' | 'short';
    type: 'market' | 'limit';
    quantity?: number;
    quoteAmount?: number;
    price?: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
  }
): Promise<TradeRecord> {
  const client = await getMarginClient(userId);
  if (!client) {
    throw new Error('Margin trading not available - connect Crypto.com first');
  }

  const settings = await getSettings(userId);
  const leverage = params.leverage || settings.leverage;

  // Map side to order side
  const orderSide = params.side === 'long' ? 'BUY' : 'SELL';
  const orderType = params.type.toUpperCase() as 'MARKET' | 'LIMIT';

  // Get symbol info for formatting
  const symbolInfo = await client.getSymbolInfo(params.symbol);
  if (!symbolInfo) {
    throw new Error(`Symbol ${params.symbol} not found`);
  }

  // Place the margin order
  const order = await client.placeMarginOrder({
    symbol: params.symbol,
    side: orderSide,
    type: orderType,
    quantity: params.quantity ? String(params.quantity) : undefined,
    quoteOrderQty: params.quoteAmount ? String(params.quoteAmount) : undefined,
    price: params.price ? String(params.price) : undefined,
    marginMode: 'MARGIN',
    leverage,
  });

  // Calculate filled price from fills
  let filledPrice = 0;
  let total = 0;
  let fee = 0;
  let feeAsset = '';

  if (order.fills && order.fills.length > 0) {
    let totalQty = 0;
    let totalValue = 0;
    for (const fill of order.fills) {
      totalQty += parseFloat(fill.qty);
      totalValue += parseFloat(fill.qty) * parseFloat(fill.price);
      fee += parseFloat(fill.commission);
      feeAsset = fill.commissionAsset;
    }
    filledPrice = totalValue / totalQty;
    total = totalValue;
  }

  // Save to database
  const tradeResult = await pool.query(
    `INSERT INTO trades (
      user_id, symbol, side, order_type, quantity, price, filled_price, total, fee, fee_asset,
      status, binance_order_id, stop_loss_price, take_profit_price, exchange, margin_mode, leverage, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING *`,
    [
      userId,
      toCryptoComSymbol(order.symbol),
      params.side === 'long' ? 'buy' : 'sell',
      params.type,
      parseFloat(order.executedQty || order.quantity),
      params.price || null,
      filledPrice || null,
      total || null,
      fee,
      feeAsset || null,
      order.status === 'FILLED' ? 'filled' : 'pending',
      order.orderId,
      params.stopLoss || null,
      params.takeProfit || null,
      'crypto_com',
      'MARGIN',
      leverage,
      `Margin ${params.side} position`,
    ]
  );

  const trade = tradeResult.rows[0];

  logger.info('Margin order placed', {
    userId,
    tradeId: trade.id,
    symbol: params.symbol,
    side: params.side,
    leverage,
  });

  return {
    id: trade.id,
    userId: trade.user_id,
    botId: trade.bot_id,
    symbol: trade.symbol,
    side: trade.side,
    orderType: trade.order_type,
    quantity: parseFloat(trade.quantity),
    price: trade.price ? parseFloat(trade.price) : null,
    filledPrice: trade.filled_price ? parseFloat(trade.filled_price) : null,
    total: trade.total ? parseFloat(trade.total) : null,
    fee: parseFloat(trade.fee || '0'),
    feeAsset: trade.fee_asset,
    status: trade.status,
    binanceOrderId: trade.binance_order_id,
    stopLossPrice: trade.stop_loss_price ? parseFloat(trade.stop_loss_price) : null,
    takeProfitPrice: trade.take_profit_price ? parseFloat(trade.take_profit_price) : null,
    notes: trade.notes,
    createdAt: trade.created_at,
    filledAt: trade.filled_at,
  };
}

/**
 * Close a margin position
 */
export async function closeMarginPosition(
  userId: string,
  symbol: string,
  side: 'long' | 'short'
): Promise<TradeRecord> {
  const client = await getMarginClient(userId);
  if (!client) {
    throw new Error('Margin trading not available');
  }

  const order = await client.closeMarginPosition(symbol, side);

  // Calculate filled price
  let filledPrice = 0;
  let total = 0;
  if (order.fills && order.fills.length > 0) {
    let totalQty = 0;
    let totalValue = 0;
    for (const fill of order.fills) {
      totalQty += parseFloat(fill.qty);
      totalValue += parseFloat(fill.qty) * parseFloat(fill.price);
    }
    filledPrice = totalValue / totalQty;
    total = totalValue;
  }

  // Save close trade to database
  const tradeResult = await pool.query(
    `INSERT INTO trades (
      user_id, symbol, side, order_type, quantity, filled_price, total, status,
      binance_order_id, exchange, margin_mode, notes
    ) VALUES ($1, $2, $3, 'market', $4, $5, $6, 'filled', $7, 'crypto_com', 'MARGIN', $8)
    RETURNING *`,
    [
      userId,
      toCryptoComSymbol(order.symbol),
      side === 'long' ? 'sell' : 'buy',
      parseFloat(order.executedQty),
      filledPrice,
      total,
      order.orderId,
      `Close ${side} position`,
    ]
  );

  const trade = tradeResult.rows[0];

  logger.info('Margin position closed', {
    userId,
    tradeId: trade.id,
    symbol,
    side,
  });

  return {
    id: trade.id,
    userId: trade.user_id,
    botId: null,
    symbol: trade.symbol,
    side: trade.side,
    orderType: trade.order_type,
    quantity: parseFloat(trade.quantity),
    price: null,
    filledPrice: trade.filled_price ? parseFloat(trade.filled_price) : null,
    total: trade.total ? parseFloat(trade.total) : null,
    fee: 0,
    feeAsset: null,
    status: trade.status,
    binanceOrderId: trade.binance_order_id,
    stopLossPrice: null,
    takeProfitPrice: null,
    notes: trade.notes,
    createdAt: trade.created_at,
    filledAt: trade.filled_at,
  };
}

/**
 * Get user's active exchange type
 */
export { getUserExchangeType };

// ============================================
// TRADING RULES (Visual Builder)
// ============================================

interface TradingRuleCondition {
  id: string;
  type: 'price' | 'indicator' | 'time' | 'change';
  symbol?: string;
  indicator?: string;
  timeframe?: string;
  operator: string;
  value: number;
}

interface TradingRuleAction {
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

interface TradingRuleInput {
  id?: string;
  name: string;
  description: string;
  enabled: boolean;
  conditionLogic: 'AND' | 'OR';
  conditions: TradingRuleCondition[];
  actions: TradingRuleAction[];
  maxExecutions?: number;
  cooldownMinutes?: number;
}

interface TradingRuleRecord {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditionLogic: 'AND' | 'OR';
  conditions: TradingRuleCondition[];
  actions: TradingRuleAction[];
  maxExecutions?: number;
  cooldownMinutes?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Get all trading rules for a user with their conditions and actions
 */
export async function getTradingRules(userId: string): Promise<TradingRuleRecord[]> {
  // Get all rules
  const rulesResult = await pool.query(
    `SELECT id, name, description, enabled, condition_logic, max_executions, cooldown_minutes, created_at, updated_at
     FROM trading_rules WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  if (rulesResult.rows.length === 0) {
    return [];
  }

  const ruleIds = rulesResult.rows.map(r => r.id);

  // Get all conditions for these rules
  const conditionsResult = await pool.query(
    `SELECT id, rule_id, condition_type, symbol, indicator, timeframe, operator, value
     FROM trading_rule_conditions WHERE rule_id = ANY($1) ORDER BY sort_order`,
    [ruleIds]
  );

  // Get all actions for these rules
  const actionsResult = await pool.query(
    `SELECT id, rule_id, action_type, symbol, amount_type, amount, order_type, limit_price, stop_loss, take_profit
     FROM trading_rule_actions WHERE rule_id = ANY($1) ORDER BY sort_order`,
    [ruleIds]
  );

  // Group conditions and actions by rule_id
  const conditionsByRule = new Map<string, TradingRuleCondition[]>();
  const actionsByRule = new Map<string, TradingRuleAction[]>();

  conditionsResult.rows.forEach(c => {
    const ruleId = c.rule_id;
    if (!conditionsByRule.has(ruleId)) {
      conditionsByRule.set(ruleId, []);
    }
    conditionsByRule.get(ruleId)!.push({
      id: c.id,
      type: c.condition_type,
      symbol: c.symbol || undefined,
      indicator: c.indicator || undefined,
      timeframe: c.timeframe || undefined,
      operator: c.operator,
      value: parseFloat(c.value),
    });
  });

  actionsResult.rows.forEach(a => {
    const ruleId = a.rule_id;
    if (!actionsByRule.has(ruleId)) {
      actionsByRule.set(ruleId, []);
    }
    actionsByRule.get(ruleId)!.push({
      id: a.id,
      type: a.action_type,
      symbol: a.symbol || undefined,
      amountType: a.amount_type,
      amount: parseFloat(a.amount),
      orderType: a.order_type,
      limitPrice: a.limit_price ? parseFloat(a.limit_price) : undefined,
      stopLoss: a.stop_loss ? parseFloat(a.stop_loss) : undefined,
      takeProfit: a.take_profit ? parseFloat(a.take_profit) : undefined,
    });
  });

  return rulesResult.rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    enabled: r.enabled,
    conditionLogic: r.condition_logic,
    conditions: conditionsByRule.get(r.id) || [],
    actions: actionsByRule.get(r.id) || [],
    maxExecutions: r.max_executions || undefined,
    cooldownMinutes: r.cooldown_minutes || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Create a new trading rule
 */
export async function createTradingRule(userId: string, rule: TradingRuleInput): Promise<TradingRuleRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert the rule
    const ruleResult = await client.query(
      `INSERT INTO trading_rules (user_id, name, description, enabled, condition_logic, max_executions, cooldown_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, rule.name, rule.description, rule.enabled, rule.conditionLogic, rule.maxExecutions || null, rule.cooldownMinutes || null]
    );
    const newRule = ruleResult.rows[0];

    // Insert conditions
    for (let i = 0; i < rule.conditions.length; i++) {
      const c = rule.conditions[i];
      await client.query(
        `INSERT INTO trading_rule_conditions (rule_id, condition_type, symbol, indicator, timeframe, operator, value, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newRule.id, c.type, c.symbol || null, c.indicator || null, c.timeframe || null, c.operator, c.value, i]
      );
    }

    // Insert actions
    for (let i = 0; i < rule.actions.length; i++) {
      const a = rule.actions[i];
      await client.query(
        `INSERT INTO trading_rule_actions (rule_id, action_type, symbol, amount_type, amount, order_type, limit_price, stop_loss, take_profit, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [newRule.id, a.type, a.symbol || null, a.amountType, a.amount, a.orderType, a.limitPrice || null, a.stopLoss || null, a.takeProfit || null, i]
      );
    }

    await client.query('COMMIT');

    logger.info('Created trading rule', { userId, ruleId: newRule.id, name: rule.name });

    // Fetch and return the complete rule
    const rules = await getTradingRules(userId);
    return rules.find(r => r.id === newRule.id)!;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update an existing trading rule
 */
export async function updateTradingRule(userId: string, ruleId: string, rule: TradingRuleInput): Promise<TradingRuleRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify ownership
    const ownerCheck = await client.query(
      'SELECT id FROM trading_rules WHERE id = $1 AND user_id = $2',
      [ruleId, userId]
    );
    if (ownerCheck.rows.length === 0) {
      throw new Error('Rule not found or access denied');
    }

    // Update the rule
    await client.query(
      `UPDATE trading_rules SET name = $1, description = $2, enabled = $3, condition_logic = $4, max_executions = $5, cooldown_minutes = $6
       WHERE id = $7`,
      [rule.name, rule.description, rule.enabled, rule.conditionLogic, rule.maxExecutions || null, rule.cooldownMinutes || null, ruleId]
    );

    // Delete existing conditions and actions
    await client.query('DELETE FROM trading_rule_conditions WHERE rule_id = $1', [ruleId]);
    await client.query('DELETE FROM trading_rule_actions WHERE rule_id = $1', [ruleId]);

    // Insert new conditions
    for (let i = 0; i < rule.conditions.length; i++) {
      const c = rule.conditions[i];
      await client.query(
        `INSERT INTO trading_rule_conditions (rule_id, condition_type, symbol, indicator, timeframe, operator, value, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ruleId, c.type, c.symbol || null, c.indicator || null, c.timeframe || null, c.operator, c.value, i]
      );
    }

    // Insert new actions
    for (let i = 0; i < rule.actions.length; i++) {
      const a = rule.actions[i];
      await client.query(
        `INSERT INTO trading_rule_actions (rule_id, action_type, symbol, amount_type, amount, order_type, limit_price, stop_loss, take_profit, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [ruleId, a.type, a.symbol || null, a.amountType, a.amount, a.orderType, a.limitPrice || null, a.stopLoss || null, a.takeProfit || null, i]
      );
    }

    await client.query('COMMIT');

    logger.info('Updated trading rule', { userId, ruleId, name: rule.name });

    // Fetch and return the complete rule
    const rules = await getTradingRules(userId);
    return rules.find(r => r.id === ruleId)!;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete a trading rule
 */
export async function deleteTradingRule(userId: string, ruleId: string): Promise<void> {
  const result = await pool.query(
    'DELETE FROM trading_rules WHERE id = $1 AND user_id = $2 RETURNING id',
    [ruleId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Rule not found or access denied');
  }

  logger.info('Deleted trading rule', { userId, ruleId });
}
