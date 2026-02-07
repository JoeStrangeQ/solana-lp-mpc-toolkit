/**
 * Ultra Swap Routes - Jupiter Ultra V3 MEV-protected swap endpoints
 */
import { Hono } from 'hono';
import {
  createUltraOrder,
  executeUltraOrder,
  type UltraOrderParams,
} from '../services/ultra-swap.js';
import { TOKENS } from '../services/pool-service.js';

const app = new Hono();

/**
 * POST /ultra/order
 * Create a MEV-protected swap order. Returns unsigned transaction for signing.
 *
 * Body: { inputToken, outputToken, amount, walletAddress, slippageBps? }
 */
app.post('/order', async (c) => {
  try {
    const body = await c.req.json();
    const { inputToken, outputToken, amount, walletAddress, slippageBps } = body;

    if (!inputToken || !outputToken || !amount || !walletAddress) {
      return c.json(
        { error: 'Missing inputToken, outputToken, amount, or walletAddress' },
        400,
      );
    }

    const inputMint = TOKENS[inputToken.toUpperCase()] || inputToken;
    const outputMint = TOKENS[outputToken.toUpperCase()] || outputToken;

    const params: UltraOrderParams = {
      inputMint,
      outputMint,
      amount: parseInt(amount),
      taker: walletAddress,
      slippageBps: slippageBps ? parseInt(slippageBps) : undefined,
    };

    const order = await createUltraOrder(params);
    return c.json({
      success: true,
      requestId: order.requestId,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      priceImpact: order.priceImpactPct,
      slippageBps: order.slippageBps,
      unsignedTransaction: order.transaction,
      expiresAt: order.expiresAt,
      note: 'Sign the transaction and POST to /ultra/execute',
    });
  } catch (error: any) {
    return c.json({ error: 'Ultra order failed', details: error.message }, 500);
  }
});

/**
 * POST /ultra/execute
 * Execute a signed Ultra order.
 *
 * Body: { requestId, signedTransaction }
 */
app.post('/execute', async (c) => {
  try {
    const body = await c.req.json();
    const { requestId, signedTransaction } = body;

    if (!requestId || !signedTransaction) {
      return c.json(
        { error: 'Missing requestId or signedTransaction' },
        400,
      );
    }

    const result = await executeUltraOrder({ requestId, signedTransaction });
    return c.json({
      success: true,
      signature: result.signature,
      status: result.status,
      inputAmount: result.inputAmount,
      outputAmount: result.outputAmount,
    });
  } catch (error: any) {
    return c.json({ error: 'Ultra execute failed', details: error.message }, 500);
  }
});

export default app;
