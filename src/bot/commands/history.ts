/**
 * /history - Show recent transaction history from Solscan
 */

import type { BotContext } from '../types.js';
import { getUserByChat } from '../../onboarding/index.js';

const SOLSCAN_API = 'https://api.solscan.io';

interface SolscanTx {
  txHash: string;
  blockTime: number;
  status: string;
  fee: number;
  signer: string[];
}

export async function historyCommand(ctx: BotContext) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getUserByChat(chatId);
  if (!user) {
    await ctx.reply('No wallet found. Use /start to create one first.');
    return;
  }

  await ctx.reply('📜 Fetching recent transactions...');

  try {
    // Get recent transactions from Solscan
    const resp = await fetch(
      `${SOLSCAN_API}/account/transactions?address=${user.walletAddress}&limit=10`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!resp.ok) {
      throw new Error('Failed to fetch transaction history');
    }

    const data = await resp.json() as any;
    const txs = data.data || data || [];

    if (!Array.isArray(txs) || txs.length === 0) {
      await ctx.reply(
        `*Transaction History*\n\nNo recent transactions found.\n\n` +
        `Wallet: \`${user.walletAddress.slice(0, 8)}...\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Format transactions
    const lines = txs.slice(0, 8).map((tx: any, i: number) => {
      const hash = tx.txHash || tx.signature || 'Unknown';
      const time = tx.blockTime 
        ? new Date(tx.blockTime * 1000).toLocaleString('en-US', { 
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
          })
        : 'Unknown';
      const status = tx.status === 'Success' || tx.status === 'success' ? '✅' : '❌';
      const fee = tx.fee ? `${(tx.fee / 1e9).toFixed(6)} SOL` : '';
      
      return `${status} \`${hash.slice(0, 12)}...\`\n   ${time} ${fee}`;
    });

    const text = [
      `*Recent Transactions*`,
      ``,
      ...lines,
      ``,
      `[View on Solscan](https://solscan.io/account/${user.walletAddress})`,
    ].join('\n');

    await ctx.reply(text, { 
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true }
    });
  } catch (error: any) {
    console.error('[History] Error:', error);
    // Fallback: just link to Solscan
    await ctx.reply(
      `*Transaction History*\n\n` +
      `View your transaction history on Solscan:\n` +
      `[Open Solscan](https://solscan.io/account/${user.walletAddress})`,
      { parse_mode: 'Markdown' }
    );
  }
}
