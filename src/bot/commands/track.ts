/**
 * /track command - Auto-track all positions for monitoring
 */
import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';
import { discoverAllPositions } from '../../utils/position-discovery.js';
import { getConnection } from '../../services/connection-pool.js';
import { trackPosition, getTrackedPositions, createDefaultSettings, type TrackedPosition } from '../../monitoring/index.js';

export async function trackCommand(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    // Get user's wallet
    const user = await getUserByChat(chatId);
    if (!user) {
      await ctx.reply('❌ No wallet found. Use /start to create one.');
      return;
    }
    const walletAddress = user.walletAddress;

    await ctx.reply('🔍 Discovering positions...');

    // Get already tracked positions
    const userId = String(chatId);
    const alreadyTracked = await getTrackedPositions(userId);
    const trackedAddresses = new Set(alreadyTracked.map(p => p.positionAddress));

    // Discover all positions on-chain
    const connection = getConnection();
    const discovered = await discoverAllPositions(connection, walletAddress);

    if (discovered.length === 0) {
      await ctx.reply('📭 No positions found to track.');
      return;
    }

    // Ensure user settings exist
    await createDefaultSettings(userId, { chatId });

    // Track new positions
    let newTracked = 0;
    for (const pos of discovered) {
      if (trackedAddresses.has(pos.address)) {
        continue; // Already tracked
      }

      const position: TrackedPosition = {
        positionAddress: pos.address,
        poolAddress: pos.pool.address,
        poolName: pos.pool.name || `${pos.pool.tokenX.symbol}-${pos.pool.tokenY.symbol}`,
        userId,
        binRange: pos.binRange,
        createdAt: new Date().toISOString(),
        lastInRange: pos.inRange,
      };
      await trackPosition(position);
      newTracked++;
    }

    const total = alreadyTracked.length + newTracked;
    const emoji = newTracked > 0 ? '✅' : 'ℹ️';
    
    let msg = `${emoji} **Monitoring Status**\n\n`;
    msg += `📊 Positions found: ${discovered.length}\n`;
    msg += `🆕 Newly tracked: ${newTracked}\n`;
    msg += `📋 Total monitored: ${total}\n\n`;
    
    if (newTracked > 0) {
      msg += `You'll receive alerts when positions go out of range.\n`;
      msg += `Use /alerts to manage notifications.`;
    } else {
      msg += `All your positions are already being monitored.`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });

  } catch (error: any) {
    console.error('[Track Command] Error:', error);
    await ctx.reply(`❌ Failed to track positions: ${error.message}`);
  }
}
