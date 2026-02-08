/**
 * Orca LP Wizard Conversation - Multi-step Orca Whirlpool LP position creation
 *
 * Flow: pool pre-selected from /pools Orca -> enter amount -> select strategy -> confirm -> execute
 *
 * Similar to lp-wizard.ts but for Orca Whirlpools:
 * - No distribution shape (Orca uses uniform in range)
 * - Shows tick spacing instead of bin step
 * - Uses consumePendingLpPool instead of consumePendingPoolAddress
 */
import type { Conversation } from '@grammyjs/conversations';
import type { BotContext } from '../types.js';
import { amountKeyboard, strategyKeyboard, confirmKeyboard } from '../keyboards.js';
import { getUserByChat } from '../../onboarding/index.js';
import { executeOrcaLp, type OrcaLpExecuteParams } from '../../services/orca-service.js';
import { loadWalletById, getWalletBalance } from '../../services/wallet-service.js';
import { validateSolAmount, friendlyErrorMessage } from '../../utils/resilience.js';
import { operationLock } from '../../utils/operation-lock.js';
import { consumePendingLpPool } from '../types.js';

export async function orcaLpWizard(
  conversation: Conversation<BotContext, BotContext>,
  ctx: BotContext,
) {
  // Step 0: Verify user
  const user = await conversation.external(async () => {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;
    return getUserByChat(chatId);
  });
  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  // Step 1: Pool is pre-selected from /pools Orca category
  const pendingPool = await conversation.external(() => {
    const chatId = ctx.chat?.id;
    if (!chatId) return undefined;
    return consumePendingLpPool(chatId);
  });

  if (!pendingPool || pendingPool.dex !== 'orca') {
    await ctx.reply('No Orca pool selected. Use /pools and select an Orca pool.');
    return;
  }

  const selectedPool = pendingPool;
  await ctx.reply(
    `*Add Orca Liquidity*\n\nPool: *${selectedPool.name || selectedPool.address.slice(0, 8)}*`,
    { parse_mode: 'Markdown' },
  );

  // Step 2: Amount
  await ctx.reply(
    `*Amount*\n\nPool: *${selectedPool.name}*\n\nHow much SOL?`,
    { parse_mode: 'Markdown', reply_markup: amountKeyboard() },
  );

  const amtCtx = await conversation.waitForCallbackQuery(/^(lp:amt:.+|cancel)$/, {
    otherwise: async (ctx) => { await ctx.reply('Please tap an amount button above.'); },
  });
  await amtCtx.answerCallbackQuery();
  const amtData = amtCtx.callbackQuery.data;
  if (amtData === 'cancel') { await amtCtx.reply('LP cancelled.'); return; }

  // Fee reserve: covers tx fees (~0.005/tx × 3), rent for ATAs + position (~0.01)
  const FEE_RESERVE = 0.05;

  // Fetch balance early (needed for max and validation)
  const balanceCheck = await conversation.external(async () => {
    try {
      const bal = await getWalletBalance(user.walletAddress);
      console.log(`[Orca LP] Balance check for ${user.walletAddress}: ${bal.sol} SOL (${bal.lamports} lamports)`);
      return bal.sol;
    } catch (err) {
      console.error(`[Orca LP] Balance check failed for ${user.walletAddress}:`, err);
      return null;
    }
  });

  let amount: number;
  if (amtData === 'lp:amt:max') {
    if (balanceCheck === null || balanceCheck <= FEE_RESERVE) {
      await ctx.reply(`Could not determine balance or balance too low. LP cancelled.`);
      return;
    }
    amount = Math.floor((balanceCheck - FEE_RESERVE) * 100) / 100;
    if (amount <= 0) {
      await ctx.reply(`Balance too low for LP (need >${FEE_RESERVE} SOL for fees). LP cancelled.`);
      return;
    }
    await ctx.reply(`Using max: *${amount} SOL* (keeping ${FEE_RESERVE} SOL for fees)`, { parse_mode: 'Markdown' });
  } else if (amtData === 'lp:amt:custom') {
    await ctx.reply('Enter the amount in SOL (e.g., 2.5):');
    const customCtx = await conversation.waitFor('message:text', {
      otherwise: async (ctx) => { await ctx.reply('Please send a number.'); },
    });
    const parsed = parseFloat(customCtx.message.text.trim());
    const validation = validateSolAmount(parsed);
    if (isNaN(parsed) || !validation.valid) {
      await ctx.reply(`${validation.error || 'Invalid amount.'} LP cancelled.`);
      return;
    }
    amount = parsed;
  } else {
    amount = parseFloat(amtData.split(':')[2]);
  }

  // Balance check
  if (balanceCheck !== null && amount > balanceCheck - FEE_RESERVE) {
    console.log(`[Orca LP] Balance check failed: have ${balanceCheck} SOL, need ${amount} + ${FEE_RESERVE} reserve`);
    await ctx.reply(
      `Not enough SOL. You have *${balanceCheck.toFixed(4)} SOL* but need *${amount} SOL* + ~${FEE_RESERVE} SOL for tx fees & rent.\n\nTry a smaller amount or tap *Max*.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Step 3: Strategy (concentrated/wide - no distribution shape for Orca)
  await ctx.reply(
    `*Strategy*\n\nPool: *${selectedPool.name}*\nAmount: *${amount} SOL*\n\nChoose range strategy:`,
    { parse_mode: 'Markdown', reply_markup: strategyKeyboard() },
  );

  const strCtx = await conversation.waitForCallbackQuery(/^(lp:str:[cw]|cancel)$/, {
    otherwise: async (ctx) => { await ctx.reply('Please tap a strategy button above.'); },
  });
  await strCtx.answerCallbackQuery();
  const strData = strCtx.callbackQuery.data;
  if (strData === 'cancel') { await strCtx.reply('LP cancelled.'); return; }
  const strategy: 'concentrated' | 'wide' = strData === 'lp:str:c' ? 'concentrated' : 'wide';

  // Step 4: Confirmation (skip distribution shape - Orca is uniform)
  const summary = [
    `*Confirm Orca LP Position*`,
    ``,
    `Pool: *${selectedPool.name}*`,
    `Amount: *${amount} SOL*`,
    `Strategy: *${strategy}*`,
    `DEX: *Orca Whirlpool*`,
    ``,
    `Your position will be:`,
    `- Encrypted with Arcium`,
    `- Sent via direct RPC`,
    ``,
    `Confirm?`,
  ].join('\n');

  await ctx.reply(summary, { parse_mode: 'Markdown', reply_markup: confirmKeyboard('olp') });

  const cfCtx = await conversation.waitForCallbackQuery(/^(cf:olp|cancel)$/, {
    otherwise: async (ctx) => { await ctx.reply('Please tap Confirm or Cancel.'); },
  });
  await cfCtx.answerCallbackQuery();
  if (cfCtx.callbackQuery.data === 'cancel') { await cfCtx.reply('LP cancelled.'); return; }

  // Step 5: Execute
  const lockAcquired = operationLock.tryAcquire(user.walletId, 'orca-lp');
  if (!lockAcquired) {
    await ctx.reply('An Orca LP operation is already in progress.');
    return;
  }

  await ctx.reply('Executing Orca LP position...\n\nBuilding transactions...\n\nThis may take 30-60 seconds.');

  const result = await conversation.external(async () => {
    try {
      const { client } = await loadWalletById(user.walletId);
      const params: OrcaLpExecuteParams = {
        walletId: user.walletId,
        walletAddress: user.walletAddress,
        poolAddress: selectedPool.address,
        amountSol: amount,
        strategy,
        tipSpeed: 'fast',
        slippageBps: 300,
        signTransaction: async (tx) => client.signTransaction(tx),
        signAndSendTransaction: async (tx) => client.signAndSendTransaction(tx),
      };
      const res = await executeOrcaLp(params);
      return { success: true as const, txHashes: res.txHashes, status: res.status };
    } catch (error: any) {
      console.error('[Orca LP Wizard] Execution error:', error);
      return { success: false as const, error: friendlyErrorMessage(error) };
    } finally {
      operationLock.release(user.walletId, 'orca-lp');
    }
  });

  if (result.success) {
    const txRef = result.txHashes?.length
      ? `Tx: \`${result.txHashes[result.txHashes.length - 1]?.slice(0, 16)}...\``
      : '';
    const text = [
      `*Orca LP Position Created!*`,
      ``,
      `Pool: *${selectedPool.name}*`,
      `Amount: ${amount} SOL`,
      `Strategy: ${strategy}`,
      ``,
      `Encrypted with Arcium`,
      txRef,
      ``,
      `Use /positions to view.`,
    ].join('\n');
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(
      `*Orca LP Failed*\n\n${result.error}\n\nTry again with /pools.`,
      { parse_mode: 'Markdown' },
    );
  }
}
