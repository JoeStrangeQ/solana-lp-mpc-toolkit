/**
 * LP Routes - Atomic LP, regular LP, execute operations
 */
import { Hono } from 'hono';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { loadWalletById, getConnection } from '../services/wallet-service.js';
import { FEE_CONFIG, SAMPLE_POOLS } from '../services/pool-service.js';
import { executeLp, invalidatePositionCache } from '../services/lp-service.js';
import { stats } from '../services/stats.js';
import { withTimeout, PRIVY_SIGN_TIMEOUT_MS } from '../utils/resilience.js';
import { ErrorCode, createError, classifyError, getHttpStatus, getFriendlyMessage } from '../utils/error-codes.js';
import { arciumPrivacy } from '../privacy/index.js';
import { buildAtomicLP } from '../lp/atomic.js';
import { sendBundle, waitForBundle, buildTipTransaction, type TipSpeed } from '../jito/index.js';
import MeteoraDirectClient from '../dex/meteora.js';

const app = new Hono();

app.get('/pools', (c) => {
  return c.json({
    pools: SAMPLE_POOLS,
    description: 'Supported Meteora DLMM pools for LP pipeline',
  });
});

// Open LP position
app.post('/open', async (c) => {
  try {
    const body = await c.req.json();
    const { walletId, poolAddress, amountA, amountB, binRange, encrypt = true } = body;

    if (!walletId) {
      return c.json({
        error: 'Missing walletId',
        hint: 'First call POST /wallet/create, then pass the returned walletId here'
      }, 400);
    }

    if (!poolAddress || !amountA) {
      return c.json({ error: 'Missing poolAddress or amountA' }, 400);
    }

    const { client, wallet } = await loadWalletById(walletId);

    const strategy = {
      action: 'ADD_LIQUIDITY',
      pool: poolAddress,
      amountA,
      amountB: amountB || 0,
      binRange: binRange || [127, 133],
      timestamp: Date.now(),
    };

    let encryptedStrategy = null;
    if (encrypt) {
      await arciumPrivacy.initialize();
      encryptedStrategy = await arciumPrivacy.encryptStrategy(strategy);
    }

    const connection = getConnection();
    const walletPubkey = new PublicKey(wallet.address);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: walletPubkey,
        toPubkey: walletPubkey,
        lamports: 0,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = walletPubkey;

    const txBase64 = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64');
    const signedTxBase64 = await client.signTransaction(txBase64);

    const fee = (amountA * FEE_CONFIG.FEE_BPS) / 10000;

    return c.json({
      success: true,
      walletId,
      position: {
        pool: poolAddress,
        amountA,
        amountB: amountB || 0,
        binRange: binRange || [127, 133],
        estimatedFee: fee,
        treasury: FEE_CONFIG.TREASURY,
      },
      encrypted: encryptedStrategy ? {
        ciphertext: encryptedStrategy.ciphertext,
        algorithm: encryptedStrategy.algorithm,
        mxeCluster: encryptedStrategy.mxeCluster,
      } : null,
      transaction: {
        serialized: signedTxBase64,
        status: 'ready_to_broadcast',
        note: 'Demo transaction - production would use Meteora DLMM SDK',
      },
    });
  } catch (error: any) {
    const requestId = (c as any).get?.('requestId') as string | undefined;
    console.error(`[${requestId}] LP open error:`, error);
    const code = classifyError(error);
    const status = getHttpStatus(code);
    return c.json({
      success: false,
      error: createError(code, getFriendlyMessage(code), { originalError: error.message }, requestId),
    }, status as any);
  }
});

