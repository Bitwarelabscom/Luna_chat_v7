// Symbol format conversion utilities for multi-exchange support
// Binance: BTCUSDT (no separator)
// Crypto.com: BTC_USDT (underscore separator)

import type { ExchangeType } from './exchange.interface.js';

// Common quote currencies to help parse symbols
const QUOTE_CURRENCIES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'BNB', 'BUSD', 'EUR', 'GBP'];

/**
 * Convert symbol to Binance format (no separator)
 * BTC_USDT -> BTCUSDT
 * BTC/USDT -> BTCUSDT
 * BTCUSDT -> BTCUSDT (already correct)
 */
export function toBinanceSymbol(symbol: string): string {
  return symbol.replace(/[_/\-]/g, '').toUpperCase();
}

/**
 * Convert symbol to Crypto.com format (underscore separator)
 * BTCUSDT -> BTC_USDT
 * BTC/USDT -> BTC_USDT
 * BTC_USDT -> BTC_USDT (already correct)
 */
export function toCryptoComSymbol(symbol: string): string {
  // If already has underscore, normalize and return
  if (symbol.includes('_')) {
    return symbol.toUpperCase();
  }

  // If has other separators, replace with underscore
  if (symbol.includes('/') || symbol.includes('-')) {
    return symbol.replace(/[/\-]/g, '_').toUpperCase();
  }

  // No separator - need to parse base and quote
  const { base, quote } = getBaseQuote(symbol);
  if (base && quote) {
    return `${base}_${quote}`;
  }

  // Fallback - return as-is uppercase
  return symbol.toUpperCase();
}

/**
 * Normalize symbol to Crypto.com format
 */
export function normalizeSymbol(symbol: string, _exchange?: ExchangeType): string {
  return toCryptoComSymbol(symbol);
}

/**
 * Parse symbol into base and quote currencies
 */
export function getBaseQuote(symbol: string): { base: string; quote: string } {
  const normalized = symbol.toUpperCase();

  // Check for separator
  if (normalized.includes('_')) {
    const [base, quote] = normalized.split('_');
    return { base, quote };
  }
  if (normalized.includes('/')) {
    const [base, quote] = normalized.split('/');
    return { base, quote };
  }
  if (normalized.includes('-')) {
    const [base, quote] = normalized.split('-');
    return { base, quote };
  }

  // No separator - find quote currency
  for (const quote of QUOTE_CURRENCIES) {
    if (normalized.endsWith(quote)) {
      const base = normalized.slice(0, -quote.length);
      if (base.length > 0) {
        return { base, quote };
      }
    }
  }

  // Could not parse - return empty
  return { base: '', quote: '' };
}

/**
 * Convert an internal/canonical symbol to exchange-specific format
 * Internal format uses underscore separator (like Crypto.com)
 */
export function toExchangeSymbol(internalSymbol: string, exchange: ExchangeType): string {
  return normalizeSymbol(internalSymbol, exchange);
}

/**
 * Convert an exchange-specific symbol to internal/canonical format
 * Internal format uses underscore separator
 */
export function toInternalSymbol(exchangeSymbol: string, _exchange: ExchangeType): string {
  // Convert any format to underscore-separated internal format
  return toCryptoComSymbol(exchangeSymbol);
}

/**
 * Check if two symbols are equivalent (same trading pair)
 * Handles USD/USDT/USDC equivalence for cross-exchange compatibility
 */
export function symbolsEqual(symbol1: string, symbol2: string): boolean {
  // First normalize to Binance format (removes separators)
  let normalized1 = toBinanceSymbol(symbol1);
  let normalized2 = toBinanceSymbol(symbol2);

  // Normalize USD variants to USDT for comparison
  // This handles Crypto.com (USD) vs Binance (USDT/USDC)
  const normalizeQuote = (s: string): string => {
    if (s.endsWith('USD') && !s.endsWith('USDT') && !s.endsWith('USDC') && !s.endsWith('BUSD')) {
      return s + 'T'; // USD -> USDT
    }
    if (s.endsWith('USDC')) {
      return s.slice(0, -4) + 'USDT'; // USDC -> USDT
    }
    return s;
  };

  normalized1 = normalizeQuote(normalized1);
  normalized2 = normalizeQuote(normalized2);

  return normalized1 === normalized2;
}

/**
 * Get a display-friendly version of a symbol
 */
export function formatSymbolForDisplay(symbol: string): string {
  const { base, quote } = getBaseQuote(symbol);
  if (base && quote) {
    return `${base}/${quote}`;
  }
  return symbol.toUpperCase();
}

/**
 * Validate that a symbol has correct format
 */
export function isValidSymbol(symbol: string): boolean {
  const { base, quote } = getBaseQuote(symbol);
  return base.length > 0 && quote.length > 0;
}

/**
 * Get common trading pairs across exchanges
 */
export function getCommonTradingPairs(): string[] {
  return [
    'BTC_USDT',
    'ETH_USDT',
    'SOL_USDT',
    'XRP_USDT',
    'ADA_USDT',
    'DOGE_USDT',
    'AVAX_USDT',
    'DOT_USDT',
    'MATIC_USDT',
    'LINK_USDT',
    'BNB_USDT',
    'ATOM_USDT',
    'UNI_USDT',
    'LTC_USDT',
  ];
}

/**
 * Get default quote currency for an exchange
 * Crypto.com uses USD, Binance uses USDC
 */
export function getDefaultQuoteCurrency(exchange: ExchangeType): string {
  return exchange === 'crypto_com' ? 'USD' : 'USDC';
}

/**
 * Top 45 base currencies available on Crypto.com
 * Removed: TRX, MATIC, MKR, FTM, EOS (not on Crypto.com)
 */
const TOP_50_BASES = [
  'BTC', 'ETH', 'SOL', 'XRP', 'DOGE',
  'ADA', 'AVAX', 'SHIB', 'DOT', 'LINK',
  'LTC', 'BCH', 'ATOM', 'UNI', 'XLM',
  'ETC', 'NEAR', 'APT', 'FIL', 'ARB',
  'OP', 'INJ', 'SUI', 'LDO', 'IMX',
  'RUNE', 'SEI', 'TIA', 'AAVE', 'GRT',
  'ALGO', 'SAND', 'MANA', 'AXS', 'THETA',
  'EGLD', 'FLOW', 'XTZ', 'SNX', 'CHZ',
  'GALA', 'APE', 'CRV', 'DYDX', 'BONK',
];

/**
 * Get default trading pairs for an exchange with correct quote currency
 */
export function getDefaultTradingPairs(exchange: ExchangeType): string[] {
  const quote = getDefaultQuoteCurrency(exchange);

  if (exchange === 'crypto_com') {
    return TOP_50_BASES.map((b) => `${b}_${quote}`);
  }
  return TOP_50_BASES.map((b) => `${b}${quote}`);
}

/**
 * Build a symbol with the correct quote currency for an exchange
 */
export function buildSymbolForExchange(base: string, exchange: ExchangeType): string {
  const quote = getDefaultQuoteCurrency(exchange);
  // Normalize base - remove any existing quote currency
  let normalizedBase = base.toUpperCase();
  for (const q of QUOTE_CURRENCIES) {
    if (normalizedBase.endsWith(q)) {
      normalizedBase = normalizedBase.slice(0, -q.length);
      break;
    }
  }
  // Handle underscore format
  if (normalizedBase.includes('_')) {
    normalizedBase = normalizedBase.split('_')[0];
  }

  if (exchange === 'crypto_com') {
    return `${normalizedBase}_${quote}`;
  }
  return `${normalizedBase}${quote}`;
}
