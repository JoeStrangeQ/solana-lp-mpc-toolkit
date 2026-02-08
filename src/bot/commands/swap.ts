/**
 * /swap - Direct token swap via Jupiter
 * 
 * Usage: /swap 0.5 SOL to USDC
 *        /swap 100 USDC to SOL
 */

import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';
import { getWalletBalance, loadWalletById } from '../../services/wallet-service.js';
import { getAggregatedPrice } from '../../services/oracle-service.js';
import { InlineKeyboard } from 'grammy';

// Common token mints
const TOKEN_MINTS: Record<string, string> = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'JitoSOL': 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  'mSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
};

export async function swapCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getUserByChat(chatId);
  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  // Parse command: /swap 0.5 SOL to USDC
  const text = ctx.message?.text || '';
  const match = text.match(/\/swap\s+([\d.]+)\s*(\w+)\s+(?:to|for|->)\s*(\w+)/i);
  
  if (!match) {
    // Show help with quick swap buttons
    const keyboard = new InlineKeyboard()
      .text('0.1 SOL → USDC', 'swap:0.1:SOL:USDC').row()
      .text('0.5 SOL → USDC', 'swap:0.5:SOL:USDC').row()
      .text('50 USDC → SOL', 'swap:50:USDC:SOL').row();

    await ctx.reply(
      `*Quick Swap*\n\n` +
      `Usage: \`/swap 0.5 SOL to USDC\`\n\n` +
      `Supported tokens: SOL, USDC, USDT, JitoSOL, mSOL, BONK, WIF\n\n` +
      `Or tap a quick swap:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return;
  }

  const amount = parseFloat(match[1]);
  const fromToken = match[2].toUpperCase();
  const toToken = match[3].toUpperCase();

  // Validate tokens
  const fromMint = TOKEN_MINTS[fromToken];
  const toMint = TOKEN_MINTS[toToken];

  if (!fromMint) {
    await ctx.reply(`Unknown token: ${fromToken}. Supported: ${Object.keys(TOKEN_MINTS).join(', ')}`);
    return;
  }
  if (!toMint) {
    await ctx.reply(`Unknown token: ${toToken}. Supported: ${Object.keys(TOKEN_MINTS).join(', ')}`);
    return;
  }

  await ctx.reply(`🔄 Getting quote for ${amount} ${fromToken} → ${toToken}...`);

  try {
    // Get quote from Jupiter
    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${fromMint}&outputMint=${toMint}&amount=${Math.floor(amount * (fromToken === 'SOL' ? 1e9 : 1e6))}&slippageBps=100`;
    const quoteResp = await fetch(quoteUrl);
    
    if (!quoteResp.ok) {
      throw new Error('Failed to get quote from Jupiter');
    }

    const quote = await quoteResp.json() as any;
    const outAmount = parseInt(quote.outAmount) / (toToken === 'SOL' ? 1e9 : 1e6);
    const priceImpact = parseFloat(quote.priceImpactPct || '0');

    // Get USD values
    let fromUsd = 0, toUsd = 0;
    try {
      const fromPrice = await getAggregatedPrice(fromMint);
      const toPrice = await getAggregatedPrice(toMint);
      fromUsd = amount * fromPrice.price;
      toUsd = outAmount * toPrice.price;
    } catch (e) {
      // Price fetch failed, continue without USD
    }

    const keyboard = new InlineKeyboard()
      .text('✅ Confirm Swap', `swap:exec:${amount}:${fromToken}:${toToken}`)
      .text('❌ Cancel', 'cancel');

    const usdInfo = fromUsd > 0 ? `\n~$${fromUsd.toFixed(2)} → ~$${toUsd.toFixed(2)}` : '';
    const impactWarning = priceImpact > 1 ? `\n⚠️ Price impact: ${priceImpact.toFixed(2)}%` : '';

    await ctx.reply(
      `*Swap Quote*\n\n` +
      `${amount} ${fromToken} → ${outAmount.toFixed(6)} ${toToken}${usdInfo}${impactWarning}\n\n` +
      `Confirm swap?`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  } catch (error: any) {
    console.error('[Swap] Quote error:', error);
    await ctx.reply(`Failed to get swap quote: ${error.message}`);
  }
}
