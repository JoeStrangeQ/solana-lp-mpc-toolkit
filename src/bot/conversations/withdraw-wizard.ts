/**
 * Withdraw Wizard Conversation - Multi-step withdrawal flow
 *
 * Flow: list positions -> select position -> confirm (keep tokens or convert) -> execute
 *
 * Uses conversation.external() for all async service calls.
 * Uses conversation.waitForCallbackQuery() for button selections.
 */
import type { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types.js';
import { withdrawConfirmKeyboard, confirmKeyboard } from '../keyboards.js';
import {
  getUserByChat,
  getUserPositions,
  type PositionDetails,
} from '../../onboarding/index.js';
import { loadWalletById } from '../../services/wallet-service.js';
import { friendlyErrorMessage } from '../../utils/resilience.js';
import { operationLock } from '../../utils/operation-lock.js';

export async function withdrawWizard(
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
      '*No Positions*\n\nYou don\'t have any LP positions to withdraw from.',
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
    posKb.text(`${icon} ${p.pool} - ${p.amounts.tokenX.formatted}`, `wd:sel:${i}`).row();
  }
  posKb.text('Cancel', 'cancel');

  const posText = positions
    .slice(0, 8)
    .map((p, i) => {
      const icon = p.inRange ? '🟢' : '🔴';
      return `${i + 1}. ${icon} *${p.pool}*\n   ${p.amounts.tokenX.formatted} + ${p.amounts.tokenY.formatted}`;
    })
    .join('\n\n');

  await ctx.reply(
    `*Withdraw - Select Position*\n\n${posText}\n\nTap a position to withdraw:`,
    {
      parse_mode: 'Markdown',
      reply_markup: posKb,
    },
  );

  // Wait for position selection
  const posCtx = await conversation.waitForCallbackQuery(/^(wd:sel:\d+|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap a position button above.');
    },
  });
  await posCtx.answerCallbackQuery();

  if (posCtx.callbackQuery.data === 'cancel') {
    await posCtx.reply('Withdrawal cancelled.');
    return;
  }

  const posIdx = parseInt(posCtx.callbackQuery.data.split(':')[2]);
  const selected = positions[posIdx];

  if (!selected) {
    await ctx.reply('Invalid position. Please try again.');
    return;
  }

  // ---- Step 2: Withdrawal options ----
  const summary = [
    `*Withdraw from ${selected.pool}*`,
    ``,
    `Position: \`${selected.address.slice(0, 8)}...\``,
    `Range: $${priceFmt(selected.priceRange.lower)} - $${priceFmt(selected.priceRange.upper)}`,
    `Current: ${selected.amounts.tokenX.formatted} + ${selected.amounts.tokenY.formatted}`,
    `Fees: ${selected.fees.tokenX} + ${selected.fees.tokenY}`,
    ``,
    `Choose withdrawal type:`,
  ].join('\n');

  await ctx.reply(summary, {
    parse_mode: 'Markdown',
    reply_markup: withdrawConfirmKeyboard(),
  });

  const optCtx = await conversation.waitForCallbackQuery(/^(wd:cf:(keep|sol)|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap a withdrawal option above.');
    },
  });
  await optCtx.answerCallbackQuery();

  if (optCtx.callbackQuery.data === 'cancel') {
    await optCtx.reply('Withdrawal cancelled.');
    return;
  }

  const convertToSol = optCtx.callbackQuery.data === 'wd:cf:sol';

  // ---- Step 3: Final confirmation ----
  const confirmText = [
    `*Confirm Withdrawal*`,
    ``,
    `Pool: *${selected.pool}*`,
    `Convert to SOL: ${convertToSol ? 'Yes' : 'No (keep both tokens)'}`,
    ``,
    `This will:`,
    `1. Encrypt strategy (Arcium)`,
    `2. Withdraw liquidity + claim fees`,
    convertToSol ? `3. Swap tokens to SOL (Jupiter)` : '',
    `${convertToSol ? '4' : '3'}. Bundle via Jito (MEV-protected)`,
    ``,
    `Proceed?`,
  ]
    .filter(Boolean)
    .join('\n');

  await ctx.reply(confirmText, {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard('wd'),
  });

  const cfCtx = await conversation.waitForCallbackQuery(/^(cf:wd|cancel)$/, {
    otherwise: async (ctx) => {
      await ctx.reply('Please tap Confirm or Cancel.');
    },
  });
  await cfCtx.answerCallbackQuery();

  if (cfCtx.callbackQuery.data === 'cancel') {
    await cfCtx.reply('Withdrawal cancelled.');
    return;
  }

  // ---- Step 4: Execute ----
  const lockAcquired = operationLock.tryAcquire(user.walletId, 'withdraw');
  if (!lockAcquired) {
    await ctx.reply('A withdrawal is already in progress. Please wait for it to complete.');
    return;
  }

  await ctx.reply(
    `Executing withdrawal...\n\nEncrypting with Arcium...\nBuilding Jito bundle...\n\nThis may take 30-60 seconds.`,
  );

  const result = await conversation.external(async () => {
    try {
      // Queue withdrawal via worker (avoids timeout)
      const { queueWithdrawal } = await import('../../monitoring/worker.js');
      const jobId = await queueWithdrawal({
        walletId: user.walletId,
        poolAddress: selected.poolAddress,
        positionAddress: selected.address,
        chatId: ctx.chat!.id,
        convertToSol,
        poolName: selected.pool,
      });
      return { success: true as const, jobId };
    } catch (error: any) {
      console.error('[Withdraw Wizard] Execution error:', error);
      return { success: false as const, error: friendlyErrorMessage(error) };
    } finally {
      operationLock.release(user.walletId, 'withdraw');
    }
  });

  if (result.success) {
    await ctx.reply(
      [
        `*Withdrawal Queued*`,
        ``,
        `Pool: *${selected.pool}*`,
        `Processing in background...`,
        ``,
        `You'll receive a notification when it's done.`,
        `(Usually 30-60 seconds)`,
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  } else {
    await ctx.reply(
      `*Withdrawal Failed*\n\n${result.error}\n\nYour tokens are safe. Try again with /withdraw.`,
      { parse_mode: 'Markdown' },
    );
  }
}
