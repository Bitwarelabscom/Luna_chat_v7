'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { tradingApi, type Kline } from '@/lib/api';

interface PriceChartProps {
  symbol: string;
}

const INTERVALS = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
];

export default function PriceChart({ symbol }: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [interval, setInterval] = useState('1h');
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredCandle, setHoveredCandle] = useState<Kline | null>(null);

  const loadKlines = useCallback(async () => {
    try {
      setLoading(true);
      const data = await tradingApi.getKlines(symbol, interval, 100);
      setKlines(data);
    } catch (error) {
      console.error('Failed to load klines', error);
    } finally {
      setLoading(false);
    }
  }, [symbol, interval]);

  useEffect(() => {
    loadKlines();
    // Refresh every 30 seconds
    const timer = window.setInterval(loadKlines, 30000);
    return () => window.clearInterval(timer);
  }, [loadKlines]);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || klines.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 60, bottom: 30, left: 10 };

    // Clear canvas
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, width, height);

    // Calculate price range
    const prices = klines.flatMap(k => [parseFloat(k.high), parseFloat(k.low)]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;
    const pricePadding = priceRange * 0.1;

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const candleWidth = Math.max(1, (chartWidth / klines.length) * 0.8);
    const candleSpacing = chartWidth / klines.length;

    // Scale helpers
    const scaleY = (price: number) => {
      return padding.top + chartHeight - ((price - (minPrice - pricePadding)) / (priceRange + 2 * pricePadding)) * chartHeight;
    };

    const scaleX = (index: number) => {
      return padding.left + index * candleSpacing + candleSpacing / 2;
    };

    // Draw grid lines
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartHeight / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Price labels
      const price = maxPrice + pricePadding - ((i / gridLines) * (priceRange + 2 * pricePadding));
      ctx.fillStyle = '#607080';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(price.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 6 : 2 }), width - padding.right + 5, y + 3);
    }

    // Draw candles
    klines.forEach((kline, i) => {
      const open = parseFloat(kline.open);
      const close = parseFloat(kline.close);
      const high = parseFloat(kline.high);
      const low = parseFloat(kline.low);
      const x = scaleX(i);
      const isGreen = close >= open;

      // Wick
      ctx.strokeStyle = isGreen ? '#10b981' : '#ef4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, scaleY(high));
      ctx.lineTo(x, scaleY(low));
      ctx.stroke();

      // Body
      ctx.fillStyle = isGreen ? '#10b981' : '#ef4444';
      const bodyTop = scaleY(Math.max(open, close));
      const bodyBottom = scaleY(Math.min(open, close));
      const bodyHeight = Math.max(1, bodyBottom - bodyTop);
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
    });

    // Draw current price line
    if (klines.length > 0) {
      const lastPrice = parseFloat(klines[klines.length - 1].close);
      const y = scaleY(lastPrice);
      ctx.strokeStyle = '#00ff9f';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price label
      ctx.fillStyle = '#00ff9f';
      ctx.fillRect(width - padding.right, y - 8, padding.right, 16);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(lastPrice.toLocaleString(undefined, { maximumFractionDigits: lastPrice < 1 ? 6 : 2 }), width - padding.right + 3, y + 3);
    }

    // Mouse move handler for hover info
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const index = Math.floor((x - padding.left) / candleSpacing);
      if (index >= 0 && index < klines.length) {
        setHoveredCandle(klines[index]);
      } else {
        setHoveredCandle(null);
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    return () => canvas.removeEventListener('mousemove', handleMouseMove);
  }, [klines]);

  const lastKline = klines[klines.length - 1];
  const lastPrice = lastKline ? parseFloat(lastKline.close) : 0;
  const firstPrice = klines[0] ? parseFloat(klines[0].open) : 0;
  const priceChange = lastPrice - firstPrice;
  const priceChangePct = firstPrice ? (priceChange / firstPrice) * 100 : 0;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#111827',
      border: '1px solid #2a3545',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid #2a3545',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>{symbol}</span>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '15px',
            fontWeight: 600,
            color: '#fff',
          }}>
            ${lastPrice.toLocaleString(undefined, { minimumFractionDigits: lastPrice < 1 ? 4 : 2, maximumFractionDigits: lastPrice < 1 ? 6 : 2 })}
          </span>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '12px',
            color: priceChange >= 0 ? '#10b981' : '#ef4444',
          }}>
            {priceChange >= 0 ? '+' : ''}{priceChangePct.toFixed(2)}%
          </span>
        </div>

        {/* Interval selector */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {INTERVALS.map((int) => (
            <button
              key={int.value}
              onClick={() => setInterval(int.value)}
              style={{
                padding: '4px 10px',
                background: interval === int.value ? '#00ff9f20' : 'transparent',
                border: interval === int.value ? '1px solid #00ff9f' : '1px solid transparent',
                borderRadius: '4px',
                color: interval === int.value ? '#00ff9f' : '#607080',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {int.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative' }}>
        {loading && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#607080',
            fontSize: '13px',
          }}>
            Loading chart...
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />

        {/* Hover info */}
        {hoveredCandle && (
          <div style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: 'rgba(17, 24, 39, 0.9)',
            border: '1px solid #2a3545',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            <div style={{ color: '#607080', marginBottom: '4px' }}>
              {new Date(hoveredCandle.openTime).toLocaleString('sv-SE')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 12px' }}>
              <span style={{ color: '#607080' }}>O:</span>
              <span style={{ color: '#fff' }}>{parseFloat(hoveredCandle.open).toLocaleString()}</span>
              <span style={{ color: '#607080' }}>H:</span>
              <span style={{ color: '#10b981' }}>{parseFloat(hoveredCandle.high).toLocaleString()}</span>
              <span style={{ color: '#607080' }}>L:</span>
              <span style={{ color: '#ef4444' }}>{parseFloat(hoveredCandle.low).toLocaleString()}</span>
              <span style={{ color: '#607080' }}>C:</span>
              <span style={{ color: '#fff' }}>{parseFloat(hoveredCandle.close).toLocaleString()}</span>
              <span style={{ color: '#607080' }}>V:</span>
              <span style={{ color: '#fff' }}>{parseFloat(hoveredCandle.volume).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
