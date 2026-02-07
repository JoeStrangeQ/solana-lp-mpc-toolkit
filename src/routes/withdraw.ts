/**
 * Withdraw Routes - Withdrawal operations, fee claim, compound
 */
import { Hono } from 'hono';
import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { loadWalletById } from '../services/wallet-service.js';
import { invalidatePositionCache } from '../services/lp-service.js';
import { stats } from '../services/stats.js';
import { config } from '../config/index.js';
import { buildAtomicWithdraw } from '../lp/atomicWithdraw.js';
import { sendBundle } from '../jito/index.js';
import type { TipSpeed } from '../jito/index.js';

const app = new Hono();

// Build withdrawal transactions
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { walletAddress, poolAddress, positionAddress, tipSpeed = 'fast' } = body;

    if (!walletAddress || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing walletAddress, poolAddress, or positionAddress',
        example: {
          walletAddress: 'your-wallet-address',
          poolAddress: 'pool-address',
          positionAddress: 'position-address-to-withdraw',
          tipSpeed: 'fast',
        },
      }, 400);
    }

    const result = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      tipSpeed: tipSpeed as TipSpeed,
    });

    stats.actions.lpWithdrawn++;

    return c.json({
      success: true,
      message: 'Withdrawal transactions prepared',
      walletAddress,
      poolAddress,
      positionAddress,
      transactions: result.unsignedTransactions,
      estimatedWithdraw: result.estimatedWithdraw,
      fee: result.fee,
      pnl: result.pnl,
      encryptedStrategy: result.encryptedStrategy,
      hint: 'Sign transactions with your wallet and submit via Jito bundle',
    });
  } catch (error: any) {
    console.error('[Withdraw] Error:', error);
    stats.errors++;
    return c.json({ error: 'Withdrawal failed', details: error.message }, 500);
  }
});

// Atomic withdrawal via Jito
app.post('/atomic', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletAddress,
      poolAddress,
      positionAddress,
      tipSpeed = 'fast',
      convertToSol = false,
    } = body;

    if (!walletAddress || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing walletAddress, poolAddress, or positionAddress',
        example: {
          walletAddress: 'your-wallet-address',
          poolAddress: 'pool-address',
          positionAddress: 'position-address-to-withdraw',
          tipSpeed: 'fast',
          convertToSol: true,
        },
      }, 400);
    }

    const result = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      convertToSol,
      tipSpeed: tipSpeed as TipSpeed,
    });

    stats.actions.lpWithdrawn++;

    return c.json({
      success: true,
      message: convertToSol
        ? 'Atomic withdrawal + swap to SOL prepared via Jito'
        : 'Atomic withdrawal prepared via Jito',
      walletAddress,
      poolAddress,
      positionAddress,
      bundle: {
        transactions: result.unsignedTransactions,
        count: result.unsignedTransactions.length,
        tipSpeed,
      },
      estimatedWithdraw: result.estimatedWithdraw,
      swap: result.swap,
      fee: result.fee,
      pnl: result.pnl,
      encryptedStrategy: result.encryptedStrategy,
      hint: 'Sign all transactions and submit as Jito bundle for atomic execution',
    });
  } catch (error: any) {
    console.error('[AtomicWithdraw] Error:', error);
    stats.errors++;
    return c.json({ error: 'Atomic withdrawal failed', details: error.message }, 500);
  }
});

