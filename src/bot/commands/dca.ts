/**
 * /dca command - Dollar Cost Averaging into LP positions
 * 
 * Commands:
 * /dca - Show DCA menu / active schedules
 * /dca new - Start DCA setup wizard
 * /dca list - List active DCA schedules
 * /dca cancel <id> - Cancel a DCA schedule
 */

import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';
import {
  getUserDCASchedules,
  cancelDCASchedule,
  pauseDCASchedule,
  resumeDCASchedule,
  formatInterval,
  formatNextExecution,
  type DCASchedule,
} from '../../services/dca-service.js';

/**
 * Main /dca command handler
 */
export async function dcaCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getUserByChat(chatId);
  if (!user) {
    await ctx.reply('Please run /start first to create your wallet.');
    return;
  }

  // Get user's active DCA schedules
  const schedules = await getUserDCASchedules(user.walletId);

  if (schedules.length === 0) {
    // No active schedules - show setup prompt
    const kb = new InlineKeyboard()
      .text('➕ Set Up DCA', 'dca:new')
      .row()
      .text('ℹ️ What is DCA?', 'dca:info');

    await ctx.reply(
      `*Dollar Cost Averaging (DCA)*\n\n` +
      `No active DCA schedules.\n\n` +
      `DCA automatically adds liquidity to a pool at regular intervals, ` +
      `spreading your entry over time to reduce timing risk.`,
      { parse_mode: 'Markdown', reply_markup: kb }
    );
    return;
  }

  // Show active schedules
  const scheduleLines = schedules.map((s, i) => {
    const statusIcon = s.status === 'active' ? '🟢' : s.status === 'paused' ? '⏸️' : '⏹️';
    const dexIcon = s.dex === 'meteora' ? '🌙' : s.dex === 'orca' ? '🐋' : '⚡';
    const progress = ((s.spentSol / s.totalBudgetSol) * 100).toFixed(0);
    
    return [
      `${i + 1}. ${statusIcon} ${dexIcon} *${s.poolName}*`,
      `   ${s.amountSolPerExecution} SOL ${formatInterval(s.interval).toLowerCase()}`,
      `   Progress: ${s.spentSol.toFixed(2)}/${s.totalBudgetSol} SOL (${progress}%)`,
      `   Next: ${formatNextExecution(s.nextExecutionAt)}`,
    ].join('\n');
  }).join('\n\n');

  const kb = new InlineKeyboard()
    .text('➕ New DCA', 'dca:new')
    .row();
  
  // Add manage buttons for each schedule
  schedules.forEach((s, i) => {
    const label = s.status === 'active' ? `⏸️ Pause #${i + 1}` : `▶️ Resume #${i + 1}`;
    kb.text(label, `dca:toggle:${s.id}`);
    kb.text(`🗑️`, `dca:cancel:${s.id}`);
    kb.row();
  });

  await ctx.reply(
    `*Your DCA Schedules*\n\n${scheduleLines}`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

/**
 * Format DCA schedule for display
 */
export function formatDCASchedule(s: DCASchedule): string {
  const statusIcon = s.status === 'active' ? '🟢' : s.status === 'paused' ? '⏸️' : '⏹️';
  const dexIcon = s.dex === 'meteora' ? '🌙' : s.dex === 'orca' ? '🐋' : '⚡';
  const progress = ((s.spentSol / s.totalBudgetSol) * 100).toFixed(0);
  
  return [
    `${statusIcon} ${dexIcon} *${s.poolName}*`,
    ``,
    `Amount: ${s.amountSolPerExecution} SOL per ${s.interval}`,
    `Strategy: ${s.strategy}`,
    `Progress: ${s.executionCount}/${s.maxExecutions} executions`,
    `Spent: ${s.spentSol.toFixed(2)}/${s.totalBudgetSol} SOL (${progress}%)`,
    `Next: ${s.status === 'active' ? formatNextExecution(s.nextExecutionAt) : 'N/A'}`,
    s.lastError ? `\n⚠️ Last error: ${s.lastError}` : '',
  ].filter(Boolean).join('\n');
}
