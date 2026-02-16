/**
 * Paper Portfolio Service
 *
 * Manages simulated portfolio for paper trading mode.
 * Uses real-time Crypto.com prices but tracks virtual balances.
 */

import { pool } from '../db/index.js';
import { CryptoComClient } from './crypto-com.client.js';
import { getBaseQuote } from './symbol-utils.js';
import { logger } from '../utils/logger.js';

// Types
export interface PaperPortfolio {
  totalValueUsdc: number;
  availableUsdc: number;
  holdings: PaperHolding[];
  dailyPnl: number;
  dailyPnlPct: number;
}

export interface PaperHolding {
  asset: string;
  symbol: string;
  amount: number;
  valueUsdc: number;
  price: number;
  priceChange24h: number;
  allocationPct: number;
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
  createdAt: Date;
}

// Public Crypto.com client for price data (no auth needed)
const publicClient = new CryptoComClient({ apiKey: '', apiSecret: '' });

/**
 * Initialize paper portfolio with starting USDC balance
 */
export async function initializePaperPortfolio(
  userId: string,
  startingBalanceUsdc: number
): Promise<void> {
  await pool.query('SELECT initialize_paper_portfolio($1, $2)', [
    userId,
    startingBalanceUsdc,
  ]);

  logger.info('[PAPER] Initialized paper portfolio', {
    userId,
    startingBalance: startingBalanceUsdc,
  });
}

/**
 * Get paper portfolio with real-time prices
 */
