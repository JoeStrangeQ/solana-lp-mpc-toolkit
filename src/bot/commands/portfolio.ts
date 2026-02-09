/**
 * /portfolio command handler - Portfolio overview with total value
 */
import type { BotContext } from '../types.js';
import { InlineKeyboard } from 'grammy';
import { getUserByChat, getUserPositions } from '../../onboarding/index.js';
import { getOrcaPositionsForWallet } from '../../services/orca-service.js';
import { fetchRaydiumPositions } from '../../raydium/positions.js';
import { getAggregatedPrice } from '../../services/oracle-service.js';

interface PortfolioSummary {
  totalValueUsd: number;
  totalFeesUsd: number;
  positionCount: number;
  inRangeCount: number;
  outOfRangeCount: number;
  byDex: {
    meteora: { count: number; valueUsd: number };
    orca: { count: number; valueUsd: number };
    raydium: { count: number; valueUsd: number };
  };
  topPositions: Array<{
    pool: string;
    dex: string;
    valueUsd: number;
    inRange: boolean;
  }>;
}

export async function portfolioCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    const user = await getUserByChat(chatId);

    if (!user) {
      await ctx.reply('No wallet found. Use /start to create one.');
      return;
    }

    await ctx.reply('📊 Loading portfolio...');

    // Fetch SOL price for USD conversions
    let solPrice = 200; // Default fallback
    try {
      const priceResult = await getAggregatedPrice('So11111111111111111111111111111111111111112');
      solPrice = priceResult.price;
    } catch (e) {
      console.warn('[Portfolio] Failed to fetch SOL price, using default');
    }

    // Fetch all positions from all DEXes
    const [meteoraPositions, orcaPositions, raydiumPositions] = await Promise.all([
      getUserPositions(user.walletAddress).catch(() => []),
      getOrcaPositionsForWallet(user.walletAddress).catch(() => []),
      fetchRaydiumPositions(user.walletAddress).catch(() => []),
    ]);

    const totalPositions = meteoraPositions.length + orcaPositions.length + raydiumPositions.length;

    if (totalPositions === 0) {
      await ctx.reply(
        '*Portfolio Empty*\n\n' +
        'You don\'t have any LP positions yet.\n\n' +
        'Use /deposit to add funds, then /pools to find a pool.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Calculate Meteora values
    let meteoraValueUsd = 0;
    let meteoraFeesUsd = 0;
    let meteoraInRange = 0;

    for (const pos of meteoraPositions) {
      // Use the numeric amount field
      const tokenXAmount = pos.amounts.tokenX.amount || 0;
      const tokenYAmount = pos.amounts.tokenY.amount || 0;
      
      // Rough USD calculation (assumes tokenX is SOL-like, tokenY is USD-like)
      const valueUsd = tokenXAmount * solPrice + tokenYAmount;
      meteoraValueUsd += valueUsd;

      // Parse fees
      const feeX = parseFloat((pos.fees.tokenX || '0').replace(/[^0-9.]/g, ''));
      const feeY = parseFloat((pos.fees.tokenY || '0').replace(/[^0-9.]/g, ''));
      meteoraFeesUsd += feeX * solPrice + feeY;

      if (pos.inRange) meteoraInRange++;
    }

    // Calculate Orca values
    let orcaValueUsd = 0;
    let orcaFeesUsd = 0;
    let orcaInRange = 0;

    for (const pos of orcaPositions) {
      const tokenAAmount = parseFloat(pos.tokenA?.amount || '0');
      const tokenBAmount = parseFloat(pos.tokenB?.amount || '0');
      
      // Rough USD calculation
      const valueUsd = tokenAAmount * solPrice + tokenBAmount;
      orcaValueUsd += valueUsd;

      // Parse fees
      const feeA = parseFloat((pos.fees?.tokenA || '0').replace(/[^0-9.]/g, ''));
      const feeB = parseFloat((pos.fees?.tokenB || '0').replace(/[^0-9.]/g, ''));
      orcaFeesUsd += feeA * solPrice + feeB;

      if (pos.inRange) orcaInRange++;
    }

    // Calculate Raydium values
    let raydiumValueUsd = 0;
    let raydiumFeesUsd = 0;
    let raydiumInRange = 0;

    for (const pos of raydiumPositions) {
      // Raydium positions have amountA/amountB
      const valueUsd = pos.amountA * solPrice + pos.amountB;
      raydiumValueUsd += valueUsd;

      // Add fees
      raydiumFeesUsd += pos.feesOwedA * solPrice + pos.feesOwedB;

      if (pos.inRange) raydiumInRange++;
    }

    const totalValueUsd = meteoraValueUsd + orcaValueUsd + raydiumValueUsd;
    const totalFeesUsd = meteoraFeesUsd + orcaFeesUsd + raydiumFeesUsd;
    const inRangeCount = meteoraInRange + orcaInRange + raydiumInRange;
    const outOfRangeCount = totalPositions - inRangeCount;

    // Build top positions list
    const allPositions = [
      ...meteoraPositions.map(p => ({
        pool: p.pool,
        dex: 'Meteora',
        valueUsd: (p.amounts.tokenX.amount || 0) * solPrice + (p.amounts.tokenY.amount || 0),
        inRange: p.inRange,
      })),
      ...orcaPositions.map(p => ({
        pool: p.poolName,
        dex: 'Orca',
        valueUsd: parseFloat(p.tokenA?.amount || '0') * solPrice + parseFloat(p.tokenB?.amount || '0'),
        inRange: p.inRange,
      })),
      ...raydiumPositions.map(p => ({
        pool: p.poolName,
        dex: 'Raydium',
        valueUsd: p.amountA * solPrice + p.amountB,
        inRange: p.inRange,
      })),
    ].sort((a, b) => b.valueUsd - a.valueUsd);

    // Format display
    const formatUsd = (n: number) => n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

    const healthStatus = outOfRangeCount === 0 
      ? '✅ All positions earning fees'
      : `⚠️ ${outOfRangeCount} position(s) out of range`;

    const lines = [
      `📊 *Portfolio Overview*`,
      ``,
      `💰 *Total Value:* ${formatUsd(totalValueUsd)}`,
      `✨ *Fees Earned:* ${formatUsd(totalFeesUsd)}`,
      ``,
      `📈 *Positions:* ${totalPositions}`,
      `   🟢 In Range: ${inRangeCount}`,
      `   🔴 Out of Range: ${outOfRangeCount}`,
      ``,
      `*By DEX:*`,
      meteoraPositions.length > 0 ? `   🌙 Meteora: ${meteoraPositions.length} pos (${formatUsd(meteoraValueUsd)})` : null,
      orcaPositions.length > 0 ? `   🐋 Orca: ${orcaPositions.length} pos (${formatUsd(orcaValueUsd)})` : null,
      raydiumPositions.length > 0 ? `   ⚡ Raydium: ${raydiumPositions.length} pos (${formatUsd(raydiumValueUsd)})` : null,
      ``,
      healthStatus,
    ].filter(Boolean).join('\n');

    const kb = new InlineKeyboard()
      .text('📋 Positions', 'cmd:positions')
      .text('🔄 Rebalance', 'cmd:rebalance')
      .row()
      .text('🔄 Refresh', 'cmd:portfolio');

    await ctx.reply(lines, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } catch (error: any) {
    console.error('[Bot] /portfolio error:', error);
    await ctx.reply('Failed to load portfolio. Please try again.');
  }
}
