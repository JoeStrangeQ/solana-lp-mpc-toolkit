/**
 * Position Routes - Position listing, monitoring, risk assessment
 */
import { Hono } from 'hono';
import { Connection, PublicKey } from '@solana/web3.js';
import { loadWalletById } from '../services/wallet-service.js';
import { getPositionsForWallet } from '../services/lp-service.js';
import { config } from '../config/index.js';
import { discoverAllPositions } from '../utils/position-discovery.js';
import { assessPositionRisk } from '../risk/index.js';

const app = new Hono();

// Get positions by walletId
app.get('/:walletId', async (c) => {
  const walletId = c.req.param('walletId');

  // Check if this might be a "risk" sub-path
  if (walletId === 'risk') {
    return c.notFound();
  }

  try {
    const { wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    const positions = await getPositionsForWallet(walletAddress);

    return c.json({
      success: true,
      message: `Found ${positions.length} positions across all DLMM pools`,
      data: {
        walletId,
        walletAddress,
        positions,
        totalPositions: positions.length,
      },
      note: 'Universal discovery - no hardcoded pool list, finds positions in ANY Meteora DLMM pool',
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch positions', details: error.message }, 500);
  }
});

// Risk assessment for all positions of a wallet
app.get('/:walletId/risk', async (c) => {
  const walletId = c.req.param('walletId');

  try {
    const { wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;

    const connection = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    const positions = await discoverAllPositions(connection, walletAddress);

    if (positions.length === 0) {
      return c.json({
        success: true,
        message: 'No positions found',
        assessments: [],
      });
    }

    const assessmentPromises = positions.map(async (pos) => {
      const tokenX = pos.pool.tokenX.symbol || 'UNKNOWN';

      return assessPositionRisk(
        pos.address,
        pos.pool.address,
        pos.pool.name || 'Unknown Pool',
        pos.activeBinId,
        pos.binRange.lower,
        pos.binRange.upper,
        pos.inRange ? undefined : new Date().toISOString(),
        tokenX
      );
    });

    const assessments = await Promise.all(assessmentPromises);
    assessments.sort((a, b) => a.healthScore - b.healthScore);

    return c.json({
      success: true,
      walletId,
      walletAddress,
      totalPositions: positions.length,
      assessments,
      summary: {
        critical: assessments.filter(a => a.urgency === 'critical').length,
        high: assessments.filter(a => a.urgency === 'high').length,
        medium: assessments.filter(a => a.urgency === 'medium').length,
        low: assessments.filter(a => a.urgency === 'low').length,
      },
    });
  } catch (error: any) {
    return c.json({ error: 'Position risk assessment failed', details: error.message }, 500);
  }
});

export default app;

/**
 * Positions query by address (mounted at root level as GET /positions)
 */
export function positionsByAddress() {
  const posApp = new Hono();

  posApp.get('/', async (c) => {
    const walletAddress = c.req.query('address') || c.req.query('walletAddress');

    if (!walletAddress) {
      return c.json({
        success: false,
        error: 'Missing wallet address',
        hint: 'Use GET /positions?address=YOUR_WALLET_ADDRESS or GET /positions/:walletId',
        example: 'GET /positions?address=Ab6Cuvz9rZUSb4uVbBGR6vm12LeuVBE5dzKsnYUtAEi4',
      });
    }

    try {
      const positions = await getPositionsForWallet(walletAddress);

      return c.json({
        success: true,
        message: `Found ${positions.length} positions across all DLMM pools`,
        data: {
          walletAddress,
          positions,
          totalPositions: positions.length,
        },
        note: 'Universal discovery - no hardcoded pool list, finds positions in ANY Meteora DLMM pool',
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to fetch positions', details: error.message }, 500);
    }
  });

  return posApp;
}
