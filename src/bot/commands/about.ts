/**
 * /about command handler - Toolkit information
 */
import type { BotContext } from '../types.js';
import { InlineKeyboard } from 'grammy';

export async function aboutCommand(ctx: BotContext) {
  const lines = [
    `*🦐 MnM LP Agent Toolkit*`,
    ``,
    `An AI-native toolkit for managing concentrated liquidity positions on Solana.`,
    ``,
    `*🔐 Security*`,
    `• Arcium encryption for strategy privacy`,
    `• Privy MPC wallets (no seed phrases)`,
    `• Jito bundles for MEV protection`,
    ``,
    `*🏊 Supported DEXes*`,
    `• Meteora DLMM`,
    `• Orca Whirlpools`,
    ``,
    `*⚡ Features*`,
    `• Natural language pool search`,
    `• Impermanent loss tracking`,
    `• Auto-rebalance recommendations`,
    `• Real-time position monitoring`,
    `• Portfolio overview`,
    ``,
    `*🔗 Links*`,
    `• API: \`lp-agent-api-production.up.railway.app\``,
    `• GitHub: JoeStrangeQ/solana-lp-mpc-toolkit`,
    ``,
    `Built for the Colosseum Agent Hackathon 2026`,
  ];

  const kb = new InlineKeyboard()
    .url('GitHub', 'https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit')
    .url('API Docs', 'https://lp-agent-api-production.up.railway.app/skill.md');

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}
