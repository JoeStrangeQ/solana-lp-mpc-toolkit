/**
 * /price command handler - Get token prices
 * 
 * Usage: /price SOL or /price JTO BONK
 */
import type { BotContext } from '../types.js';
import { getAggregatedPrices } from '../../services/oracle-service.js';

// Common token mints
const TOKEN_MINTS: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'ETH': '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  'BTC': '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
  'JTO': 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'PYTH': 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'ORCA': 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  'MSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'JITOSOL': 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  'HNT': 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',
  'RENDER': 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
};

const TOKEN_ALIASES: Record<string, string> = {
  'SOLANA': 'SOL',
  'ETHEREUM': 'ETH',
  'BITCOIN': 'BTC',
  'JITO': 'JTO',
  'JUPITER': 'JUP',
  'DOGWIFHAT': 'WIF',
  'RAYDIUM': 'RAY',
  'HELIUM': 'HNT',
};

function resolveToken(input: string): { symbol: string; mint: string } | null {
  const upper = input.toUpperCase().trim();
  
  // Check aliases first
  const aliased = TOKEN_ALIASES[upper] || upper;
  
  // Check if we have the mint
  const mint = TOKEN_MINTS[aliased];
  if (mint) {
    return { symbol: aliased, mint };
  }
  
  // Check if input is already a mint address (32-44 chars base58)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) {
    return { symbol: 'UNKNOWN', mint: input };
  }
  
  return null;
}

export async function priceCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text || '';
  const args = text.replace(/^\/price\s*/i, '').trim();

  if (!args) {
    // Show popular prices
    const defaultTokens = ['SOL', 'ETH', 'BTC', 'JTO', 'JUP', 'BONK'];
    const mints = defaultTokens.map(t => TOKEN_MINTS[t]).filter(Boolean);
    
    try {
      const prices = await getAggregatedPrices(mints);
      
      const lines = defaultTokens.map(symbol => {
        const mint = TOKEN_MINTS[symbol];
        const priceData = prices.get(mint);
        if (priceData) {
          const formatted = priceData.price < 0.01 
            ? `$${priceData.price.toPrecision(4)}`
            : priceData.price < 1
              ? `$${priceData.price.toFixed(4)}`
              : `$${priceData.price.toFixed(2)}`;
          return `${symbol}: ${formatted}`;
        }
        return `${symbol}: --`;
      });

      await ctx.reply(
        `*Token Prices*\n\n${lines.join('\n')}\n\n` +
        `_Use /price TOKEN for specific tokens_`,
        { parse_mode: 'Markdown' },
      );
    } catch (e) {
      await ctx.reply('Failed to fetch prices. Try again later.');
    }
    return;
  }

  // Parse requested tokens
  const tokenInputs = args.split(/[\s,]+/).filter(Boolean);
  const tokens = tokenInputs.map(resolveToken).filter(Boolean) as Array<{ symbol: string; mint: string }>;

  if (tokens.length === 0) {
    await ctx.reply(
      `Token not found: ${args}\n\n` +
      `Supported: SOL, ETH, BTC, JTO, JUP, BONK, WIF, PYTH, RAY, ORCA, MSOL, JITOSOL`,
    );
    return;
  }

  try {
    const mints = tokens.map(t => t.mint);
    const prices = await getAggregatedPrices(mints);

    const lines = tokens.map(({ symbol, mint }) => {
      const priceData = prices.get(mint);
      if (priceData) {
        const formatted = priceData.price < 0.01 
          ? `$${priceData.price.toPrecision(4)}`
          : priceData.price < 1
            ? `$${priceData.price.toFixed(4)}`
            : `$${priceData.price.toFixed(2)}`;
        
        const sources = priceData.sources || [];
        const sourceStr = sources.length > 0 ? `(${sources.join(', ')})` : '';
        const conf = priceData.confidence 
          ? ` ±${(priceData.confidence * 100).toFixed(2)}%`
          : '';
        
        return `*${symbol}*: ${formatted}${conf} ${sourceStr}`;
      }
      return `*${symbol}*: Price unavailable`;
    });

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[Price] Error:', e);
    await ctx.reply('Failed to fetch prices. Try again later.');
  }
}
