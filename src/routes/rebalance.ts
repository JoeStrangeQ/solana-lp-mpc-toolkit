/**
 * Rebalance Routes - Position rebalancing operations
 */
import { Hono } from 'hono';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import { loadWalletById } from '../services/wallet-service.js';
import { executeRebalanceOperation, invalidatePositionCache } from '../services/lp-service.js';
import { stats } from '../services/stats.js';
import { config } from '../config/index.js';
import { resolveTokens, calculateHumanPriceRange, formatPriceRange, formatPrice } from '../utils/token-metadata.js';
import { buildAtomicWithdraw } from '../lp/atomicWithdraw.js';
import type { TipSpeed } from '../jito/index.js';

const app = new Hono();

// Prepare rebalance (analyze + build withdrawal)
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletId,
      poolAddress,
      positionAddress,
      newLowerBin,
      newUpperBin,
      strategy = 'concentrated',
      shape = 'spot',
      tipSpeed = 'fast',
      slippageBps = 300,
    } = body;

    if (!walletId) {
      return c.json({ error: 'Missing walletId', hint: 'First call POST /wallet/create' }, 400);
    }

    if (!poolAddress || !positionAddress) {
      return c.json({
        error: 'Missing poolAddress or positionAddress',
        hint: 'Get these from GET /positions/:walletId',
      }, 400);
    }

    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const pool = await DLMM.create(conn, new PublicKey(poolAddress));
    const userPubkey = new PublicKey(walletAddress);
    const positions = await pool.getPositionsByUserAndLbPair(userPubkey);

    const position = positions.userPositions.find(
      (p: any) => p.publicKey.toBase58() === positionAddress
    );

    if (!position) {
      return c.json({ error: 'Position not found' }, 404);
    }

    const binStep = Number(pool.lbPair.binStep);
    const activeBin = await pool.getActiveBin();
    const tokenXMint = pool.tokenX.publicKey.toBase58();
    const tokenYMint = pool.tokenY.publicKey.toBase58();

    const tokenMetadata = await resolveTokens([tokenXMint, tokenYMint]);
    const tokenX = tokenMetadata.get(tokenXMint);
    const tokenY = tokenMetadata.get(tokenYMint);

    const currentLower = position.positionData.lowerBinId;
    const currentUpper = position.positionData.upperBinId;
    const currentPrice = Number(activeBin.pricePerToken);

    const currentPriceRange = calculateHumanPriceRange(
      currentLower, currentUpper, activeBin.binId, currentPrice, binStep
    );

    let targetLower = newLowerBin !== undefined ? activeBin.binId + newLowerBin : currentLower;
    let targetUpper = newUpperBin !== undefined ? activeBin.binId + newUpperBin : currentUpper;

    if (newLowerBin === undefined && newUpperBin === undefined) {
      if (strategy === 'wide') {
        targetLower = activeBin.binId - 20;
        targetUpper = activeBin.binId + 20;
      } else {
        targetLower = activeBin.binId - 5;
        targetUpper = activeBin.binId + 5;
      }
    }

    const newPriceRange = calculateHumanPriceRange(
      targetLower, targetUpper, activeBin.binId, currentPrice, binStep
    );

    const withdrawResult = await buildAtomicWithdraw({
      walletAddress,
      poolAddress,
      positionAddress,
      tipSpeed: tipSpeed as TipSpeed,
    });

    stats.actions.lpWithdrawn++;

    return c.json({
      success: true,
      message: 'Rebalance prepared',
      walletId,
      walletAddress,
      currentPosition: {
        address: positionAddress,
        binRange: { lower: currentLower, upper: currentUpper },
        priceRange: {
          priceLower: currentPriceRange.priceLower,
          priceUpper: currentPriceRange.priceUpper,
          display: formatPriceRange(currentPriceRange.priceLower, currentPriceRange.priceUpper, tokenY?.symbol || 'Y', tokenX?.symbol || 'X'),
        },
        inRange: currentPriceRange.inRange,
      },
      newPosition: {
        binRange: { lower: targetLower, upper: targetUpper },
        priceRange: {
          priceLower: newPriceRange.priceLower,
          priceUpper: newPriceRange.priceUpper,
          display: formatPriceRange(newPriceRange.priceLower, newPriceRange.priceUpper, tokenY?.symbol || 'Y', tokenX?.symbol || 'X'),
        },
        strategy,
        shape,
      },
      pool: {
        address: poolAddress,
        binStep,
        tokenX: { mint: tokenXMint, symbol: tokenX?.symbol || 'Unknown' },
        tokenY: { mint: tokenYMint, symbol: tokenY?.symbol || 'Unknown' },
        activeBinId: activeBin.binId,
        currentPrice,
        displayPrice: `${formatPrice(currentPrice)} ${tokenY?.symbol || 'Unknown'} per ${tokenX?.symbol || 'Unknown'}`,
      },
      withdraw: {
        transactions: withdrawResult.unsignedTransactions,
        estimatedWithdraw: withdrawResult.estimatedWithdraw,
        fee: withdrawResult.fee,
      },
      reentry: {
        hint: 'After withdraw lands, call POST /lp/execute with the withdrawn funds',
        params: {
          walletId,
          poolAddress,
          strategy,
          shape,
          minBinId: targetLower - activeBin.binId,
          maxBinId: targetUpper - activeBin.binId,
          tipSpeed,
          slippageBps,
        },
      },
      note: 'Sign withdraw transactions with Privy, submit via Jito, then execute re-entry',
    });
  } catch (error: any) {
    console.error('[Rebalance] Error:', error);
    stats.errors++;
    return c.json({ error: 'Rebalance failed', details: error.message }, 500);
  }
});

// Execute resilient rebalance
app.post('/execute', async (c) => {
  try {
    const body = await c.req.json();
    const {
      walletId,
      poolAddress,
      positionAddress,
      newMinBinOffset = -5,
      newMaxBinOffset = 5,
      strategy = 'concentrated',
      shape = 'spot',
      tipSpeed = 'fast',
      slippageBps = 300,
    } = body;

    if (!walletId || !poolAddress || !positionAddress) {
      return c.json({ error: 'Missing walletId, poolAddress, or positionAddress' }, 400);
    }

    const { client, wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    const result = await executeRebalanceOperation({
      walletId,
      walletAddress,
      poolAddress,
      positionAddress,
      newMinBinOffset,
      newMaxBinOffset,
      strategy: strategy as 'concentrated' | 'wide',
      shape: shape as 'spot' | 'curve' | 'bidask',
      tipSpeed: tipSpeed as TipSpeed,
      slippageBps,
      signTransaction: async (tx: string) => {
        try {
          return await client.signTransaction(tx);
        } catch {
          return tx;
        }
      },
    });

    stats.actions.lpExecuted++;

    return c.json({
      success: result.success,
      message: result.success
        ? 'Rebalance completed successfully!'
        : `Rebalance ${result.phase1.status === 'success' ? 'partial' : 'failed'}: ${result.recoveryHint}`,
      walletId,
      walletAddress,
      phase1: result.phase1,
      phase2: result.phase2,
      oldPosition: result.oldPosition,
      newPosition: result.newPosition,
      tokensInWallet: result.tokensInWallet,
      recoveryHint: result.recoveryHint,
    });
  } catch (error: any) {
    console.error('[Rebalance Execute] Error:', error);
    stats.errors++;
    return c.json({ error: 'Rebalance execution failed', details: error.message }, 500);
  }
});

export default app;
