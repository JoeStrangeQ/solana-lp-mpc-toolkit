/**
 * /tips - LP tips and best practices
 */

import type { BotContext } from '../types.js';
import { InlineKeyboard } from 'grammy';

const TIPS = [
  {
    title: '💡 Concentrated vs Wide',
    content: `*Concentrated* (+/- 5 bins): Higher fees, needs frequent rebalancing
*Wide* (+/- 20 bins): Lower fees, more passive

Start wide if you're new, go concentrated when you understand the mechanics.`,
  },
  {
    title: '📊 Impermanent Loss',
    content: `IL happens when token prices diverge from when you entered.

• Small price moves (< 5%): IL usually < 0.5%
• Medium moves (5-20%): IL can be 1-5%
• Large moves (> 50%): IL can exceed 10%

Fees earned often offset IL in active pools.`,
  },
  {
    title: '⚡ When to Rebalance',
    content: `Rebalance when your position goes out of range.

Signs you need to rebalance:
• Price moved past your range
• /positions shows "Out of Range"
• You're not earning fees

Use /rebalance to analyze and fix.`,
  },
  {
    title: '🎯 Pool Selection',
    content: `High APR isn't everything! Consider:

• *TVL*: Higher = more stable
• *Volume*: More volume = more fees
• *Volatility*: Lower = less IL risk
• *Bin step*: Lower = tighter range, more precision

Use /pools to browse and compare.`,
  },
  {
    title: '🔒 Security Tips',
    content: `Keep your LP safe:

• Never share your wallet ID
• Check positions regularly
• Set up alerts in /settings
• Withdraw to cold storage if idle
• Use /claim to harvest fees regularly`,
  },
];

let currentTipIndex = 0;

export async function tipsCommand(ctx: BotContext) {
  const tip = TIPS[currentTipIndex];
  currentTipIndex = (currentTipIndex + 1) % TIPS.length;

  const keyboard = new InlineKeyboard()
    .text('Next Tip →', 'tips:next')
    .text('All Tips', 'tips:all');

  await ctx.reply(
    `${tip.title}\n\n${tip.content}`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}
