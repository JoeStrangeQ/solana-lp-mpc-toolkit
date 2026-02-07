/**
 * /pools command handler - Browse top LP pools
 */
import type { BotContext } from '../types.js';
import { poolSelectionKeyboard } from '../keyboards.js';

interface PoolInfo {
  name: string;
  address: string;
  apr: number;
  tvl: number;
  binStep: number;
}

function formatTvl(tvl: number): string {
  if (tvl >= 1_000_000) return `$${(tvl / 1_000_000).toFixed(1)}M`;
  if (tvl >= 1_000) return `$${(tvl / 1_000).toFixed(0)}K`;
  return `$${tvl.toFixed(0)}`;
}

export async function poolsCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  await ctx.reply('Fetching top pools from Meteora...');

  try {
    const pools = await fetchTopPools();

    if (pools.length === 0) {
      await ctx.reply('No pools found. Please try again later.');
      return;
    }

    const poolLines = pools
      .map(
        (p, i) =>
          `${i + 1}. *${p.name}* (bin step: ${p.binStep})\n   APR: ${p.apr.toFixed(1)}% | TVL: ${formatTvl(p.tvl)}`,
      )
      .join('\n\n');

    const text = [
      `*Top LP Pools*`,
      ``,
      poolLines,
      ``,
      `Tap a pool to start adding liquidity.`,
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
    console.error('[Bot] /pools error:', error);
    await ctx.reply('Failed to fetch pools. Please try again.');
  }
}

const POPULAR_TOKENS = new Set([
  'SOL', 'USDC', 'USDT', 'JUP', 'BONK', 'WIF', 'RAY', 'mSOL',
  'bSOL', 'JTO', 'PYTH', 'ETH', 'ORCA',
]);

async function fetchTopPools(): Promise<PoolInfo[]> {
  const resp = await fetch('https://dlmm-api.meteora.ag/pair/all');
  if (!resp.ok) throw new Error('Meteora API failed');

  const allPools = (await resp.json()) as any[];

  const highTvl = allPools.filter(
    (p) => p.liquidity && parseFloat(p.liquidity) > 100_000 && !p.is_blacklisted && !p.hide,
  );

  // Prefer popular token pairs
  const popular = highTvl.filter((p) => {
    const [a, b] = (p.name || '').split('-');
    return POPULAR_TOKENS.has(a) || POPULAR_TOKENS.has(b);
  });

  const sorted = (popular.length > 0 ? popular : highTvl)
    .sort((a: any, b: any) => (b.apr || 0) - (a.apr || 0))
    .slice(0, 6);

  return sorted.map((p: any) => ({
    name: p.name || 'Unknown',
    address: p.address,
    apr: parseFloat(p.apr || '0') * 100,
    tvl: parseFloat(p.liquidity || '0'),
    binStep: parseInt(p.bin_step || '10'),
  }));
}