// Full withdrawal execution (background)
app.post('/execute', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletId,
      poolAddress,
      positionAddress,
      tipSpeed = 'fast',
      convertToSol = true,
      chatId,
    } = body;

    if (!walletId || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing walletId, poolAddress, or positionAddress',
        example: {
          walletId: 'your-privy-wallet-id',
          poolAddress: 'pool-address',
          positionAddress: 'position-address-to-withdraw',
          convertToSol: true,
        },
      }, 400);
    }

    const jobId = `wd_${Date.now()}_${positionAddress.slice(0, 8)}`;

    // Process in background
    (async () => {
      try {
        const { client, wallet } = await loadWalletById(walletId);
        const walletAddress = wallet.address;

        const result = await buildAtomicWithdraw({
          walletAddress,
          poolAddress,
          positionAddress,
          convertToSol,
          tipSpeed: tipSpeed as TipSpeed,
        });

        const signedTxs: string[] = [];
        for (const unsignedTx of result.unsignedTransactions) {
          const signedTx = await client.signTransaction(unsignedTx);
          signedTxs.push(signedTx);
        }

        const { bundleId } = await sendBundle(signedTxs);
        console.log(`[Withdraw ${jobId}] Bundle submitted: ${bundleId}`);

        await invalidatePositionCache(walletId);

        if (chatId && process.env.TELEGRAM_BOT_TOKEN) {
          const msg = `*Withdrawal Submitted*\n\nPool: ${poolAddress.slice(0, 8)}...\nBundle: \`${bundleId.slice(0, 16)}...\`\n\n_Check /positions in 30 seconds_`;
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
          });
        }

        stats.actions.lpWithdrawn++;
      } catch (error: any) {
        console.error(`[Withdraw ${jobId}] Error:`, error);
        stats.errors++;

        if (chatId && process.env.TELEGRAM_BOT_TOKEN) {
          const msg = `*Withdrawal Failed*\n\nError: ${error.message || 'Unknown'}`;
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
          });
        }
      }
    })();

    return c.json({
      success: true,
      message: 'Withdrawal started in background',
      jobId,
      walletId,
      poolAddress,
      positionAddress,
      hint: 'Processing... You will receive a notification when complete. Check /positions in 30-60 seconds.',
    });
  } catch (error: any) {
    console.error('[Withdraw Execute] Error:', error);
    stats.errors++;
    return c.json({ error: 'Withdrawal failed', details: error.message }, 500);
  }
});

// Synchronous withdrawal execution
app.post('/execute/sync', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletId,
      poolAddress,
      positionAddress,
      tipSpeed = 'fast',
      convertToSol = true,
    } = body;

    if (!walletId || !poolAddress || !positionAddress) {
      return c.json({ error: 'Missing walletId, poolAddress, or positionAddress' }, 400);
    }

    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    const result = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      convertToSol,
      tipSpeed: tipSpeed as TipSpeed,
    });

    const signedTxs: string[] = [];
    for (const unsignedTx of result.unsignedTransactions) {
      const signedTx = await client.signTransaction(unsignedTx);
      signedTxs.push(signedTx);
    }

    const { bundleId } = await sendBundle(signedTxs);
    await invalidatePositionCache(walletId);

    stats.actions.lpWithdrawn++;
    return c.json({
      success: true,
      message: 'Withdrawal bundle submitted (check Solscan for confirmation)',
      walletId,
      walletAddress,
      poolAddress,
      positionAddress,
      bundle: {
        bundleId,
        submitted: true,
        hint: 'Bundle submitted to Jito - check Solscan in 30-60 seconds for confirmation',
      },
      estimatedWithdraw: result.estimatedWithdraw,
      fee: result.fee,
      pnl: result.pnl,
    });
  } catch (error: any) {
    console.error('[Withdraw Execute] Error:', error);
    stats.errors++;
    return c.json({ error: 'Withdrawal failed', details: error.message }, 500);
  }
});

export default app;

/**
 * Fee claim and compound routes (mounted under /fees)
 */
