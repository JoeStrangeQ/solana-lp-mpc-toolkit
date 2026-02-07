/**
 * /positions command handler - View LP positions
 */
import type { BotContext } from '../types.js';
import { InlineKeyboard } from 'grammy';
import { getUserByChat, getUserPositions } from '../../onboarding/index.js';

export async function positionsCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    const user = await getUserByChat(chatId);

    if (!user) {
      await ctx.reply('No wallet found. Use /start to create one.');
      return;
    }

    ctx.session.walletId = user.walletId;
    ctx.session.walletAddress = user.walletAddress;

    await ctx.reply('Loading positions...');

    const positions = await getUserPositions(user.walletAddress);

    if (positions.length === 0) {
      await ctx.reply(
        '*No LP Positions*\n\nYou don\'t have any LP positions yet.\nDeposit SOL first (/deposit), then use /pools to find a pool.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const priceFmt = (n: number) => (n < 1 ? n.toFixed(4) : n.toFixed(2));

    const posLines = positions
      .map((p, i) => {
        const status = p.inRange ? 'IN RANGE' : 'OUT OF RANGE';
        const icon = p.inRange ? '🟢' : '🔴';

        return [
          `${icon} *${p.pool}* - ${status}`,
          `  Price: $${priceFmt(p.priceRange.current)}`,
          `  Range: $${priceFmt(p.priceRange.lower)} - $${priceFmt(p.priceRange.upper)}`,
          `  ${p.amounts.tokenX.formatted} + ${p.amounts.tokenY.formatted}`,
          `  Fees: ${p.fees.tokenX} + ${p.fees.tokenY}`,
        ].join('\n');
      })
      .join('\n\n');

    const kb = new InlineKeyboard();

    for (let i = 0; i < Math.min(positions.length, 8); i++) {
      const p = positions[i];
      const icon = p.inRange ? '🟢' : '🔴';
      kb.text(`${icon} ${p.pool}`, `pd:${i}`)
        .text('Withdraw', `wd:${i}`)
        .row();
    }

    kb.text('Rebalance All', `rb:all`).text('Refresh', 'cmd:positions');

    const text = [
      `*Your LP Positions* (${positions.length})`,
      ``,
      posLines,
    ].join('\n');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } catch (error: any) {
    console.error('[Bot] /positions error:', error);
    await ctx.reply('Failed to load positions. Please try again.');
  }
}
