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

// Helper to detect if a string is a Solana address (base58, ~32-44 chars)
function isSolanaAddress(str: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(str);
}

// Get positions by walletId OR wallet address
app.get('/:walletIdOrAddress', async (c) => {
  const param = c.req.param('walletIdOrAddress');

  // Check if this might be a "risk" sub-path
  if (param === 'risk') {
    return c.notFound();
  }

  try {
    let walletAddress: string;
    let walletId: string | undefined;

    // If it looks like a Solana address, use it directly
    if (isSolanaAddress(param)) {
      walletAddress = param;
    } else {
      // Otherwise, treat as Privy wallet ID and look up the address
      const { wallet } = await loadWalletById(param);
      walletAddress = wallet.address;
      walletId = param;
    }

    const positions = await getPositionsForWallet(walletAddress);

    return c.json({
      success: true,
      message: `Found ${positions.length} positions across Meteora and Orca`,
      data: {
        ...(walletId && { walletId }),
        walletAddress,
        positions,
        totalPositions: positions.length,
      },
      note: 'Multi-DEX discovery - finds positions in Meteora DLMM and Orca Whirlpools',
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch positions', details: error.message }, 500);
  }
});

// Risk assessment for all positions of a wallet
app.get('/:walletIdOrAddress/risk', async (c) => {
  const param = c.req.param('walletIdOrAddress');

  try {
    let walletAddress: string;
    let walletId: string | undefined;

    if (isSolanaAddress(param)) {
      walletAddress = param;
    } else {
      const { wallet } = await loadWalletById(param);
      walletAddress = wallet.address;
      walletId = param;
    }

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
      ...(walletId && { walletId }),
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
        message: `Found ${positions.length} positions across Meteora and Orca`,
        data: {
          walletAddress,
          positions,
          totalPositions: positions.length,
        },
        note: 'Multi-DEX discovery - finds positions in Meteora DLMM and Orca Whirlpools',
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to fetch positions', details: error.message }, 500);
    }
  });

  return posApp;
}