// Close LP position
app.post('/close', async (c) => {
  try {
    const body = await c.req.json();
    const { walletId, positionAddress } = body;

    if (!walletId) {
      return c.json({ error: 'Missing walletId' }, 400);
    }

    if (!positionAddress) {
      return c.json({ error: 'Missing positionAddress' }, 400);
    }

    const { wallet } = await loadWalletById(walletId);

    return c.json({
      success: true,
      walletId,
      walletAddress: wallet.address,
      message: 'Position close prepared',
      position: positionAddress,
      note: 'Demo - production would withdraw from Meteora DLMM',
    });
  } catch (error: any) {
    const requestId = (c as any).get?.('requestId') as string | undefined;
    console.error(`[${requestId}] LP close error:`, error);
    const code = classifyError(error);
    const status = getHttpStatus(code);
    return c.json({
      success: false,
      error: createError(code, getFriendlyMessage(code), { originalError: error.message }, requestId),
    }, status as any);
  }
});

// Execute LP pipeline handler
async function lpExecuteHandler(c: any) {
  try {
    const body = await c.req.json();
    const {
      walletId,
      poolAddress,
      amountSol = 0.1,
      minBinId = -10,
      maxBinId = 10,
      strategy = 'concentrated',
      shape = 'spot',
      tipSpeed = 'fast',
      slippageBps = 300,
    } = body;

    if (!walletId) {
      return c.json({
        error: 'Missing walletId',
        hint: 'First call POST /wallet/create, store the walletId, then pass it here',
        example: {
          walletId: 'abc123',
          poolAddress: '9Q1njS4j8svdjCnGd2xJn7RAkqrJ2vqjaPs3sXRZ6UR7',
          amountSol: 0.1,
          minBinId: -10,
          maxBinId: 10,
        }
      }, 400);
    }

    if (!poolAddress) {
      return c.json({
        error: 'Missing poolAddress',
        hint: 'Use /pools/scan to find available pools',
        example: {
          walletId: 'abc123',
          poolAddress: '9Q1njS4j8svdjCnGd2xJn7RAkqrJ2vqjaPs3sXRZ6UR7',
          amountSol: 0.1,
        }
      }, 400);
    }

    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    console.log(`[LP Execute] Opening position: ${amountSol} SOL in pool ${poolAddress}`);

    const result = await executeLp({
      walletId,
      walletAddress,
      poolAddress,
      amountSol,
      minBinId,
      maxBinId,
      strategy: strategy as 'concentrated' | 'wide' | 'custom',
      shape: shape as 'spot' | 'curve' | 'bidask',
      tipSpeed: tipSpeed as TipSpeed,
      slippageBps,
      signTransaction: async (tx: string) => {
        return withTimeout(
          () => client.signTransaction(tx),
          { timeoutMs: PRIVY_SIGN_TIMEOUT_MS, errorMessage: 'Wallet signing timed out. Please try again.' }
        );
      },
    });

    const { lpResult, bundleId, status } = result;

    if (typeof status === 'string') {
      // Direct RPC path (no Jito bundle)
      stats.actions.lpExecuted++;
      return c.json({
        success: true,
        message: `LP position opened with ${amountSol} SOL`,
        walletId,
        walletAddress,
        poolAddress,
        binRange: lpResult.binRange,
        txHashes: result.txHashes,
        encryptedStrategy: lpResult.encryptedStrategy,
      });
    }

    if (!status.landed) {
      return c.json({
        success: false,
        error: 'Bundle failed to land',
        bundleId,
        details: status.error,
      }, 500);
    }

    console.log(`[LP Execute] Position opened at slot ${status.slot}!`);

    stats.actions.lpExecuted++;
    return c.json({
      success: true,
      message: `LP position opened with ${amountSol} SOL`,
      walletId,
      walletAddress,
      poolAddress,
      binRange: lpResult.binRange,
      bundle: {
        bundleId,
        landed: status.landed,
        slot: status.slot,
      },
      encryptedStrategy: lpResult.encryptedStrategy,
    });
  } catch (error: any) {
    console.error('[LP Execute] Error:', error);
    stats.errors++;
    return c.json({ error: 'LP execute failed', details: error.message }, 500);
  }
}

