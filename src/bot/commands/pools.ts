/**
 * /pools command handler - Browse LP pools by category
 *
 * Categories:
 * - Trending: sorted by 24h volume (highest activity)
 * - High TVL: sorted by total value locked
 * - xStocks: liquid staking / restaking token pairs
 * - Paste CA: look up any pool by contract address
 */
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types.js';
import { poolSelectionKeyboard } from '../keyboards.js';
import { setPendingPoolAddress } from '../types.js';

export interface PoolInfo {
  name: string;
  address: string;
  apr: number;
  tvl: number;
  volume24h: number;
  binStep: number;
}

export type PoolCategory = 'trending' | 'hightvl' | 'xstocks';

function formatTvl(tvl: number): string {
  if (tvl >= 1_000_000) return `$${(tvl / 1_000_000).toFixed(1)}M`;
  if (tvl >= 1_000) return `$${(tvl / 1_000).toFixed(0)}K`;
  return `$${tvl.toFixed(0)}`;
}

function formatVol(vol: number): string {
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
  return `$${vol.toFixed(0)}`;
}

/**
 * Show category selector when /pools is invoked
 */
export async function poolsCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const kb = new InlineKeyboard()
    .text('Trending', 'pools:trending')
    .text('High TVL', 'pools:hightvl')
    .row()
    .text('xStocks', 'pools:xstocks')
    .text('Paste CA', 'pools:ca')
    .row()
    .text('All (Top APR)', 'pools:all');

  await ctx.reply('*Browse LP Pools*\n\nSelect a category:', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

/**
 * Display pools for a specific category (called from callback handler)
 */
export async function showPoolCategory(ctx: BotContext, category: PoolCategory | 'all') {
  const titles: Record<string, string> = {
    trending: 'Trending Pools (by 24h Volume)',
    hightvl: 'High TVL Pools',
    xstocks: 'xStocks / Liquid Staking Pools',
    all: 'Top Pools (by APR)',
  };

  try {
    const pools = await fetchPoolsByCategory(category);

    if (pools.length === 0) {
      await ctx.reply(`No ${titles[category] || ''} found. Try another category.`);
      return;
    }

    const poolLines = pools
      .map((p, i) => {
        const vol = p.volume24h > 0 ? ` | Vol: ${formatVol(p.volume24h)}` : '';
        return `${i + 1}. *${p.name}* (bin ${p.binStep})\n   APR: ${p.apr.toFixed(1)}% | TVL: ${formatTvl(p.tvl)}${vol}`;
      })
      .join('\n\n');

    const text = [
      `*${titles[category]}*`,
      ``,
      poolLines,
      ``,
      `Tap a pool to add liquidity.`,
    ].join('\n');

    const keyboardPools = pools.map((p) => ({
      address: p.address,
      name: p.name,
      apy: p.apr,
    }));

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: poolSelectionKeyboard(keyboardPools),
    });
  } catch (error: any) {
    console.error(`[Bot] /pools ${category} error:`, error);
    await ctx.reply('Failed to fetch pools. Please try again.');
  }
}

/**
 * Look up a single pool by contract address
 */
