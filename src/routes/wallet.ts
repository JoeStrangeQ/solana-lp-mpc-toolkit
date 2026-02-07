/**
 * Wallet Routes - Creation, balance, token operations
 */
import { Hono } from 'hono';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPrivyClient, loadWalletById, getConnection } from '../services/wallet-service.js';
import { stats } from '../services/stats.js';
import { config } from '../config/index.js';

const app = new Hono();

// Create new wallet
app.post('/create', async (c) => {
  const client = await createPrivyClient();
  if (!client) {
    stats.errors++;
    return c.json({ error: 'Privy not available', hint: 'Check PRIVY_APP_ID and PRIVY_APP_SECRET env vars' }, 503);
  }
  try {
    const wallet = await client.generateWallet();
    stats.actions.walletsCreated++;
    return c.json({
      success: true,
      wallet: {
        id: wallet.id,
        address: wallet.addresses.solana,
        provider: 'privy',
      },
      hint: 'Store walletId - pass it in all future requests',
    });
  } catch (error: any) {
    stats.errors++;
    return c.json({ error: 'Wallet creation failed', details: error.message }, 500);
  }
});

// Get wallet info by ID
app.get('/:walletId', async (c) => {
  const walletId = c.req.param('walletId');
  try {
    const { wallet } = await loadWalletById(walletId);
    return c.json({
      success: true,
      wallet: {
        id: wallet.id,
        address: wallet.address,
        provider: 'privy',
      },
    });
  } catch (error: any) {
    return c.json({ error: 'Wallet not found', details: error.message }, 404);
  }
});

// Get balance by walletId
app.get('/:walletId/balance', async (c) => {
  const walletId = c.req.param('walletId');
  try {
    const { wallet } = await loadWalletById(walletId);
    const connection = getConnection();
    const balance = await connection.getBalance(new PublicKey(wallet.address));
    return c.json({
      success: true,
      walletId,
      address: wallet.address,
      balance: {
        lamports: balance,
        sol: balance / LAMPORTS_PER_SOL,
      },
    });
  } catch (error: any) {
    return c.json({ error: 'Balance check failed', details: error.message }, 500);
  }
});

// Swap all tokens to SOL
app.post('/:walletId/swap-all-to-sol', async (c) => {
  const walletId = c.req.param('walletId');

  try {
    const { wallet } = await loadWalletById(walletId);
    const walletAddress = wallet.address;
    const connection = getConnection();

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(walletAddress),
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );

    const swaps: Array<{ from: string; to: string; amount: string; mint: string; symbol?: string; error?: string }> = [];
    const errors: string[] = [];
    const SOL_MINT = 'So11111111111111111111111111111111111111112';

    const KNOWN_TOKENS: Record<string, string> = {
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
      'METADDFL6wWMWEoKTFJwcThTbUmtarRJZjRpzUvkxhr': 'MET',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    };

    for (const account of tokenAccounts.value) {
      const info = account.account.data.parsed.info;
      const mint = info.mint;
      const amount = info.tokenAmount.uiAmount;
      const symbol = KNOWN_TOKENS[mint] || mint.slice(0, 8) + '...';

      if (!amount || amount === 0) continue;
      if (mint === SOL_MINT) continue;

      try {
        const jupiterApiKey = process.env.JUPITER_API_KEY;
        const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${info.tokenAmount.amount}&slippageBps=300`;

        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (jupiterApiKey) {
          headers['x-api-key'] = jupiterApiKey;
        }

        const quoteResp = await fetch(quoteUrl, { headers });

        if (!quoteResp.ok) {
          const errText = await quoteResp.text();
          errors.push(`${symbol}: Quote failed (${quoteResp.status})`);
          swaps.push({ from: `${amount} ${symbol}`, to: 'SOL', amount: '0', mint, symbol, error: `Quote failed: ${quoteResp.status}` });
          continue;
        }

        const quote = await quoteResp.json() as any;

        if (quote.error) {
          errors.push(`${symbol}: ${quote.error}`);
          swaps.push({ from: `${amount} ${symbol}`, to: 'SOL', amount: '0', mint, symbol, error: quote.error });
          continue;
        }

        const outAmountSol = (quote.outAmount / LAMPORTS_PER_SOL).toFixed(6);
        swaps.push({ from: `${amount} ${symbol}`, to: 'SOL', amount: outAmountSol, mint, symbol });
      } catch (e: any) {
        const errMsg = e?.cause?.message || e?.message || String(e);
        const errCode = e?.cause?.code || e?.code || 'unknown';
        errors.push(`${symbol}: ${errMsg} (${errCode})`);
        swaps.push({ from: `${amount} ${symbol}`, to: 'SOL', amount: '0', mint, symbol, error: `${errMsg} (${errCode})` });
      }
    }

    const successfulSwaps = swaps.filter(s => !s.error);
    const failedSwaps = swaps.filter(s => s.error);

    return c.json({
      success: true,
      message: successfulSwaps.length > 0
        ? `Found ${successfulSwaps.length} token(s) to swap`
        : 'No swappable tokens found',
      tokensFound: tokenAccounts.value.length,
      swaps: successfulSwaps,
      failed: failedSwaps,
      errors: errors.length > 0 ? errors : undefined,
      note: 'Swap execution via Jito coming soon - this shows what would be swapped',
    });
  } catch (error: any) {
    return c.json({ error: 'Swap failed', details: error.message }, 500);
  }
});

export default app;