export function feeRoutes() {
  const feeApp = new Hono();

  feeApp.post('/claim', async (c) => {
    try {
      const body = await c.req.json();
      const { walletAddress, poolAddress, positionAddress } = body;

      if (!walletAddress || !poolAddress || !positionAddress) {
        return c.json({
          error: 'Missing required parameters',
          example: {
            walletAddress: 'your-wallet-address',
            poolAddress: 'pool-address',
            positionAddress: 'position-address',
          },
        }, 400);
      }

      const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
      const pool = await DLMM.create(connection, new PublicKey(poolAddress));

      const userPositions = await pool.getPositionsByUserAndLbPair(new PublicKey(walletAddress));
      const position = userPositions.userPositions.find(
        (p: any) => p.publicKey.toBase58() === positionAddress
      );

      if (!position) {
        return c.json({ error: 'Position not found' }, 404);
      }

      const posData = position.positionData;
      const feeX = posData.feeX?.toString() || '0';
      const feeY = posData.feeY?.toString() || '0';

      if (feeX === '0' && feeY === '0') {
        return c.json({
          success: false,
          message: 'No fees to claim',
          fees: { tokenX: '0', tokenY: '0' },
        });
      }

      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const claimTx = await pool.claimSwapFee({
        owner: new PublicKey(walletAddress),
        position: position,
      });

      const txArray = Array.isArray(claimTx) ? claimTx : [claimTx];
      const unsignedTransactions: string[] = [];

      for (const tx of txArray) {
        if ('recentBlockhash' in tx) {
          tx.recentBlockhash = blockhash;
          tx.feePayer = new PublicKey(walletAddress);
          unsignedTransactions.push(tx.serialize({ requireAllSignatures: false }).toString('base64'));
        }
      }

      return c.json({
        success: true,
        message: 'Fee claim transaction prepared',
        fees: { tokenX: feeX, tokenY: feeY },
        transactions: unsignedTransactions,
        hint: 'Sign and submit to claim fees without withdrawing liquidity',
      });
    } catch (error: any) {
      console.error('[FeeClaim] Error:', error);
      return c.json({ error: 'Fee claim failed', details: error.message }, 500);
    }
  });

  feeApp.post('/compound', async (c) => {
    try {
      const body = await c.req.json();
      const { walletAddress, poolAddress, positionAddress } = body;

      if (!walletAddress || !poolAddress || !positionAddress) {
        return c.json({
          error: 'Missing required parameters',
          example: {
            walletAddress: 'your-wallet-address',
            poolAddress: 'pool-address',
            positionAddress: 'position-address',
          },
        }, 400);
      }

      const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
      const pool = await DLMM.create(connection, new PublicKey(poolAddress));

      const userPositions = await pool.getPositionsByUserAndLbPair(new PublicKey(walletAddress));
      const position = userPositions.userPositions.find(
        (p: any) => p.publicKey.toBase58() === positionAddress
      );

      if (!position) {
        return c.json({ error: 'Position not found' }, 404);
      }

      const posData = position.positionData;
      const feeX = posData.feeX?.toString() || '0';
      const feeY = posData.feeY?.toString() || '0';

      if (feeX === '0' && feeY === '0') {
        return c.json({
          success: false,
          message: 'No fees to compound',
          fees: { tokenX: '0', tokenY: '0' },
        });
      }

      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const claimTx = await pool.claimSwapFee({
        owner: new PublicKey(walletAddress),
        position: position,
      });

      const txArray = Array.isArray(claimTx) ? claimTx : [claimTx];
      const unsignedTransactions: string[] = [];

      for (const tx of txArray) {
        if ('recentBlockhash' in tx) {
          tx.recentBlockhash = blockhash;
          tx.feePayer = new PublicKey(walletAddress);
          unsignedTransactions.push(tx.serialize({ requireAllSignatures: false }).toString('base64'));
        }
      }

      return c.json({
        success: true,
        message: 'Compound: First claim fees, then call /lp/open to re-add',
        fees: { tokenX: feeX, tokenY: feeY },
        step1: {
          action: 'Claim fees',
          transactions: unsignedTransactions,
        },
        step2: {
          action: 'Add liquidity with claimed fees',
          endpoint: 'POST /lp/open',
          hint: 'After fees land in wallet, call /lp/open with the fee amounts',
        },
        note: 'Meteora DLMM requires separate claim + add steps (no native compound)',
      });
    } catch (error: any) {
      console.error('[FeeCompound] Error:', error);
      return c.json({ error: 'Compound failed', details: error.message }, 500);
    }
  });

  return feeApp;
}