app.post('/atomic', async (c) => lpExecuteHandler(c));
app.post('/execute', async (c) => lpExecuteHandler(c));

// Add liquidity to an existing position
app.post('/add', async (c) => {
  try {
    const body = await c.req.json();
    const { walletId, poolAddress, positionAddress, amountSol = 0.02, slippageBps = 300 } = body;

    if (!walletId || !poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing required fields',
        required: ['walletId', 'poolAddress', 'positionAddress'],
        optional: ['amountSol (default: 0.02)', 'slippageBps (default: 300)'],
      }, 400);
    }

    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;
    const connection = getConnection();

    // Instantiate MeteoraDirectClient
    const meteoraClient = new MeteoraDirectClient(connection.rpcEndpoint);

    const amountLamports = Math.floor(amountSol * 1e9);
    
    // Split equally between X and Y
    const halfAmount = Math.floor(amountLamports / 2);

    console.log(`[LP Add] Adding ${amountSol} SOL to position ${positionAddress}`);

    // Build add liquidity transaction
    const result = await meteoraClient.buildAddToExistingPositionTx({
      poolAddress,
      positionAddress,
      userPublicKey: walletAddress,
      amountX: halfAmount,
      amountY: halfAmount,
      slippageBps,
    });

    // Sign and send via Jito
    const signedTxs: string[] = [];
    for (const txBase64 of result.transactions) {
      const signedTx: string = await withTimeout(
        () => client.signTransaction(txBase64),
        { timeoutMs: PRIVY_SIGN_TIMEOUT_MS, errorMessage: 'Wallet signing timed out' }
      );
      signedTxs.push(signedTx);
    }

    // Add tip transaction
    const { blockhash } = await connection.getLatestBlockhash();
    const { transaction: tipTx } = buildTipTransaction({ 
      payerAddress: walletAddress, 
      recentBlockhash: blockhash, 
      speed: 'fast' as TipSpeed
    });
    const tipTxBase64 = Buffer.from(tipTx.serialize()).toString('base64');
    const signedTipTx: string = await withTimeout(
      () => client.signTransaction(tipTxBase64),
      { timeoutMs: PRIVY_SIGN_TIMEOUT_MS, errorMessage: 'Wallet signing timed out' }
    );
    signedTxs.push(signedTipTx);

    // Send bundle
    const { bundleId } = await sendBundle(signedTxs);
    const status = await waitForBundle(bundleId);

    if (!status.landed) {
      return c.json({
        success: false,
        error: 'Bundle failed to land',
        bundleId,
        details: status.error,
      }, 500);
    }

    // Invalidate position cache
    invalidatePositionCache(walletAddress);

    console.log(`[LP Add] Liquidity added at slot ${status.slot}`);

    return c.json({
      success: true,
      message: `Added ${amountSol} SOL to existing position`,
      walletId,
      walletAddress,
      poolAddress,
      positionAddress,
      binRange: result.binRange,
      bundle: {
        bundleId,
        landed: status.landed,
        slot: status.slot,
      },
    });
  } catch (error: any) {
    console.error('[LP Add] Error:', error);
    return c.json({ error: 'Add liquidity failed', details: error.message }, 500);
  }
});

app.post('/prepare', async (c) => {
  try {
    const body = await c.req.json();
    const { tokenA, tokenB, amount } = body;

    if (!tokenA || !tokenB || !amount) {
      return c.json({ error: 'Missing tokenA, tokenB, or amount' }, 400);
    }

    return c.json({
      success: true,
      ready: true,
      message: `Ready to LP $${amount} into ${tokenA}-${tokenB}`,
      pool: SAMPLE_POOLS[0],
      fee: amount * FEE_CONFIG.FEE_BPS / 10000,
    });
  } catch (error: any) {
    return c.json({ error: 'LP prepare failed', details: error.message }, 500);
  }
});

export default app;
