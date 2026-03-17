/**
 * Trading Reports Service
 *
 * Generates formatted plain-text Telegram summary reports for trading activity.
 * Covers daily summaries, weekly summaries, and periodic P/L updates.
 */

import { pool } from '../db/index.js';
import redis from '../db/redis.js';
import logger from '../utils/logger.js';
import * as tradingService from './trading.service.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Formats a USD value with sign prefix and 2 decimal places.
 * e.g.  123.4 -> "+$123.40"  |  -5.0 -> "-$5.00"  |  0 -> "+$0.00"
 */
export function formatUsd(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Daily Summary
// ---------------------------------------------------------------------------

/**
 * Generates a daily trading summary formatted for Telegram (plain text).
 * Includes: trades today, realized P/L, win/loss counts, best/worst trade,
 * net result, and current portfolio value.
 */
export async function generateDailySummary(userId: string): Promise<string> {
  try {
    // Trades closed today (have a pnl value and closed_at today)
    const tradesResult = await pool.query(
      `SELECT id, symbol, side, quantity, filled_price, pnl, closed_at, created_at
       FROM trades
       WHERE user_id = $1
         AND created_at >= CURRENT_DATE
       ORDER BY created_at DESC`,
      [userId]
    );

    const trades = tradesResult.rows as Array<{
      id: string;
      symbol: string;
      side: string;
      quantity: number;
      filled_price: number | null;
      pnl: number | null;
      closed_at: Date | null;
      created_at: Date;
    }>;

    // Only closed trades have realized P/L
    const closedTrades = trades.filter(t => t.closed_at !== null && t.pnl !== null);

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl ?? 0) <= 0);

    const bestTrade = closedTrades.reduce<typeof closedTrades[0] | null>((best, t) => {
      if (!best) return t;
      return (t.pnl ?? 0) > (best.pnl ?? 0) ? t : best;
    }, null);

    const worstTrade = closedTrades.reduce<typeof closedTrades[0] | null>((worst, t) => {
      if (!worst) return t;
      return (t.pnl ?? 0) < (worst.pnl ?? 0) ? t : worst;
    }, null);

    // Portfolio value
    const portfolio = await tradingService.getPortfolio(userId);
    const portfolioValue = portfolio?.totalValueUsdt ?? 0;

    const lines: string[] = [
      '---- Daily Trading Summary ----',
      `Date: ${new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}`,
      '',
      `Trades today: ${trades.length}  (closed: ${closedTrades.length})`,
      `Wins: ${wins.length}  |  Losses: ${losses.length}`,
      '',
      `Realized P/L today: ${formatUsd(totalPnl)}`,
    ];

    if (bestTrade) {
      lines.push(`-> Best trade: ${bestTrade.symbol} ${bestTrade.side.toUpperCase()} ${formatUsd(bestTrade.pnl ?? 0)}`);
    }
    if (worstTrade && worstTrade.id !== bestTrade?.id) {
      lines.push(`-> Worst trade: ${worstTrade.symbol} ${worstTrade.side.toUpperCase()} ${formatUsd(worstTrade.pnl ?? 0)}`);
    }

    lines.push('');
    lines.push(`Net result: ${totalPnl >= 0 ? 'Profitable day' : 'Losing day'} (${formatUsd(totalPnl)})`);
    lines.push('');
    lines.push(`Portfolio value: $${portfolioValue.toFixed(2)}`);

    if (portfolio?.dailyPnl !== undefined) {
      lines.push(`Daily P/L (portfolio): ${formatUsd(portfolio.dailyPnl)} (${portfolio.dailyPnlPct?.toFixed(2) ?? '0.00'}%)`);
    }

    lines.push('--------------------------------');

    return lines.join('\n');
  } catch (error) {
    logger.error('Failed to generate daily trading summary', {
      userId,
      error: (error as Error).message,
    });
    return 'Error generating daily trading report. Please try again later.';
  }
}

