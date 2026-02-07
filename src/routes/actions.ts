/**
 * Solana Actions & Blinks Routes
 *
 * Implements the Solana Actions specification for shareable, executable URLs.
 * Enables wallets and blink-aware clients to execute LP operations directly
 * from URLs shared on social media, chat, etc.
 *
 * Spec: https://docs.solana.com/developing/actions-and-blinks
 *
 * Endpoints:
 *   GET  /.well-known/actions.json  -> actions.json rules
 *   GET  /actions/lp                -> action metadata for LP
 *   POST /actions/lp                -> build LP transaction
 *   GET  /actions/swap              -> action metadata for swap
 *   POST /actions/swap              -> build swap transaction
 */

import { Hono } from 'hono';
import { TOKENS } from '../services/pool-service.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBaseUrl(c: any): string {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  const host = c.req.header('host') || 'localhost:3456';
  return host.includes('localhost') ? `http://${host}` : `https://${host}`;
}

// Solana Actions require specific CORS headers
function actionHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'X-Action-Version': '2.0',
    'X-Blockchain-Ids': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // mainnet-beta
  };
}

// ---------------------------------------------------------------------------
// /.well-known/actions.json
// ---------------------------------------------------------------------------

app.get('/.well-known/actions.json', (c) => {
  const baseUrl = getBaseUrl(c);
  return c.json({
    rules: [
      { pathPattern: '/actions/lp', apiPath: `${baseUrl}/actions/lp` },
      { pathPattern: '/actions/swap', apiPath: `${baseUrl}/actions/swap` },
      { pathPattern: '/actions/price', apiPath: `${baseUrl}/actions/price` },
    ],
  }, 200, actionHeaders());
});

// ---------------------------------------------------------------------------
// LP Action
// ---------------------------------------------------------------------------

app.get('/actions/lp', (c) => {
  const baseUrl = getBaseUrl(c);
  return c.json({
    type: 'action',
    icon: `${baseUrl}/icon.png`,
    title: 'Add Liquidity on Solana',
    description: 'Provide concentrated liquidity to Meteora DLMM pools with MPC-secured wallets and Arcium privacy.',
    label: 'Add Liquidity',
    links: {
      actions: [
        {
          label: 'LP into SOL-USDC (0.5 SOL)',
          href: `${baseUrl}/actions/lp?pool=SOL-USDC&amount=0.5`,
          type: 'transaction',
        },
        {
          label: 'LP into SOL-USDC (1 SOL)',
          href: `${baseUrl}/actions/lp?pool=SOL-USDC&amount=1`,
          type: 'transaction',
        },
        {
          label: 'Custom LP',
          href: `${baseUrl}/actions/lp?pool={pool}&amount={amount}`,
          type: 'transaction',
          parameters: [
            {
              name: 'pool',
              label: 'Pool pair (e.g. SOL-USDC)',
              required: true,
              type: 'text',
            },
            {
              name: 'amount',
              label: 'Amount in SOL',
              required: true,
              type: 'number',
            },
          ],
        },
      ],
    },
  }, 200, actionHeaders());
});

app.options('/actions/lp', (c) => {
  return c.text('', 200, actionHeaders());
});

