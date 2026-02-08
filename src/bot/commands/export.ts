/**
 * /export - Export position data as text summary
 */

import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';
import { discoverAllPositions } from '../../utils/position-discovery.js';
import { getConnection } from '../../services/connection-pool.js';

export async function exportCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getUserByChat(chatId);
  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  await ctx.reply('📊 Generating position export...');

  try {
    const connection = getConnection();
    const positions = await discoverAllPositions(connection, user.walletAddress);
    
    if (positions.length === 0) {
      await ctx.reply('No positions to export.');
      return;
    }

    const lines = [
      `LP Position Export`,
      `Wallet: ${user.walletAddress}`,
      `Date: ${new Date().toISOString()}`,
      ``,
      `Positions:`,
    ];

    for (const pos of positions) {
      lines.push(`---`);
      lines.push(`Pool: ${pos.pool?.name || 'Unknown'}`);
      lines.push(`Address: ${pos.address}`);
      lines.push(`Range: ${pos.priceRange?.display || 'N/A'}`);
      lines.push(`In Range: ${pos.inRange ? 'Yes' : 'No'}`);
      lines.push(`Token X: ${pos.amounts?.tokenX || 0}`);
      lines.push(`Token Y: ${pos.amounts?.tokenY || 0}`);
      lines.push(`Fees X: ${pos.fees?.tokenXFormatted || '0'}`);
      lines.push(`Fees Y: ${pos.fees?.tokenYFormatted || '0'}`);
    }

    lines.push(`---`);
    lines.push(`Total Positions: ${positions.length}`);

    // Send as a code block for easy copying
    await ctx.reply(
      '```\n' + lines.join('\n') + '\n```',
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    console.error('[Export] Error:', error);
    await ctx.reply(`Export failed: ${error.message}`);
  }
}
