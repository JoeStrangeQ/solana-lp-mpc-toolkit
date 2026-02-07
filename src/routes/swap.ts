/**
 * Swap Routes - Jupiter swap endpoints
 */
import { Hono } from 'hono';
import { TOKENS, FEE_CONFIG } from '../services/pool-service.js';

const app = new Hono();

app.get('/tokens', (c) => {
  return c.json({
    tokens: TOKENS,
    description: 'Well-known token mints. Use symbol (SOL, USDC) or full mint address.',
  });
});

app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { inputToken, outputToken, amount } = body;

    if (!inputToken || !outputToken || !amount) {
      return c.json({ error: 'Missing inputToken, outputToken, or amount' }, 400);
    }

    const inputMint = TOKENS[inputToken.toUpperCase()] || inputToken;
    const outputMint = TOKENS[outputToken.toUpperCase()] || outputToken;

    return c.json({
      success: true,
      message: `Swap prepared: ${amount} ${inputToken} -> ${outputToken}`,
      data: {
        inputMint,
        outputMint,
        amount,
        estimatedOutput: amount * 150,
        fee: amount * FEE_CONFIG.FEE_BPS / 10000,
        route: 'Jupiter Aggregator',
      },
      note: 'Demo mode - production executes via Jupiter',
    });
  } catch (error: any) {
    return c.json({ error: 'Swap failed', details: error.message }, 500);
  }
});

app.get('/quote', async (c) => {
  const inputToken = c.req.query('inputToken') || c.req.query('inputMint');
  const outputToken = c.req.query('outputToken') || c.req.query('outputMint');
  const amount = c.req.query('amount');

  if (!inputToken || !outputToken || !amount) {
    return c.json({ error: 'Missing inputToken, outputToken, or amount' }, 400);
  }

  const inputMint = TOKENS[inputToken.toUpperCase()] || inputToken;
  const outputMint = TOKENS[outputToken.toUpperCase()] || outputToken;

  return c.json({
    success: true,
    quote: {
      inputMint,
      outputMint,
      inAmount: amount,
      outAmount: parseFloat(amount) * 150,
      priceImpact: '0.01%',
      route: 'Jupiter',
    },
  });
});

export default app;
