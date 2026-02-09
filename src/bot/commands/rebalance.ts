/**
 * /rebalance command - Enter the rebalance wizard for out-of-range positions
 */
import type { BotContext } from '../types.js';

export async function rebalanceCommand(ctx: BotContext): Promise<void> {
  await ctx.conversation.enter('rebalanceWizard');
}