app.post('/actions/lp', async (c) => {
  try {
    const body = await c.req.json();
    const account = body.account;
    if (!account) {
      return c.json({ error: 'Missing account in request body' }, 400, actionHeaders());
    }

    const pool = c.req.query('pool') || 'SOL-USDC';
    const amount = parseFloat(c.req.query('amount') || '0.5');

    if (amount <= 0 || amount > 100) {
      return c.json({ error: 'Amount must be between 0 and 100 SOL' }, 400, actionHeaders());
    }

    // Call internal LP endpoint
    const baseUrl = getBaseUrl(c);
    const resp = await fetch(`${baseUrl}/lp/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: account,
        poolPair: pool,
        amount,
        strategy: 'concentrated',
      }),
    });

    const result = await resp.json() as any;

    if (result.unsignedTransactions?.length > 0) {
      // Return the first transaction for the blink to sign
      return c.json({
        type: 'transaction',
        transaction: result.unsignedTransactions[0],
        message: `Adding ${amount} SOL liquidity to ${pool}`,
      }, 200, actionHeaders());
    }

    // Fallback: return info about the LP action
    return c.json({
      type: 'message',
      message: `LP prepared for ${pool} with ${amount} SOL. Use the full API at ${baseUrl}/lp/execute for execution.`,
    }, 200, actionHeaders());
  } catch (error: any) {
    return c.json({
      type: 'message',
      message: `LP action failed: ${error.message}`,
    }, 500, actionHeaders());
  }
});

// ---------------------------------------------------------------------------
// Swap Action
// ---------------------------------------------------------------------------

app.get('/actions/swap', (c) => {
  const baseUrl = getBaseUrl(c);
  return c.json({
    type: 'action',
    icon: `${baseUrl}/icon.png`,
    title: 'MEV-Protected Swap on Solana',
    description: 'Swap tokens using Jupiter Ultra V3 with MEV protection. No sandwich attacks.',
    label: 'Swap',
    links: {
      actions: [
        {
          label: 'Swap SOL to USDC',
          href: `${baseUrl}/actions/swap?from=SOL&to=USDC&amount={amount}`,
          type: 'transaction',
          parameters: [
            {
              name: 'amount',
              label: 'Amount in SOL',
              required: true,
              type: 'number',
            },
          ],
        },
        {
          label: 'Custom Swap',
          href: `${baseUrl}/actions/swap?from={from}&to={to}&amount={amount}`,
          type: 'transaction',
          parameters: [
            {
              name: 'from',
              label: 'From token (e.g. SOL)',
              required: true,
              type: 'text',
            },
            {
              name: 'to',
              label: 'To token (e.g. USDC)',
              required: true,
              type: 'text',
            },
            {
              name: 'amount',
              label: 'Amount',
              required: true,
              type: 'number',
            },
          ],
        },
      ],
    },
  }, 200, actionHeaders());
});

app.options('/actions/swap', (c) => {
  return c.text('', 200, actionHeaders());
});

app.post('/actions/swap', async (c) => {
  try {
    const body = await c.req.json();
    const account = body.account;
    if (!account) {
      return c.json({ error: 'Missing account in request body' }, 400, actionHeaders());
    }

    const from = c.req.query('from') || 'SOL';
    const to = c.req.query('to') || 'USDC';
    const amount = parseFloat(c.req.query('amount') || '0');

    if (amount <= 0) {
      return c.json({ error: 'Amount must be positive' }, 400, actionHeaders());
    }

    const inputMint = TOKENS[from.toUpperCase()] || from;
    const outputMint = TOKENS[to.toUpperCase()] || to;

    // Use Ultra swap for MEV protection
    const baseUrl = getBaseUrl(c);
    const resp = await fetch(`${baseUrl}/ultra/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputToken: inputMint,
        outputToken: outputMint,
        amount: Math.floor(amount * 1e9), // Convert SOL to lamports
        walletAddress: account,
      }),
    });

    const result = await resp.json() as any;

    if (result.unsignedTransaction) {
      return c.json({
        type: 'transaction',
        transaction: result.unsignedTransaction,
        message: `Swapping ${amount} ${from} to ${to} (MEV-protected)`,
      }, 200, actionHeaders());
    }

    return c.json({
      type: 'message',
      message: `Swap prepared: ${amount} ${from} -> ${to}. Use the full API at ${baseUrl}/ultra/order for execution.`,
    }, 200, actionHeaders());
  } catch (error: any) {
    return c.json({
      type: 'message',
      message: `Swap action failed: ${error.message}`,
    }, 500, actionHeaders());
  }
});

// ---------------------------------------------------------------------------
// Price Action (read-only)
// ---------------------------------------------------------------------------

app.get('/actions/price', (c) => {
  const baseUrl = getBaseUrl(c);
  return c.json({
    type: 'action',
    icon: `${baseUrl}/icon.png`,
    title: 'Solana Token Price',
    description: 'Get real-time aggregated prices from Pyth and Jupiter oracles.',
    label: 'Check Price',
    disabled: false,
    links: {
      actions: [
        {
          label: 'Check SOL Price',
          href: `${baseUrl}/actions/price?token=SOL`,
          type: 'message',
        },
        {
          label: 'Check Token Price',
          href: `${baseUrl}/actions/price?token={token}`,
          type: 'message',
          parameters: [
            {
              name: 'token',
              label: 'Token symbol (e.g. SOL, USDC, JUP)',
              required: true,
              type: 'text',
            },
          ],
        },
      ],
    },
  }, 200, actionHeaders());
});

app.options('/actions/price', (c) => {
  return c.text('', 200, actionHeaders());
});

app.post('/actions/price', async (c) => {
  try {
    const token = c.req.query('token') || 'SOL';
    const mint = TOKENS[token.toUpperCase()] || token;

    const baseUrl = getBaseUrl(c);
    const resp = await fetch(`${baseUrl}/oracle/price?mint=${mint}`);
    const result = await resp.json() as any;

    if (result.price) {
      const sources = result.sources?.map((s: any) => `${s.source}: $${s.price}`).join(', ') || 'N/A';
      return c.json({
        type: 'message',
        message: `${token.toUpperCase()} Price: $${result.price.toFixed(4)}\nConfidence: ±$${result.confidence?.toFixed(6) || '0'}\nSources: ${sources}\nReliable: ${result.reliable ? 'Yes' : 'No'}`,
      }, 200, actionHeaders());
    }

    return c.json({
      type: 'message',
      message: `Could not fetch price for ${token}`,
    }, 200, actionHeaders());
  } catch (error: any) {
    return c.json({
      type: 'message',
      message: `Price check failed: ${error.message}`,
    }, 500, actionHeaders());
  }
});

export default app;
