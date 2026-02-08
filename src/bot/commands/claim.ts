/**
 * /claim - Claim fees from LP positions without withdrawing
 * 
 * Uses the same position caching as /positions so that fee:N callbacks work.
 */

import type { BotContext } from '../types.js';
import { setCachedPositions, type CachedPosition } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';
import { discoverAllPositions } from '../../utils/position-discovery.js';
import { getConnection } from '../../services/connection-pool.js';
import { InlineKeyboard } from 'grammy';

export async function claimCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getUserByChat(chatId);
  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  await ctx.reply('🔍 Checking positions for claimable fees...');

  try {
    // Discover positions from Meteora
    const connection = getConnection();
    const positions = await discoverAllPositions(connection, user.walletAddress);
    
    if (positions.length === 0) {
      await ctx.reply('No LP positions found.');
      return;
    }

    // Build cache entries (same format as /positions)
    const cacheEntries: CachedPosition[] = positions.map(p => ({
      address: p.address,
      pool: p.pool?.name || p.pool?.address?.slice(0, 8) || 'Unknown',
      poolAddress: p.pool?.address || '',
      walletId: user.walletId,
      walletAddress: user.walletAddress,
      dex: 'meteora' as const,
    }));
    
    // Cache for callbacks
    setCachedPositions(chatId, cacheEntries);

    // Filter positions with claimable fees
    const withFees = positions.filter((p) => {
      const feeX = parseFloat(p.fees?.tokenXFormatted?.replace(/[^0-9.]/g, '') || '0');
      const feeY = parseFloat(p.fees?.tokenYFormatted?.replace(/[^0-9.]/g, '') || '0');
      return feeX > 0.0001 || feeY > 0.0001;
    });

    if (withFees.length === 0) {
      await ctx.reply('No claimable fees found in your positions. Fees accrue as trades happen in your range.');
      return;
    }

    // Build message with positions that have fees
    const lines = withFees.map((p, i) => {
      const poolName = p.pool?.name || 'Unknown';
      const feeX = p.fees?.tokenXFormatted || '0';
      const feeY = p.fees?.tokenYFormatted || '0';
      const originalIdx = positions.findIndex(pos => pos.address === p.address);
      return { idx: originalIdx, text: `${i + 1}. *${poolName}*\n   Fees: ${feeX} + ${feeY}` };
    });

    // Build keyboard with claim buttons (using fee:N format that callbacks.ts understands)
    const keyboard = new InlineKeyboard();
    lines.forEach(({ idx }, i) => {
      keyboard.text(`💰 Claim ${i + 1}`, `fee:${idx}`).row();
    });
    keyboard.text('❌ Cancel', 'cancel');

    await ctx.reply(
      `*Claimable Fees*\n\n${lines.map(l => l.text).join('\n\n')}\n\nTap to claim:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  } catch (error: any) {
    console.error('[Claim] Error:', error);
    await ctx.reply(`Error checking fees: ${error.message}`);
  }
}
