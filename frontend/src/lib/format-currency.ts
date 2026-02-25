import { useLocaleStore, CURRENCIES } from './locale-store';

export function formatMoney(value: number): string {
  const currency = useLocaleStore.getState().currency;
  const curr = CURRENCIES.find(c => c.code === currency);
  const symbol = curr?.symbol || currency;
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : value > 0 ? '+' : '';
  const formatted = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  if (['kr', 'CHF'].includes(symbol)) {
    return `${prefix}${formatted} ${symbol}`;
  }
  return `${prefix}${symbol}${formatted}`;
}

export function formatMoneyPrecise(value: number): string {
  const currency = useLocaleStore.getState().currency;
  const curr = CURRENCIES.find(c => c.code === currency);
  const symbol = curr?.symbol || currency;
  if (['kr', 'CHF'].includes(symbol)) {
    return `${value.toFixed(2)} ${symbol}`;
  }
  return `${symbol}${value.toFixed(2)}`;
}

export function formatMoneyPlain(value: number): string {
  const currency = useLocaleStore.getState().currency;
  const curr = CURRENCIES.find(c => c.code === currency);
  const symbol = curr?.symbol || currency;
  if (['kr', 'CHF'].includes(symbol)) {
    return `${value.toFixed(0)} ${symbol}`;
  }
  return `${symbol}${value.toFixed(0)}`;
}