export async function getPaperPortfolio(userId: string): Promise<PaperPortfolio> {
  // Get paper balances
  const result = await pool.query<{
    asset: string;
    balance: string;
  }>(
    `SELECT asset, balance FROM paper_portfolio WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    // No paper portfolio yet - return empty with default USDC
    return {
      totalValueUsdc: 0,
      availableUsdc: 0,
      holdings: [],
      dailyPnl: 0,
      dailyPnlPct: 0,
    };
  }

  // Get crypto assets (non-USDC with positive balance)
  const assets = result.rows.filter(r => r.asset !== 'USDC' && parseFloat(r.balance) > 0);

  // Batch-fetch ALL tickers at once (single API call) and build price map keyed by base asset
  const priceByBase: Record<string, { price: number; change24h: number }> = {};

  if (assets.length > 0) {
    try {
      const allTickers = await publicClient.getTicker24hr();
      const tickerArray = Array.isArray(allTickers) ? allTickers : [allTickers];

      for (const t of tickerArray) {
        // Tickers are in Binance format (e.g., BTCUSD, ETHUSD)
        const { base, quote } = getBaseQuote(t.symbol);
        // Only use USD/USDT/USDC quoted pairs for valuation
        if (base && (quote === 'USD' || quote === 'USDT' || quote === 'USDC')) {
          // First match wins (USD pairs from Crypto.com are primary)
          if (!priceByBase[base]) {
            priceByBase[base] = {
              price: parseFloat(t.lastPrice),
              change24h: parseFloat(t.priceChangePercent),
            };
          }
        }
      }
    } catch (error) {
      logger.warn('[PAPER] Failed to fetch prices', { error });
    }
  }

  // Calculate holdings
  const holdings: PaperHolding[] = [];
  let totalValueUsdc = 0;
  let availableUsdc = 0;

  for (const row of result.rows) {
    const balance = parseFloat(row.balance);

    if (row.asset === 'USDC') {
      availableUsdc = balance;
      totalValueUsdc += balance;
      // Add USDC as a holding
      holdings.push({
        asset: 'USDC',
        symbol: 'USDC',
        amount: balance,
        valueUsdc: balance,
        price: 1,
        priceChange24h: 0,
        allocationPct: 0, // Will calculate after total is known
      });
    } else if (balance > 0) {
      // Extract clean base asset name (handles corrupted names like HBARUSD, BTC_USD)
      const { base: cleanAsset } = getBaseQuote(row.asset);
      const assetName = cleanAsset || row.asset; // Fallback to raw name
      const symbol = `${assetName}USDC`;
      const priceData = priceByBase[assetName] || { price: 0, change24h: 0 };
      const valueUsdc = balance * priceData.price;
      totalValueUsdc += valueUsdc;

      holdings.push({
        asset: assetName,
        symbol,
        amount: balance,
        valueUsdc,
        price: priceData.price,
        priceChange24h: priceData.change24h,
        allocationPct: 0, // Will calculate after total is known
      });
    }
  }

  // Calculate allocation percentages
  for (const holding of holdings) {
    holding.allocationPct = totalValueUsdc > 0 ? (holding.valueUsdc / totalValueUsdc) * 100 : 0;
  }

  // Sort by value descending
  holdings.sort((a, b) => b.valueUsdc - a.valueUsdc);

  // Calculate daily P&L from paper trades
  const pnlResult = await pool.query<{ daily_pnl: string }>(
    `SELECT COALESCE(SUM(
      CASE
        WHEN side = 'sell' THEN total_usdt
        ELSE -total_usdt
      END
    ), 0) as daily_pnl
    FROM paper_trades
    WHERE user_id = $1
    AND created_at >= CURRENT_DATE
    AND status = 'filled'`,
    [userId]
  );

  const dailyPnl = parseFloat(pnlResult.rows[0]?.daily_pnl || '0');
  const dailyPnlPct = totalValueUsdc > 0 ? (dailyPnl / totalValueUsdc) * 100 : 0;

  return {
    totalValueUsdc,
    availableUsdc,
    holdings,
    dailyPnl,
    dailyPnlPct,
  };
}

/**
 * Get paper balance for a specific asset
 */
export async function getPaperBalance(userId: string, asset: string): Promise<number> {
  const result = await pool.query<{ balance: string }>(
    `SELECT balance FROM paper_portfolio WHERE user_id = $1 AND asset = $2`,
    [userId, asset]
  );

  return result.rows.length > 0 ? parseFloat(result.rows[0].balance) : 0;
}

/**
 * Update paper balance for a specific asset
 */
export async function updatePaperBalance(
  userId: string,
  asset: string,
  amount: number
): Promise<void> {
  await pool.query(
    `INSERT INTO paper_portfolio (user_id, asset, balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, asset)
     DO UPDATE SET balance = $3, updated_at = NOW()`,
    [userId, asset, amount]
  );
}

/**
 * Execute a paper trade - updates balances and records trade
 */
export async function executePaperTrade(
  userId: string,
  params: {
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    source?: string;
    botId?: string;
    conditionalOrderId?: string;
    stopLoss?: number;
    takeProfit?: number;
  }
): Promise<PaperTradeRecord> {
  const { symbol, side, quantity, price, source = 'manual' } = params;

  // Extract base asset from symbol (handles BTC_USD, BTCUSDT, BTCUSDC, etc.)
  const { base } = getBaseQuote(symbol);
  if (!base) {
    throw new Error(`Cannot parse symbol: ${symbol}`);
  }
  const baseAsset = base;
  const quoteAsset = 'USDC'; // Paper trading always uses USDC

  const total = quantity * price;
  const feeRate = 0.001; // 0.1% simulated fee
  const fee = total * feeRate;

  // Start transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (side === 'buy') {
      // Check USDC balance
      const usdcBalance = await getPaperBalance(userId, quoteAsset);
      if (usdcBalance < total + fee) {
        throw new Error(
          `Insufficient paper ${quoteAsset} balance. Available: $${usdcBalance.toFixed(2)}, Required: $${(total + fee).toFixed(2)}`
        );
      }

      // Deduct USDC (including fee)
      await client.query(
        `UPDATE paper_portfolio
         SET balance = balance - $3, updated_at = NOW()
         WHERE user_id = $1 AND asset = $2`,
        [userId, quoteAsset, total + fee]
      );

      // Add base asset
      await client.query(
        `INSERT INTO paper_portfolio (user_id, asset, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, asset)
         DO UPDATE SET balance = paper_portfolio.balance + $3, updated_at = NOW()`,
        [userId, baseAsset, quantity]
      );
    } else {
      // Sell - check base asset balance
      const baseBalance = await getPaperBalance(userId, baseAsset);
      if (baseBalance < quantity) {
        throw new Error(
          `Insufficient paper ${baseAsset} balance. Available: ${baseBalance}, Required: ${quantity}`
        );
      }

      // Deduct base asset
      await client.query(
        `UPDATE paper_portfolio
         SET balance = balance - $3, updated_at = NOW()
         WHERE user_id = $1 AND asset = $2`,
        [userId, baseAsset, quantity]
      );

      // Add USDC (minus fee)
      await client.query(
        `INSERT INTO paper_portfolio (user_id, asset, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, asset)
         DO UPDATE SET balance = paper_portfolio.balance + $3, updated_at = NOW()`,
        [userId, quoteAsset, total - fee]
      );
    }

    // Record the paper trade
    const tradeResult = await client.query<{
      id: string;
      created_at: Date;
    }>(
      `INSERT INTO paper_trades (
        user_id, symbol, side, entry_price, quantity, total_usdt,
        status, source, bot_id, conditional_order_id,
        take_profit_price, stop_loss_price, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'filled', $7, $8, $9, $10, $11, NOW())
      RETURNING id, created_at`,
      [
        userId,
        symbol,
        side,
        price,
        quantity,
        total,
        source,
        params.botId || null,
        params.conditionalOrderId || null,
        params.takeProfit || null,
        params.stopLoss || null,
      ]
    );

    await client.query('COMMIT');

    logger.info('[PAPER] Trade executed', {
      userId,
      symbol,
      side,
      quantity,
      price,
      total,
      fee,
      source,
    });

    return {
      id: tradeResult.rows[0].id,
      userId,
      symbol,
      side,
      quantity,
      price,
      total,
      fee,
      source,
      createdAt: tradeResult.rows[0].created_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[PAPER] Trade failed', {
      userId,
      symbol,
      side,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reset paper portfolio to starting balance
 */
export async function resetPaperPortfolio(userId: string): Promise<void> {
  // Get current paper balance setting
  const settingsResult = await pool.query<{ paper_balance_usdc: string }>(
    `SELECT paper_balance_usdc FROM trading_settings WHERE user_id = $1`,
    [userId]
  );

  const startingBalance = settingsResult.rows.length > 0
    ? parseFloat(settingsResult.rows[0].paper_balance_usdc)
    : 10000;

  // Clear paper portfolio and trades
  await pool.query('DELETE FROM paper_portfolio WHERE user_id = $1', [userId]);
  await pool.query(
    `DELETE FROM paper_trades WHERE user_id = $1 AND source != 'scalping'`,
    [userId]
  );

  // Initialize with starting balance
  await initializePaperPortfolio(userId, startingBalance);

  logger.info('[PAPER] Portfolio reset', { userId, startingBalance });
}

/**
 * Get paper trade history
 */
export async function getPaperTrades(
  userId: string,
  limit = 50,
  source?: string
): Promise<PaperTradeRecord[]> {
  let query = `
    SELECT id, user_id, symbol, side, entry_price as price, quantity,
           total_usdt as total, source, created_at
    FROM paper_trades
    WHERE user_id = $1 AND status = 'filled'
  `;
  const params: unknown[] = [userId];

  if (source) {
    query += ` AND source = $2`;
    params.push(source);
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await pool.query<{
    id: string;
    user_id: string;
    symbol: string;
    side: string;
    price: string;
    quantity: string;
    total: string;
    source: string;
    created_at: Date;
  }>(query, params);

  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    side: row.side as 'buy' | 'sell',
    quantity: parseFloat(row.quantity),
    price: parseFloat(row.price),
    total: parseFloat(row.total),
    fee: parseFloat(row.total) * 0.001, // Approximate fee
    source: row.source,
    createdAt: row.created_at,
  }));
}

/**
 * Get current price from Binance public API
 */
export async function getCurrentPrice(symbol: string): Promise<number> {
  try {
    const ticker = await publicClient.getTickerPrice(symbol);
    if (Array.isArray(ticker)) {
      const found = ticker.find(t => t.symbol === symbol);
      if (found) {
        return parseFloat(found.price);
      }
      throw new Error(`Symbol ${symbol} not found in ticker response`);
    }
    return parseFloat(ticker.price);
  } catch (error) {
    logger.error('[PAPER] Failed to get price', { symbol, error });
    throw new Error(`Failed to get price for ${symbol}`);
  }
}
