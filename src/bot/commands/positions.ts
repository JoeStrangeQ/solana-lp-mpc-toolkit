/**
 * /positions command handler - View LP positions with PnL
 */
import type { BotContext } from '../types.js';
import { setCachedPositions } from '../types.js';
import { InlineKeyboard } from 'grammy';
import { getUserByChat, getUserPositions } from '../../onboarding/index.js';
import { sparkline, formatPnL } from '../../utils/sparkline.js';

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
    
    // Generate price sparkline from range (simulated trend based on position in range)
    const generateRangeSparkline = (lower: number, current: number, upper: number): string => {
      const range = upper - lower;
      const position = (current - lower) / range;
      // Create a sparkline showing where price is in range
      const values = Array(8).fill(0).map((_, i) => {
        const x = i / 7;
        // Bell curve centered on current position
        return Math.exp(-Math.pow((x - position) * 3, 2));
      });
      return sparkline(values, 8);
    };

    // Format Meteora positions with PnL
    const meteoraLines = positions.map((p, i) => {
      const status = p.inRange ? '🟢 IN RANGE' : '🔴 OUT';
      const rangeChart = generateRangeSparkline(
        p.priceRange.lower, 
        p.priceRange.current, 
        p.priceRange.upper
      );
      
      // Parse fees to calculate rough earnings
      const feeXNum = parseFloat(p.fees.tokenX.replace(/[^0-9.]/g, '')) || 0;
      const feeYNum = parseFloat(p.fees.tokenY.replace(/[^0-9.]/g, '')) || 0;
      const hasFees = feeXNum > 0 || feeYNum > 0;
      
      return [
        `*${p.pool}* ${status}`,
        `${rangeChart} $${priceFmt(p.priceRange.current)}`,
        `↔️ $${priceFmt(p.priceRange.lower)} - $${priceFmt(p.priceRange.upper)}`,
        `💰 ${p.amounts.tokenX.formatted} + ${p.amounts.tokenY.formatted}`,
        hasFees ? `✨ Fees: ${p.fees.tokenX} + ${p.fees.tokenY}` : null,
      ].filter(Boolean).join('\n');
    });

    // Format Orca positions with PnL
    const orcaLines = orcaPositions.map((p: any) => {
      const status = p.inRange ? '🟢 IN RANGE' : '🔴 OUT';
      const rangeChart = generateRangeSparkline(
        p.priceLower, 
        p.priceCurrent, 
        p.priceUpper
      );
      
      const feeA = parseFloat(p.fees?.tokenA?.replace(/[^0-9.]/g, '')) || 0;
      const feeB = parseFloat(p.fees?.tokenB?.replace(/[^0-9.]/g, '')) || 0;
      const hasFees = feeA > 0 || feeB > 0;
      
      return [
        `*${p.poolName}* (Orca) ${status}`,
        `${rangeChart} $${priceFmt(p.priceCurrent)}`,
        `↔️ $${priceFmt(p.priceLower)} - $${priceFmt(p.priceUpper)}`,
        `💰 ${p.tokenA.amount} ${p.tokenA.symbol} + ${p.tokenB.amount} ${p.tokenB.symbol}`,
        hasFees ? `✨ Fees: ${p.fees.tokenA} + ${p.fees.tokenB}` : null,
      ].filter(Boolean).join('\n');
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
