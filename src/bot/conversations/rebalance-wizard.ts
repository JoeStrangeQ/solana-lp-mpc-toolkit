/**
 * Rebalance Wizard Conversation - Multi-step rebalance flow
 *
 * Flow: list positions -> select position -> choose new strategy -> confirm -> execute
 *
 * Uses conversation.external() for all async service calls.
 * Uses conversation.waitForCallbackQuery() for button selections.
 */
import type { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types.js';
import { rebalanceStrategyKeyboard, distributionKeyboard, confirmKeyboard } from '../keyboards.js';
import { getUserByChat, getUserPositions } from '../../onboarding/index.js';
import { executeRebalanceOperation, type RebalanceParams } from '../../services/lp-service.js';
import { loadWalletById } from '../../services/wallet-service.js';
import { friendlyErrorMessage } from '../../utils/resilience.js';
import { operationLock } from '../../utils/operation-lock.js';

export async function rebalanceWizard(
  conversation: Conversation<BotContext, BotContext>,
  ctx: BotContext,
) {
  // ---- Step 0: Verify user has a wallet ----
  const user = await conversation.external(async () => {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;
    return getUserByChat(chatId);
  });

  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  // ---- Step 1: Load and display positions ----
  const positions = await conversation.external(async () => {
    return getUserPositions(user.walletAddress);
  });

  if (positions.length === 0) {
    await ctx.reply(
      '*No Positions*\n\nYou don\'t have any LP positions to rebalance.',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const priceFmt = (n: number) => (n < 1 ? n.toFixed(4) : n.toFixed(2));

  // Build position selection keyboard
  const posKb = new InlineKeyboard();
  for (let i = 0; i < Math.min(positions.length, 8); i++) {
    const p = positions[i];
    const icon = p.inRange ? '🟢' : '🔴';
    posKb.text(`${icon} ${p.pool}`, `rb:sel:${i}`).row();
  }
  posKb.text('Cancel', 'cancel');

  const posText = positions
    .slice(0, 8)
    .map((p, i) => {
      const icon = p.inRange ? '🟢' : '🔴';
      const status = p.inRange ? 'IN RANGE' : 'OUT OF RANGE';
      return [
        `${i + 1}. ${icon} *${p.pool}* - ${status}`,
        `   Price: $${priceFmt(p.priceRange.current)}`,
        `   Range: $${priceFmt(p.priceRange.lower)} - $${priceFmt(p.priceRange.upper)}`,
      ].join('\n');
    })
    .join('\n\n');

  await ctx.reply(
    `*Rebalance - Select Position*\n\n${posText}\n\nTap a position to rebalance:`,
    {
      parse_mode: 'Markdown',
      reply_markup: posKb,
    },
  );

  // Wait for selection
  const posCtx = await conversation.waitForCallbackQuery(/^(rb:sel:\d+|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap a position button above.');
    },
  });
  await posCtx.answerCallbackQuery();

  if (posCtx.callbackQuery.data === 'cancel') {
    await posCtx.reply('Rebalance cancelled.');
    return;
  }

  const posIdx = parseInt(posCtx.callbackQuery.data.split(':')[2]);
  const selected = positions[posIdx];

  if (!selected) {
    await ctx.reply('Invalid position. Please try again.');
    return;
  }

  // ---- Step 2: New strategy selection ----
  await ctx.reply(
    [
      `*Rebalance ${selected.pool}*`,
      ``,
      `Current range: $${priceFmt(selected.priceRange.lower)} - $${priceFmt(selected.priceRange.upper)}`,
      `Current price: $${priceFmt(selected.priceRange.current)}`,
      `Status: ${selected.inRange ? 'IN RANGE' : 'OUT OF RANGE'}`,
      ``,
      `Choose new range strategy:`,
    ].join('\n'),
    {
      parse_mode: 'Markdown',
      reply_markup: rebalanceStrategyKeyboard(),
    },
  );

  const strCtx = await conversation.waitForCallbackQuery(/^(rb:str:[cw]|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap a strategy button above.');
    },
  });
  await strCtx.answerCallbackQuery();

  if (strCtx.callbackQuery.data === 'cancel') {
    await strCtx.reply('Rebalance cancelled.');
    return;
  }

  const strategy: 'concentrated' | 'wide' =
    strCtx.callbackQuery.data === 'rb:str:c' ? 'concentrated' : 'wide';
  const binOffset = strategy === 'concentrated' ? 5 : 20;

  // ---- Step 3: Distribution shape ----
  await ctx.reply(
    `*Rebalance - Distribution*\n\nNew strategy: *${strategy}* (+/- ${binOffset} bins)\n\nChoose distribution shape:`,
    {
      parse_mode: 'Markdown',
      reply_markup: distributionKeyboard(),
    },
  );

  const distCtx = await conversation.waitForCallbackQuery(/^(lp:dist:(spot|curve|bidask)|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap a distribution button above.');
    },
  });
  await distCtx.answerCallbackQuery();

  if (distCtx.callbackQuery.data === 'cancel') {
    await distCtx.reply('Rebalance cancelled.');
    return;
  }

  const shape = distCtx.callbackQuery.data.split(':')[2] as 'spot' | 'curve' | 'bidask';

  // ---- Step 4: Confirmation ----
  const confirmText = [
    `*Confirm Rebalance*`,
    ``,
    `Pool: *${selected.pool}*`,
    `New strategy: *${strategy}* (+/- ${binOffset} bins)`,
    `Distribution: *${shape}*`,
    ``,
    `This will:`,
    `1. Withdraw current position`,
    `2. Re-enter with new range around current price`,
    `3. All atomic via Jito bundle`,
    ``,
    `Your tokens are safe if any step fails.`,
    ``,
    `Proceed?`,
  ].join('\n');

  await ctx.reply(confirmText, {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard('rb'),
  });

  const cfCtx = await conversation.waitForCallbackQuery(/^(cf:rb|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap Confirm or Cancel.');
    },
  });
  await cfCtx.answerCallbackQuery();

  if (cfCtx.callbackQuery.data === 'cancel') {
    await cfCtx.reply('Rebalance cancelled.');
    return;
  }

  // ---- Step 5: Execute ----
  const lockAcquired = operationLock.tryAcquire(user.walletId, 'rebalance');
  if (!lockAcquired) {
    await ctx.reply('A rebalance operation is already in progress. Please wait for it to complete.');
    return;
  }

  await ctx.reply(
    `Executing rebalance...\n\nPhase 1: Withdrawing position...\nPhase 2: Re-entering with new range...\n\nThis may take 30-60 seconds.`,
  );

  const result = await conversation.external(async () => {
    try {
      const { wallet } = await loadWalletById(user.walletId);

      const params: RebalanceParams = {
        walletId: user.walletId,
        walletAddress: user.walletAddress,
        poolAddress: selected.poolAddress,
        positionAddress: selected.address,
        newMinBinOffset: -binOffset,
        newMaxBinOffset: binOffset,
        strategy,
        shape,
        tipSpeed: 'fast',
        slippageBps: 300,
        signTransaction: async (tx: string) => {
          const signed = await wallet.signTransaction({ transaction: tx });
          return signed.signedTransaction;
        },
      };

      const res = await executeRebalanceOperation(params);
      return {
        success: res.success,
        phase1: res.phase1?.status || 'unknown',
        phase2: res.phase2?.status || 'unknown',
        newBinRange: res.newPosition?.binRange,
      };
    } catch (error: any) {
      console.error('[Rebalance Wizard] Execution error:', error);
      return { success: false, error: friendlyErrorMessage(error) };
    } finally {
      operationLock.release(user.walletId, 'rebalance');
    }
  });

  if (result.success) {
    const rangeStr = result.newBinRange
      ? `New range: bins ${result.newBinRange.lower} to ${result.newBinRange.upper}`
      : '';

    await ctx.reply(
      [
        `*Rebalance Complete!*`,
        ``,
        `Pool: *${selected.pool}*`,
        `Strategy: ${strategy} (${shape})`,
        rangeStr,
        ``,
        `Your position is now in range and earning fees.`,
        ``,
        `Use /positions to view your updated position.`,
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'Markdown' },
    );
  } else {
    const errorMsg = 'error' in result ? (result as any).error : 'Unknown error';
    await ctx.reply(
      [
        `*Rebalance Failed*`,
        ``,
        `Phase 1 (withdraw): ${result.phase1 || 'unknown'}`,
        `Phase 2 (re-enter): ${result.phase2 || 'unknown'}`,
        ``,
        `Error: ${errorMsg}`,
        ``,
        `Your tokens are safe in your wallet.`,
        `Try again with /rebalance.`,
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  }
}
