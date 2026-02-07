/**
 * Pool Routes - Pool discovery, scanning, top pools, risk
 */
import { Hono } from 'hono';
import { SAMPLE_POOLS, getTopPools } from '../services/pool-service.js';
import { assessPoolRisk } from '../risk/index.js';

const app = new Hono();

app.get('/scan', (c) => {
  const tokenA = c.req.query('tokenA') || 'SOL';
  const tokenB = c.req.query('tokenB') || 'USDC';
  const pools = SAMPLE_POOLS.filter(p =>
    p.tokens.includes(tokenA.toUpperCase()) &&
    p.tokens.includes(tokenB.toUpperCase())
  );
  return c.json({
    success: true,
    pair: `${tokenA}-${tokenB}`,
    count: pools.length,
    pools,
  });
});

app.get('/top', async (c) => {
  const limit = Math.min(20, parseInt(c.req.query('limit') || '5'));
  const riskMax = parseInt(c.req.query('riskMax') || '10');
  const minTvl = parseInt(c.req.query('minTvl') || '100000');
  const sortBy = c.req.query('sortBy') || 'sharpe';

  try {
    const result = await getTopPools({ limit, riskMax, minTvl, sortBy });

    return c.json({
      success: true,
      count: result.count,
      sortedBy: sortBy,
      filters: { riskMax, minTvl },
      pools: result.pools,
    });
  } catch (error: any) {
    console.error('Pool risk assessment error:', error);
    return c.json({ error: 'Failed to assess pools', details: error.message }, 500);
  }
});

app.get('/:address/risk', async (c) => {
  const poolAddress = c.req.param('address');

  try {
    const response = await fetch(`https://dlmm-api.meteora.ag/pair/${poolAddress}`);
    if (!response.ok) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    const pool = await response.json() as any;

    const nameParts = (pool.name || '').split('-');
    const tokenX = nameParts[0] || 'UNKNOWN';
    const tokenY = nameParts[1] || 'UNKNOWN';

    const assessment = await assessPoolRisk(
      pool.address,
      pool.name,
      parseFloat(pool.apr || pool.apy || 0),
      parseFloat(pool.liquidity || pool.tvl || 0),
      parseInt(pool.bin_step || pool.binStep || 10),
      parseFloat(pool.trade_volume_24h || pool.volume24h || 0),
      tokenX,
      tokenY
    );

    return c.json({
      success: true,
      assessment,
    });
  } catch (error: any) {
    return c.json({ error: 'Risk assessment failed', details: error.message }, 500);
  }
});

export default app;
