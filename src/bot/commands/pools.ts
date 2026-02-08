/**
 * /pools command handler - Browse LP pools by category
 *
 * Categories:
 * - Trending: sorted by 24h volume (highest activity)
 * - High TVL: sorted by total value locked
 * - LSTs: liquid staking token pairs (mSOL, jitoSOL, etc.)
 * - xStocks: tokenized equities from xstocks.fi (AAPLx, TSLAx, etc.)
 * - Paste CA: look up any pool by contract address
 */
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types.js';
import { poolSelectionKeyboard } from '../keyboards.js';
import { setPendingPoolAddress, setDisplayedPools } from '../types.js';

export interface PoolInfo {
  name: string;
  address: string;
  apr: number;
  tvl: number;
  volume24h: number;
  binStep: number;
}

export type PoolCategory = 'trending' | 'hightvl' | 'lst' | 'xstocks';

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
    .text('🏆 Best Yields', 'pools:best')  // New: unified view
    .row()
    .text('Trending', 'pools:trending')
    .text('High TVL', 'pools:hightvl')
    .row()
    .text('LSTs', 'pools:lst')
    .text('xStocks', 'pools:xstocks')
    .row()
    .text('Meteora', 'pools:all')
    .text('Orca', 'pools:orca')
    .row()
    .text('Paste CA', 'pools:ca');

  await ctx.reply('*Browse LP Pools*\n\nTap *Best Yields* for top pools across all DEXes, or pick a category:', {
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
    lst: 'Liquid Staking Token Pools',
    xstocks: 'xStocks - Tokenized Equities',
    all: 'Top Pools (by APR)',
  };

  try {
    const pools = await fetchPoolsByCategory(category);

    if (pools.length === 0) {
      const hint = category === 'xstocks'
        ? '\n\nxStocks pools may not be listed on Meteora DLMM yet. Try Paste CA with a specific pool address.'
        : '';
      await ctx.reply(`No ${titles[category] || 'pools'} found.${hint}\n\nTry another category.`);
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
      dex: 'meteora' as const,
    }));

    // Cache displayed pools so callback handler can resolve prefix → full pool
    const chatId = ctx.chat?.id;
    if (chatId) {
      setDisplayedPools(chatId, pools.map(p => ({ address: p.address, name: p.name, dex: 'meteora' })));
    }

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

/**
 * Display Orca Whirlpool pools (called from callback handler)
 */
export async function showOrcaPools(ctx: BotContext) {
  try {
    const { fetchOrcaPools } = await import('../../orca/pools.js');
    const pools = await fetchOrcaPools(8, 'tvl');

    if (pools.length === 0) {
      await ctx.reply('No Orca pools found. Try again later.');
      return;
    }

    const poolLines = pools.map((p, i) => {
      const fmtTvl = p.tvl >= 1_000_000 ? `$${(p.tvl / 1_000_000).toFixed(1)}M` : p.tvl >= 1_000 ? `$${(p.tvl / 1_000).toFixed(0)}K` : `$${p.tvl.toFixed(0)}`;
      return `${i + 1}. *${p.name}* (${p.feeRate / 100}% fee)\n   TVL: ${fmtTvl} | Tick: ${p.tickSpacing}`;
    }).join('\n\n');

    const text = [
      `*Orca Whirlpool Pools*`,
      ``,
      poolLines,
      ``,
      `Tap a pool to add liquidity.`,
    ].join('\n');

    // Cache displayed pools with orca dex tag
    const chatId = ctx.chat?.id;
    if (chatId) {
      setDisplayedPools(chatId, pools.map(p => ({
        address: p.address,
        name: p.name,
        dex: 'orca' as const,
        tickSpacing: p.tickSpacing,
      })));
    }

    // Build selection keyboard with address-based callbacks
    const kb = new InlineKeyboard();
    for (const pool of pools) {
      // Use address prefix for stable lookup: lp:p:o:PREFIX (o = orca)
      kb.text(`${pool.name}`, `lp:p:o:${pool.address.slice(0, 11)}`).row();
    }
    kb.text('Back to Categories', 'cmd:pools');

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  } catch (error: any) {
    console.error('[Bot] /pools orca error:', error);
    await ctx.reply('Failed to fetch Orca pools. Please try again.');
  }
}

/**
 * Show best yield pools across all DEXes (unified view)
 */
