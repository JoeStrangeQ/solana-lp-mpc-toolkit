/**
 * /find command handler - Search pools by token names
 * 
 * Usage: /find SOL USDC or /find solana usdc
 */
import type { BotContext } from '../types.js';
import { InlineKeyboard } from 'grammy';
import { setDisplayedPools, setPendingLpPool } from '../types.js';

// Common token aliases
const TOKEN_ALIASES: Record<string, string[]> = {
  'SOL': ['sol', 'solana'],
  'USDC': ['usdc', 'usd'],
  'USDT': ['usdt', 'tether'],
  'ETH': ['eth', 'ethereum', 'weth'],
  'BTC': ['btc', 'bitcoin', 'wbtc'],
  'JTO': ['jto', 'jito'],
  'JUP': ['jup', 'jupiter'],
  'RAY': ['ray', 'raydium'],
  'BONK': ['bonk'],
  'WIF': ['wif', 'dogwifhat'],
  'PYTH': ['pyth'],
  'ORCA': ['orca'],
  'MSOL': ['msol'],
  'JITOSOL': ['jitosol', 'jsol'],
  'BSOL': ['bsol'],
};

function normalizeToken(input: string): string {
  const lower = input.toLowerCase().trim();
  for (const [token, aliases] of Object.entries(TOKEN_ALIASES)) {
    if (aliases.includes(lower) || token.toLowerCase() === lower) {
      return token;
    }
  }
  return input.toUpperCase();
}

export async function findCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text || '';
  const args = text.replace(/^\/find\s*/i, '').trim();

  if (!args) {
    await ctx.reply(
      '*Search LP Pools*\n\n' +
      'Usage: `/find SOL USDC` or `/find solana usdc`\n\n' +
      'Examples:\n' +
      '• `/find SOL USDC` - SOL/USDC pools\n' +
      '• `/find ETH SOL` - ETH/SOL pools\n' +
      '• `/find JTO` - All JTO pools',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Parse token names
  const tokens = args.split(/[\s\/\-]+/).filter(Boolean).map(normalizeToken);
  
  if (tokens.length === 0) {
    await ctx.reply('Please specify token names. Example: `/find SOL USDC`', { parse_mode: 'Markdown' });
    return;
  }

  await ctx.reply(`🔍 Searching for ${tokens.join('/')} pools...`);

  try {
    // Search Meteora pools
    const meteoraUrl = 'https://dlmm-api.meteora.ag/pair/all_with_pagination?limit=100';
    const meteoraResp = await fetch(meteoraUrl);
    const meteoraData = await meteoraResp.json() as { groups: any[] };
    
    const matchingPools: Array<{
      name: string;
      address: string;
      dex: string;
      tvl: number;
      apr: number;
    }> = [];

    // Search through Meteora pools
    for (const group of meteoraData.groups || []) {
      for (const pair of group.pairs || []) {
        const pairName = (pair.name || '').toUpperCase();
        const matchesAll = tokens.every(t => pairName.includes(t));
        
        if (matchesAll) {
          matchingPools.push({
            name: pair.name || 'Unknown',
            address: pair.address,
            dex: 'Meteora',
            tvl: pair.liquidity || 0,
            apr: pair.apr || 0,
          });
        }
      }
    }

    // Sort by TVL
    matchingPools.sort((a, b) => b.tvl - a.tvl);
    const topPools = matchingPools.slice(0, 5);

    if (topPools.length === 0) {
      await ctx.reply(
        `No pools found for ${tokens.join('/')}.\n\n` +
        'Try `/pools` to browse available pools.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Store for selection
    setDisplayedPools(chatId, topPools.map(p => ({
      name: p.name,
      address: p.address,
      apr: p.apr,
      tvl: p.tvl,
      volume24h: 0,
      binStep: 0,
    })));

    // Format results
    const formatTvl = (n: number) => n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${(n/1e3).toFixed(0)}K`;
    
    const lines = topPools.map((p, i) => 
      `${i + 1}. *${p.name}* (${p.dex})\n   TVL: ${formatTvl(p.tvl)} | APR: ${p.apr.toFixed(1)}%`
    );

    const kb = new InlineKeyboard();
    for (let i = 0; i < topPools.length; i++) {
      kb.text(`${i + 1}. ${topPools[i].name}`, `lp:p:m:${topPools[i].address.slice(0, 8)}`).row();
    }

    await ctx.reply(
      `*${tokens.join('/')} Pools Found*\n\n${lines.join('\n\n')}\n\nTap to add liquidity:`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  } catch (error: any) {
    console.error('[Find] Search error:', error);
    await ctx.reply('Search failed. Try `/pools` to browse pools.', { parse_mode: 'Markdown' });
  }
}