export async function lookupPoolByAddress(ctx: BotContext, address: string) {
  try {
    const resp = await fetch(`https://dlmm-api.meteora.ag/pair/${address}`);
    if (!resp.ok) {
      await ctx.reply(`Pool not found for address \`${address.slice(0, 12)}...\`\n\nMake sure it's a valid Meteora DLMM pool address.`);
      return;
    }

    const p = (await resp.json()) as any;
    const pool: PoolInfo = {
      name: p.name || 'Unknown',
      address: p.address,
      apr: parseFloat(p.apr || '0') * 100,
      tvl: parseFloat(p.liquidity || '0'),
      volume24h: parseFloat(p.trade_volume_24h || '0'),
      binStep: parseInt(p.bin_step || '10'),
    };

    const vol = pool.volume24h > 0 ? `\nVolume 24h: ${formatVol(pool.volume24h)}` : '';
    const text = [
      `*${pool.name}*`,
      ``,
      `APR: ${pool.apr.toFixed(1)}%`,
      `TVL: ${formatTvl(pool.tvl)}${vol}`,
      `Bin Step: ${pool.binStep}`,
      `Address: \`${pool.address}\``,
      ``,
      `Tap below to add liquidity.`,
    ].join('\n');

    const kb = new InlineKeyboard()
      .text(`Add LP to ${pool.name}`, `lp:pool:ca`)
      .row()
      .text('Back to Categories', 'cmd:pools');

    // Store the address for the LP wizard to pick up
    const chatId = ctx.chat?.id;
    if (chatId) {
      setPendingPoolAddress(chatId, pool.address);
    }

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  } catch (error: any) {
    console.error('[Bot] Pool lookup error:', error);
    await ctx.reply('Failed to look up pool. Please check the address and try again.');
  }
}

// ============ Pool fetching by category ============

const XSTOCKS_TOKENS = new Set([
  'mSOL', 'bSOL', 'jSOL', 'jitoSOL', 'lfSOL', 'hSOL', 'cgntSOL',
  'INF', 'jupSOL', 'vSOL', 'stSOL', 'scnSOL', 'dSOL', 'laineSOL',
  'edgeSOL', 'compassSOL', 'LST', 'JitoSOL',
]);

let _poolCache: { data: any[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

async function fetchAllPools(): Promise<any[]> {
  if (_poolCache && Date.now() - _poolCache.fetchedAt < CACHE_TTL_MS) {
    return _poolCache.data;
  }

  const resp = await fetch('https://dlmm-api.meteora.ag/pair/all');
  if (!resp.ok) throw new Error('Meteora API failed');

  const data = (await resp.json()) as any[];
  _poolCache = { data, fetchedAt: Date.now() };
  return data;
}

async function fetchPoolsByCategory(category: PoolCategory | 'all'): Promise<PoolInfo[]> {
  const allPools = await fetchAllPools();

  // Base filter: not blacklisted, not hidden
  const valid = allPools.filter(
    (p) => !p.is_blacklisted && !p.hide && p.liquidity && parseFloat(p.liquidity) > 0,
  );

  let filtered: any[];
  let sorted: any[];

  switch (category) {
    case 'trending':
      // Sort by 24h volume, minimum $10K TVL to avoid dust pools
      filtered = valid.filter((p) => parseFloat(p.liquidity) > 10_000);
      sorted = filtered
        .sort((a, b) => parseFloat(b.trade_volume_24h || '0') - parseFloat(a.trade_volume_24h || '0'))
        .slice(0, 8);
      break;

    case 'hightvl':
      sorted = valid
        .sort((a, b) => parseFloat(b.liquidity) - parseFloat(a.liquidity))
        .slice(0, 8);
      break;

    case 'xstocks':
      filtered = valid.filter((p) => {
        const parts = (p.name || '').split('-');
        return parts.some((t: string) => XSTOCKS_TOKENS.has(t));
      });
      sorted = filtered
        .sort((a: any, b: any) => parseFloat(b.liquidity) - parseFloat(a.liquidity))
        .slice(0, 8);
      break;

    case 'all':
    default:
      // Original behavior: high TVL, popular tokens, sorted by APR
      filtered = valid.filter((p) => parseFloat(p.liquidity) > 100_000);
      sorted = filtered
        .sort((a: any, b: any) => (b.apr || 0) - (a.apr || 0))
        .slice(0, 8);
      break;
  }

  return sorted.map((p: any) => ({
    name: p.name || 'Unknown',
    address: p.address,
    apr: parseFloat(p.apr || '0') * 100,
    tvl: parseFloat(p.liquidity || '0'),
    volume24h: parseFloat(p.trade_volume_24h || '0'),
    binStep: parseInt(p.bin_step || '10'),
  }));
}
