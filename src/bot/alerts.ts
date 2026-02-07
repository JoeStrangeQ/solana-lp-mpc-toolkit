/**
 * Alert sending functions for the bot
 * Out-of-range alerts, rebalance prompts, daily summaries
 *
 * These use the grammY bot instance to send messages directly
 * (not in response to a user message, but proactively).
 */
import { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from './types.js';
import { debounceAlert } from '../utils/resilience.js';

// 15 minutes between identical out-of-range alerts
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

export async function sendOutOfRangeAlert(
  bot: Bot<BotContext>,
  chatId: number | string,
  position: {
    address: string;
    poolName: string;
    poolAddress: string;
    direction: 'above' | 'below';
    distance: number;
  },
) {
  // Debounce: skip if same position was alerted recently
  if (!debounceAlert(`bot-oor:${position.address}`, ALERT_COOLDOWN_MS)) {
    return;
  }

  const text = [
    `*Out of Range Alert*`,
    ``,
    `Position: \`${position.address.slice(0, 8)}...\``,
    `Pool: *${position.poolName}*`,
    `Direction: ${position.direction === 'above' ? 'Above range' : 'Below range'}`,
    `Distance: ${position.distance} bins`,
    ``,
    `Consider rebalancing to continue earning fees.`,
  ].join('\n');

  const kb = new InlineKeyboard()
    .text('Rebalance', `rb:0`)
    .text('Snooze 1h', `snooze:0`)
    .row()
    .text('OK', 'dismiss');

  await bot.api.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

export async function sendRebalancePrompt(
  bot: Bot<BotContext>,
  chatId: number | string,
  position: {
    address: string;
    poolName: string;
    poolAddress: string;
    currentPrice: number;
    suggestedStrategy: string;
  },
) {
  const text = [
    `*Rebalance Suggestion*`,
    ``,
    `Pool: *${position.poolName}*`,
    `Current Price: $${position.currentPrice.toFixed(2)}`,
    `Suggested: ${position.suggestedStrategy}`,
    ``,
    `Would you like to rebalance this position?`,
  ].join('\n');

  const kb = new InlineKeyboard()
    .text('Rebalance', `rb:0`)
    .text('Dismiss', 'dismiss');

  await bot.api.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

export async function sendDailySummary(
  bot: Bot<BotContext>,
  chatId: number | string,
  summary: {
    totalPositions: number;
    inRange: number;
    outOfRange: number;
    totalFeesUsd: number;
  },
) {
  const status = summary.outOfRange > 0 ? 'Needs attention' : 'All good';

  const text = [
    `*Daily LP Summary*`,
    ``,
    `Status: ${status}`,
    `Positions: ${summary.totalPositions}`,
    `In Range: ${summary.inRange}`,
    `Out of Range: ${summary.outOfRange}`,
    `Fees Earned: $${summary.totalFeesUsd.toFixed(2)}`,
  ].join('\n');

  await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}
