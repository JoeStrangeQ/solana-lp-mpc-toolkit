/**
 * Oracle Routes - Multi-oracle price aggregation endpoints
 */
import { Hono } from 'hono';
import { getAggregatedPrice, getAggregatedPrices } from '../services/oracle-service.js';

const app = new Hono();

/**
 * GET /oracle/price?mint=<address>
 * Get aggregated price for a single token.
 */
app.get('/price', async (c) => {
  const mint = c.req.query('mint');
  if (!mint) {
    return c.json({ error: 'Missing mint query parameter' }, 400);
  }

  try {
    const result = await getAggregatedPrice(mint);
    return c.json({
      mint,
      price: result.price,
      emaPrice: result.emaPrice,
      confidence: result.confidence,
      divergence: result.divergence,
      reliable: result.reliable,
      sources: result.sources.map((s) => ({
        source: s.source,
        price: s.price,
        stale: s.stale,
      })),
    });
  } catch (error: any) {
    return c.json({ error: 'Price fetch failed', details: error.message }, 500);
  }
});

/**
 * POST /oracle/prices { mints: ["addr1", "addr2"] }
 * Get aggregated prices for multiple tokens.
 */
app.post('/prices', async (c) => {
  try {
    const body = await c.req.json();
    const mints: string[] = body.mints;
    if (!Array.isArray(mints) || mints.length === 0) {
      return c.json({ error: 'Provide a non-empty mints array' }, 400);
    }
    if (mints.length > 20) {
      return c.json({ error: 'Maximum 20 mints per request' }, 400);
    }

    const results = await getAggregatedPrices(mints);
    const prices: Record<string, any> = {};
    for (const [mint, agg] of results) {
      prices[mint] = {
        price: agg.price,
        emaPrice: agg.emaPrice,
        confidence: agg.confidence,
        divergence: agg.divergence,
        reliable: agg.reliable,
        sourceCount: agg.sources.length,
      };
    }

    return c.json({ prices });
  } catch (error: any) {
    return c.json({ error: 'Prices fetch failed', details: error.message }, 500);
  }
});

export default app;