// ---------------------------------------------------------------------------
// Weekly Summary
// ---------------------------------------------------------------------------

/**
 * Generates a 7-day trading summary formatted for Telegram (plain text).
 * Includes: 7-day return vs snapshot, trade count, win rate, top/bottom 3 trades.
 */
export async function generateWeeklySummary(userId: string): Promise<string> {
  try {
    // Snapshot from 7 days ago
    const snapshotResult = await pool.query(
      `SELECT total_value_usdt
       FROM portfolio_snapshots
       WHERE user_id = $1
         AND created_at <= NOW() - INTERVAL '7 days'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    const snapshotValue: number | null = snapshotResult.rows[0]?.total_value_usdt ?? null;

    // All closed trades in the last 7 days
    const tradesResult = await pool.query(
      `SELECT id, symbol, side, quantity, filled_price, pnl, closed_at
       FROM trades
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY pnl DESC NULLS LAST`,
      [userId]
    );

    const trades = tradesResult.rows as Array<{
      id: string;
      symbol: string;
      side: string;
      quantity: number;
      filled_price: number | null;
      pnl: number | null;
      closed_at: Date | null;
    }>;

    const closedTrades = trades.filter(t => t.closed_at !== null && t.pnl !== null);
    const totalTradeCount = trades.length;
    const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0);
    const winRate = closedTrades.length > 0
      ? ((wins.length / closedTrades.length) * 100).toFixed(1)
      : '0.0';

    // Top 3 winners (already sorted DESC)
    const topWinners = closedTrades.filter(t => (t.pnl ?? 0) > 0).slice(0, 3);
    // Top 3 losers (sort ASC)
    const topLosers = [...closedTrades]
      .filter(t => (t.pnl ?? 0) < 0)
      .sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0))
      .slice(0, 3);

    // Current portfolio
    const portfolio = await tradingService.getPortfolio(userId);
    const currentValue = portfolio?.totalValueUsdt ?? 0;

    const lines: string[] = [
      '---- Weekly Trading Summary ----',
      `Period: last 7 days`,
      '',
    ];

    // 7-day return
    if (snapshotValue && snapshotValue > 0) {
      const weeklyReturn = currentValue - snapshotValue;
      const weeklyReturnPct = ((weeklyReturn / snapshotValue) * 100).toFixed(2);
      lines.push(`7-day return: ${formatUsd(weeklyReturn)} (${weeklyReturn >= 0 ? '+' : ''}${weeklyReturnPct}%)`);
      lines.push(`Value: $${snapshotValue.toFixed(2)} -> $${currentValue.toFixed(2)}`);
    } else {
      lines.push(`Current portfolio value: $${currentValue.toFixed(2)}`);
      lines.push('(No 7-day snapshot available for comparison)');
    }

    lines.push('');
    lines.push(`Total trades: ${totalTradeCount}  |  Closed: ${closedTrades.length}`);
    lines.push(`Win rate: ${winRate}%  (${wins.length}W / ${closedTrades.length - wins.length}L)`);

    if (topWinners.length > 0) {
      lines.push('');
      lines.push('Top winners:');
      topWinners.forEach((t, i) => {
        lines.push(`  ${i + 1}. ${t.symbol} ${t.side.toUpperCase()} -- ${formatUsd(t.pnl ?? 0)}`);
      });
    }

    if (topLosers.length > 0) {
      lines.push('');
      lines.push('Top losers:');
      topLosers.forEach((t, i) => {
        lines.push(`  ${i + 1}. ${t.symbol} ${t.side.toUpperCase()} -- ${formatUsd(t.pnl ?? 0)}`);
      });
    }

    lines.push('--------------------------------');

    return lines.join('\n');
  } catch (error) {
    logger.error('Failed to generate weekly trading summary', {
      userId,
      error: (error as Error).message,
    });
    return 'Error generating weekly trading report. Please try again later.';
  }
}

// ---------------------------------------------------------------------------
// Periodic P/L Update
// ---------------------------------------------------------------------------

/**
 * Generates a periodic unrealized P/L update formatted for Telegram (plain text).
 * Looks up current prices from Redis and calculates unrealized P/L per open position.
 */
export async function generatePeriodicPnlUpdate(userId: string): Promise<string> {
  try {
    // Open positions: filled trades that have not been closed
    const openResult = await pool.query(
      `SELECT id, symbol, side, quantity, filled_price
       FROM trades
       WHERE user_id = $1
         AND closed_at IS NULL
         AND status = 'filled'
       ORDER BY symbol ASC`,
      [userId]
    );

    const openTrades = openResult.rows as Array<{
      id: string;
      symbol: string;
      side: string;
      quantity: number;
      filled_price: number | null;
    }>;

    // Portfolio for total value and daily P/L
    const portfolio = await tradingService.getPortfolio(userId);
    const totalValue = portfolio?.totalValueUsdt ?? 0;
    const dailyPnl = portfolio?.dailyPnl ?? 0;
    const dailyPnlPct = portfolio?.dailyPnlPct ?? 0;

    const lines: string[] = [
      '---- Portfolio P/L Update ----',
      `${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
      '',
      `Total portfolio value: $${totalValue.toFixed(2)}`,
      `Daily P/L: ${formatUsd(dailyPnl)} (${dailyPnl >= 0 ? '+' : ''}${dailyPnlPct.toFixed(2)}%)`,
    ];

    if (openTrades.length === 0) {
      lines.push('');
      lines.push('No open positions.');
      lines.push('--------------------------------');
      return lines.join('\n');
    }

    lines.push('');
    lines.push(`Open positions: ${openTrades.length}`);

    let totalUnrealized = 0;

    for (const trade of openTrades) {
      const entryPrice = trade.filled_price;
      if (!entryPrice || entryPrice <= 0) {
        lines.push(`  * ${trade.symbol} ${trade.side.toUpperCase()} -- (no entry price)`);
        continue;
      }

      // Extract base symbol for Redis key (e.g. "BTC_USD" -> "BTC", "BTCUSDT" -> "BTC")
      const baseSymbol = trade.symbol
        .replace(/[_-]?(USDT|USDC|USD|BTC|ETH)$/i, '')
        .toUpperCase();
      const redisKey = `trading:price:${baseSymbol}`;

      let currentPrice: number | null = null;
      try {
        const priceStr = await redis.get(redisKey);
        if (priceStr) {
          currentPrice = parseFloat(priceStr);
        }
      } catch (redisErr) {
        logger.warn('Failed to fetch price from Redis', {
          symbol: trade.symbol,
          key: redisKey,
          error: (redisErr as Error).message,
        });
      }

      if (currentPrice === null || isNaN(currentPrice)) {
        lines.push(`  * ${trade.symbol} ${trade.side.toUpperCase()} -- (price unavailable)`);
        continue;
      }

      // Unrealized P/L: for buy positions, gain when price rises
      // For sell positions (short), gain when price falls
      let unrealized: number;
      if (trade.side === 'buy') {
        unrealized = (currentPrice - entryPrice) * trade.quantity;
      } else {
        unrealized = (entryPrice - currentPrice) * trade.quantity;
      }

      totalUnrealized += unrealized;

      const arrow = unrealized >= 0 ? '->' : '<-';
      lines.push(
        `  ${arrow} ${trade.symbol} ${trade.side.toUpperCase()} x${trade.quantity}` +
        ` | entry $${entryPrice.toFixed(4)} | now $${currentPrice.toFixed(4)}` +
        ` | ${formatUsd(unrealized)}`
      );
    }

    lines.push('');
    lines.push(`Total unrealized P/L: ${formatUsd(totalUnrealized)}`);
    lines.push('--------------------------------');

    return lines.join('\n');
  } catch (error) {
    logger.error('Failed to generate periodic P/L update', {
      userId,
      error: (error as Error).message,
    });
    return 'Error generating P/L update. Please try again later.';
  }
}
