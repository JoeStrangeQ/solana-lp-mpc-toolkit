/**
 * /positions command handler - View LP positions
 */
import type { BotContext } from '../types.js';
import { setCachedPositions } from '../types.js';
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

    // Fetch Orca positions (non-blocking)
    let orcaPositions: any[] = [];
    try {
      const { getOrcaPositionsForWallet } = await import('../../services/orca-service.js');
      orcaPositions = await getOrcaPositionsForWallet(user.walletAddress);
    } catch (err) {
      console.warn('[Bot] Orca position discovery failed (non-blocking):', err);
    }

    const totalCount = positions.length + orcaPositions.length;

    if (totalCount === 0) {
      await ctx.reply(
        '*No LP Positions*\n\nYou don\'t have any LP positions yet.\nDeposit SOL first (/deposit), then use /pools to find a pool.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Build unified cached positions list
    const allCached = [
      ...positions.map(p => ({
        address: p.address,
        pool: p.pool,
        poolAddress: p.poolAddress,
        walletId: user.walletId,
        walletAddress: user.walletAddress,
        dex: 'meteora' as const,
      })),
      ...orcaPositions.map(p => ({
        address: p.address,
        pool: p.poolName,
        poolAddress: p.poolAddress,
        walletId: user.walletId,
        walletAddress: user.walletAddress,
        dex: 'orca' as const,
        positionMintAddress: p.mintAddress,
      })),
    ];

    setCachedPositions(chatId, allCached);

    const priceFmt = (n: number) => (n < 1 ? n.toFixed(4) : n.toFixed(2));

    // Format Meteora positions
    const meteoraLines = positions.map((p, i) => {
      const status = p.inRange ? 'IN RANGE' : 'OUT OF RANGE';
      const icon = p.inRange ? '🟢' : '🔴';
      return [
        `${icon} *${p.pool}* (Meteora) - ${status}`,
        `  Price: $${priceFmt(p.priceRange.current)}`,
        `  Range: $${priceFmt(p.priceRange.lower)} - $${priceFmt(p.priceRange.upper)}`,
        `  ${p.amounts.tokenX.formatted} + ${p.amounts.tokenY.formatted}`,
        `  Fees: ${p.fees.tokenX} + ${p.fees.tokenY}`,
      ].join('\n');
    });

    // Format Orca positions
    const orcaLines = orcaPositions.map((p: any) => {
      const status = p.inRange ? 'IN RANGE' : 'OUT OF RANGE';
      const icon = p.inRange ? '🟢' : '🔴';
      return [
        `${icon} *${p.poolName}* (Orca) - ${status}`,
        `  Price: $${priceFmt(p.priceCurrent)}`,
        `  Range: $${priceFmt(p.priceLower)} - $${priceFmt(p.priceUpper)}`,
        `  ${p.tokenA.symbol}: ${p.tokenA.amount} + ${p.tokenB.symbol}: ${p.tokenB.amount}`,
        `  Fees: ${p.fees.tokenA} + ${p.fees.tokenB}`,
      ].join('\n');
    });

    const posLines = [...meteoraLines, ...orcaLines].join('\n\n');

    const kb = new InlineKeyboard();

    for (let i = 0; i < Math.min(allCached.length, 8); i++) {
      const c = allCached[i];
      const dexTag = c.dex === 'orca' ? 'Orca' : 'Met';
      kb.text(`${c.pool} [${dexTag}]`, `pd:${i}`)
        .text('Withdraw', `wd:${i}`)
        .row();
    }

    kb.text('Rebalance All', `rb:all`).text('Refresh', 'cmd:positions');

    const text = [
      `*Your LP Positions* (${totalCount})`,
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
