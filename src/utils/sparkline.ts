/**
 * Text-based Sparkline Generator
 * 
 * Creates Unicode sparkline charts for terminal/chat display.
 * Uses block characters: ▁▂▃▄▅▆▇█
 */

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Generate a sparkline from an array of values
 * @param values - Array of numeric values
 * @param width - Optional width (defaults to values.length, max 20)
 * @returns Unicode sparkline string
 */
export function sparkline(values: number[], width?: number): string {
  if (values.length === 0) return '';
  if (values.length === 1) return BLOCKS[4]; // Middle height for single value
  
  // Sample down if too many values
  const targetWidth = Math.min(width || values.length, 20);
  const sampled = sampleValues(values, targetWidth);
  
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  
  return sampled
    .map(v => {
      const normalized = (v - min) / range;
      const index = Math.min(Math.floor(normalized * BLOCKS.length), BLOCKS.length - 1);
      return BLOCKS[index];
    })
    .join('');
}

/**
 * Sample values to fit target width
 */
function sampleValues(values: number[], targetWidth: number): number[] {
  if (values.length <= targetWidth) return values;
  
  const result: number[] = [];
  const step = values.length / targetWidth;
  
  for (let i = 0; i < targetWidth; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    // Average the values in this bucket
    const bucket = values.slice(start, end);
    const avg = bucket.reduce((a, b) => a + b, 0) / bucket.length;
    result.push(avg);
  }
  
  return result;
}

/**
 * Format PnL with color emoji
 * @param pnl - Profit/loss amount
 * @param pnlPercent - Profit/loss percentage
 * @returns Formatted string with emoji
 */
export function formatPnL(pnl: number, pnlPercent: number): string {
  const emoji = pnl >= 0 ? '📈' : '📉';
  const sign = pnl >= 0 ? '+' : '';
  return `${emoji} ${sign}$${Math.abs(pnl).toFixed(2)} (${sign}${pnlPercent.toFixed(1)}%)`;
}

/**
 * Create a price trend indicator
 * @param prices - Array of historical prices (oldest to newest)
 * @returns Trend indicator string
 */
export function priceTrend(prices: number[]): string {
  if (prices.length < 2) return '➡️';
  
  const first = prices[0];
  const last = prices[prices.length - 1];
  const change = ((last - first) / first) * 100;
  
  if (change > 5) return '📈';
  if (change > 1) return '↗️';
  if (change < -5) return '📉';
  if (change < -1) return '↘️';
  return '➡️';
}

/**
 * Generate a mini chart with trend and values
 * @param values - Array of values (oldest to newest)
 * @param label - Optional label
 * @returns Formatted chart line
 */
export function miniChart(values: number[], label?: string): string {
  if (values.length === 0) return label ? `${label}: No data` : 'No data';
  
  const chart = sparkline(values, 12);
  const trend = priceTrend(values);
  const current = values[values.length - 1];
  
  const parts = [chart, trend, `$${current.toFixed(2)}`];
  if (label) parts.unshift(label + ':');
  
  return parts.join(' ');
}