export async function showBestYieldPools(ctx: BotContext) {
  try {
    await ctx.reply('🔍 Finding best yield pools across all DEXes...');

    // Fetch from both sources in parallel
    const [meteoraPools, orcaPoolsResult] = await Promise.allSettled([
      fetchPoolsByCategory('all'),
      import('../../orca/pools.js').then(m => m.fetchOrcaPools(8, 'tvl')),
    ]);

    // Process Meteora pools
    const meteora = meteoraPools.status === 'fulfilled' 
      ? meteoraPools.value.map(p => ({
          ...p,
          dex: 'meteora' as const,
          dailyYieldPer100: (p.apr / 365 * 100 / 100).toFixed(2), // $ per day on $100
        }))
      : [];

    // Process Orca pools (estimate APR from fee rate if not available)
    const orca = orcaPoolsResult.status === 'fulfilled'
      ? orcaPoolsResult.value.map(p => ({
          name: p.name,
          address: p.address,
          apr: p.feeRate * 3, // Rough estimate: feeRate in bps, ~3x daily turnover
          tvl: p.tvl,
          volume24h: 0,
          binStep: 0,
          tickSpacing: p.tickSpacing,
          dex: 'orca' as const,
          dailyYieldPer100: ((p.feeRate * 3) / 365 * 100 / 100).toFixed(2),
        }))
      : [];

    // Combine and sort by APR (highest first)
    const combined = [...meteora, ...orca]
      .filter(p => p.tvl >= 50000) // Min $50K TVL
      .sort((a, b) => b.apr - a.apr)
      .slice(0, 10);

    if (combined.length === 0) {
      await ctx.reply('No pools found. Please try again later.');
      return;
    }

    const poolLines = combined.map((p, i) => {
      const fmtTvl = p.tvl >= 1_000_000 
        ? `$${(p.tvl / 1_000_000).toFixed(1)}M` 
        : `$${(p.tvl / 1_000).toFixed(0)}K`;
      const dexTag = p.dex === 'orca' ? '🌀' : '☄️';
      // Show bin step for Meteora or tick spacing for Orca
      const stepInfo = p.dex === 'meteora' && p.binStep 
        ? ` • ${p.binStep}bp` 
        : p.dex === 'orca' && p.tickSpacing 
          ? ` • tick ${p.tickSpacing}` 
          : '';
      return `${i + 1}. ${dexTag} *${p.name}*${stepInfo}\n   ${p.apr.toFixed(1)}% APR (~$${p.dailyYieldPer100}/day per $100) | TVL: ${fmtTvl}`;
    }).join('\n\n');

    const text = [
      `*🏆 Best Yield Pools*`,
      `_Across Meteora ☄️ & Orca 🌀_`,
      ``,
      poolLines,
      ``,
      `Tap a pool to add liquidity.`,
    ].join('\n');

    // Cache displayed pools for callback lookup
    const chatId = ctx.chat?.id;
    if (chatId) {
      setDisplayedPools(chatId, combined.map(p => ({
        address: p.address,
        name: p.name,
        dex: p.dex,
        tickSpacing: p.dex === 'orca' ? p.tickSpacing : undefined,
      })));
    }

    // Build keyboard with address-based callbacks
    const kb = new InlineKeyboard();
    for (const pool of combined) {
      const dexTag = pool.dex === 'orca' ? 'o' : 'm';
      kb.text(`${pool.dex === 'orca' ? '🌀' : '☄️'} ${pool.name}`, `lp:p:${dexTag}:${pool.address.slice(0, 11)}`).row();
    }
    kb.text('Back to Categories', 'cmd:pools');

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  } catch (error: any) {
    console.error('[Bot] /pools best error:', error);
    await ctx.reply('Failed to fetch pools. Please try again.');
  }
}

// ============ Token sets for category filtering ============

/** Liquid Staking Tokens */
const LST_TOKENS = new Set([
  'mSOL', 'bSOL', 'jSOL', 'jitoSOL', 'JitoSOL', 'lfSOL', 'hSOL',
  'cgntSOL', 'INF', 'jupSOL', 'vSOL', 'stSOL', 'scnSOL', 'dSOL',
  'laineSOL', 'edgeSOL', 'compassSOL', 'LST', 'bonkSOL', 'hubSOL',
  'picoSOL', 'pathSOL', 'clockSOL', 'fpSOL', 'jucySOL',
]);

/** xStocks — Tokenized equities from xstocks.fi
 *  Tickers end with 'x' (AAPLx, TSLAx, NVDAx, etc.)
 */
const XSTOCKS_TICKERS = new Set([
  'ABTx', 'ABBVx', 'ACNx', 'GOOGLx', 'AMZNx', 'AMBRx', 'AAPLx',
  'APPx', 'AZNx', 'BACx', 'BRK.Bx', 'AVGOx', 'CVXx', 'CRCLx',
  'CSCOx', 'KOx', 'COINx', 'CMCSAx', 'CRWDx', 'DHRx', 'DFDVx',
  'LLYx', 'XOMx', 'GMEx', 'GLDx', 'GSx', 'HDx', 'HONx', 'INTCx',
  'IBMx', 'JNJx', 'JPMx', 'LINx', 'MRVLx', 'MAx', 'MCDx', 'MDTx',
  'MRKx', 'METAx', 'MSFTx', 'MSTRx', 'QQQx', 'NFLXx', 'NVOx',
  'NVDAx', 'OPENx', 'ORCLx', 'PLTRx', 'PEPx', 'PFEx', 'PMx',
  'PGx', 'HOODx', 'CRMx', 'SPYx', 'STRCx', 'TBLLx', 'TSLAx',
  'TMOx', 'TONXx', 'TQQQx', 'UNHx', 'VTIx', 'Vx', 'WMTx',
]);

// ============ Pool cache & fetching ============

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

function isXstocksPool(name: string): boolean {
  const parts = (name || '').split('-');
  // Match exact ticker or match the "x" suffix pattern
  return parts.some((t: string) =>
    XSTOCKS_TICKERS.has(t) || /^[A-Z]{2,5}x$/.test(t)
  );
}

function isLstPool(name: string): boolean {
  const parts = (name || '').split('-');
  return parts.some((t: string) => LST_TOKENS.has(t));
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

    case 'lst':
      filtered = valid.filter((p) => isLstPool(p.name));
      sorted = filtered
        .sort((a: any, b: any) => parseFloat(b.liquidity) - parseFloat(a.liquidity))
        .slice(0, 8);
      break;

    case 'xstocks':
      filtered = valid.filter((p) => isXstocksPool(p.name));
      sorted = filtered
        .sort((a: any, b: any) => parseFloat(b.liquidity) - parseFloat(a.liquidity))
        .slice(0, 8);
      break;

    case 'all':
    default:
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
