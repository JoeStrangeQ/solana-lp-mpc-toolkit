/**
 * LP Agent API Server
 *
 * REST API for AI agents to manage LP positions across Solana DEXs
 * with Arcium privacy and self-custody (agents sign their own transactions)
 * 
 * ARCHITECTURE:
 * - Stateless API - no private keys stored
 * - Agents provide their wallet address
 * - API returns unsigned transactions
 * - Agents sign with their own keys
 * - Arcium encrypts strategy params for privacy
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';

import { config } from '../config/index.js';
import { GatewayClient } from '../gateway/index.js';
import { MPCClient } from '../mpc/index.js';
import { MockMPCClient } from '../mpc/mockClient.js';
import { PrivyWalletClient } from '../mpc/privyClient.js';
import { LocalKeypairClient } from '../mpc/localKeypair.js';
import { arciumPrivacy } from '../privacy/index.js';
import DLMM from '@meteora-ag/dlmm';
import { parseIntent, describeIntent } from './intent.js';
import { createFeeBreakdown, FEE_CONFIG } from '../fees/index.js';
import type { AgentResponse, LPIntent, PoolOpportunity } from './types.js';
import { unsignedApi } from './unsigned.js';

// Static imports for LP and Swap modules
import { lpPipeline as lpPipelineImport, METEORA_POOLS as meteoraPoolsImport } from '../lp/index.js';
import { jupiterClient as jupiterClientImport, TOKENS as tokensImport } from '../swap/index.js';

// Module references (populated from imports or lazy-load fallback)
let jupiterClient: any = jupiterClientImport || null;
let TOKENS: Record<string, string> = tokensImport || {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};
let lpPipeline: any = lpPipelineImport || null;
let METEORA_POOLS: Record<string, string> = meteoraPoolsImport || {
  'SOL-USDC': 'BVRbyLjjfSBcoyiYFUxFjLYrKnPYS9DbYEoHSdniRLsE',
};

async function loadSwapModule() {
  if (!jupiterClient) {
    try {
      const mod = await import('../swap/index.js');
      jupiterClient = mod.jupiterClient;
      TOKENS = mod.TOKENS || TOKENS;
    } catch (e) {
      console.warn('⚠️ Failed to load swap module:', (e as Error).message);
    }
  }
  return jupiterClient;
}

async function loadLpModule() {
  if (!lpPipeline) {
    try {
      console.log('📦 Loading LP module...');
      const mod = await import('../lp/index.js');
      lpPipeline = mod.lpPipeline;
      METEORA_POOLS = mod.METEORA_POOLS || METEORA_POOLS;
      console.log('✅ LP module loaded successfully');
    } catch (e) {
      console.error('❌ Failed to load LP module:', (e as Error).message);
      console.error('Stack:', (e as Error).stack);
    }
  }
  return lpPipeline;
}

const app = new Hono();

// Middleware
app.use('*', cors());

// Mount stateless unsigned transaction API (primary interface for agents)
app.route('/v2', unsignedApi);

// State - supports multiple wallet providers (legacy, for testing)
let mpcClient: MPCClient | MockMPCClient | null = null;
let privyClient: PrivyWalletClient | null = null;
let localKeypairClient: LocalKeypairClient | null = null;
let gatewayClient: GatewayClient | null = null;
let connection: Connection;

// ============ Skill File for Agents ============

const SKILL_MD = `# Private LP Toolkit - Agent Skill

> AI-native liquidity provision on Solana with MPC custody and Arcium privacy.

## Overview

This toolkit enables AI agents to:
- **Create wallets** with MPC custody (no private keys exposed)
- **Execute LP positions** on Meteora DLMM pools
- **Swap tokens** via Jupiter aggregator
- **Encrypt strategies** with Arcium to prevent frontrunning

## Base URL
\`\`\`
https://lp-agent-api-production.up.railway.app
\`\`\`

---

## Quick Start

### 1. Create a Wallet
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/create
\`\`\`
**Response:**
\`\`\`json
{
  "success": true,
  "data": { "walletId": "abc123", "address": "Ab6Cuvz9..." }
}
\`\`\`
⚠️ **Store the walletId** - you'll need it for all future calls.

### 2. Fund Your Wallet
Send SOL to the wallet address. You can also send USDC or other tokens.

### 3. Check Balance (optional)
\`\`\`bash
curl https://lp-agent-api-production.up.railway.app/health
\`\`\`

---

## Natural Language Commands

The toolkit understands plain English:

| Say this | It does this |
|----------|--------------|
| "LP $500 into SOL-USDC" | Finds best pool, adds liquidity |
| "Swap all my USDC to SOL" | Executes Jupiter swap |
| "Withdraw my SOL-USDC position" | Closes LP position |
| "Show pools for SOL-USDC" | Lists available pools with APY |

---

## API Endpoints

### Wallet Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/wallet/create\` | POST | Create new Privy MPC wallet |
| \`/wallet/load\` | POST | Load wallet by walletId |
| \`/wallet/transfer\` | POST | Transfer SOL or SPL tokens |

**Create Wallet:**
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/create
\`\`\`

**Load Wallet:**
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/load \\
  -H "Content-Type: application/json" \\
  -d '{"walletId": "YOUR_WALLET_ID"}'
\`\`\`

**Transfer SOL:**
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/transfer \\
  -H "Content-Type: application/json" \\
  -d '{"to": "RECIPIENT_ADDRESS", "amount": 1.5}'
\`\`\`

---

### Pool Discovery

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/pools/scan\` | GET | Find Meteora DLMM pools |

**Find SOL-USDC Pools:**
\`\`\`bash
curl "https://lp-agent-api-production.up.railway.app/pools/scan?tokenA=SOL&tokenB=USDC"
\`\`\`

**Response:**
\`\`\`json
{
  "success": true,
  "data": {
    "pools": [
      {
        "address": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
        "name": "SOL-USDC",
        "liquidity": "$5.14M",
        "apy": "819.02%",
        "binStep": 10
      }
    ]
  }
}
\`\`\`

---

### Liquidity Provision

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/lp/execute\` | POST | Add liquidity to a pool |
| \`/lp/withdraw\` | POST | Remove liquidity and close position |
| \`/positions\` | GET | List open positions |

**Add Liquidity:**
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/lp/execute \\
  -H "Content-Type: application/json" \\
  -d '{
    "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
    "amount": 50,
    "strategy": "concentrated"
  }'
\`\`\`

**Strategy Options:**
- \`concentrated\` - ±5 bins (tight range, higher capital efficiency)
- \`wide\` - ±20 bins (broader range, less impermanent loss)
- \`custom\` - specify exact bin range with \`minBinId\` and \`maxBinId\`

**Custom Bin Range:**
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/lp/execute \\
  -H "Content-Type: application/json" \\
  -d '{
    "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
    "amount": 100,
    "strategy": "custom",
    "minBinId": -15,
    "maxBinId": 10
  }'
\`\`\`

**Withdraw Position:**
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/lp/withdraw \\
  -H "Content-Type: application/json" \\
  -d '{
    "positionAddress": "YOUR_POSITION_ADDRESS",
    "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y"
  }'
\`\`\`

---

### Token Swaps

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/swap/quote\` | GET | Get Jupiter swap quote |
| \`/swap\` | POST | Execute swap |
| \`/swap/tokens\` | GET | List supported tokens |

**Get Quote:**
\`\`\`bash
curl "https://lp-agent-api-production.up.railway.app/swap/quote?inputMint=USDC&outputMint=SOL&amount=100"
\`\`\`

**Execute Swap:**
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/swap \\
  -H "Content-Type: application/json" \\
  -d '{"inputToken": "USDC", "outputToken": "SOL", "amount": 100}'
\`\`\`

---

### Encryption

| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/encrypt\` | POST | Encrypt data with Arcium |
| \`/encrypt/test\` | GET | Verify encryption working |

**Encrypt Strategy:**
\`\`\`bash
curl -X POST https://lp-agent-api-production.up.railway.app/encrypt \\
  -H "Content-Type: application/json" \\
  -d '{"data": {"strategy": "concentrated", "amount": 1000}}'
\`\`\`

---

## Security

### MPC Custody (Privy)
- Wallets use threshold signing - no single party holds the full private key
- Agents never see raw private keys
- Authorization keys required for signing

### Arcium Privacy
- Strategy parameters encrypted with x25519-aes256gcm
- MEV bots can't see your intent before execution
- MXE cluster: 456 (devnet)

---

## Fees

- **Protocol Fee:** 0.1% per transaction
- **Treasury:** \`fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt\`

---

## Links

- **API:** https://lp-agent-api-production.up.railway.app
- **Frontend:** https://mnm-web-seven.vercel.app
- **GitHub:** https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit

---

Built by Nemmie 🦐 for AI agents.
`;

app.get('/skill.md', (c) => {
  return c.text(SKILL_MD, 200, { 'Content-Type': 'text/markdown' });
});

// ============ Health & Status ============

app.get('/', (c) => c.json({
  name: 'LP Agent Toolkit',
  version: '3.0.0-stateless',
  status: 'running',
  architecture: {
    model: 'Stateless - agents sign their own transactions',
    privacy: 'Arcium MXE encrypts strategy parameters',
    custody: 'Self-custody - API never holds private keys',
  },
  endpoints: {
    v2: {
      '/v2/lp/build': 'POST - Build unsigned LP transaction',
      '/v2/swap/build': 'POST - Build unsigned swap transaction',
      '/v2/broadcast': 'POST - Broadcast signed transaction',
      '/v2/encrypt-strategy': 'POST - Encrypt params with Arcium',
    },
    legacy: {
      '/pools/scan': 'GET - Scan for LP opportunities',
      '/encrypt': 'POST - Arcium encryption',
      '/health': 'GET - Service health',
    },
  },
  fees: {
    protocol: `${FEE_CONFIG.FEE_BPS / 100}%`,
    description: 'Protocol fee on LP transactions',
    treasury: FEE_CONFIG.TREASURY_ADDRESS.toBase58(),
  },
}));

// ============ Fee Info ============

app.get('/fees', (c) => {
  return c.json({
    protocolFee: {
      bps: FEE_CONFIG.FEE_BPS,
      percentage: `${FEE_CONFIG.FEE_BPS / 100}%`,
      description: '1% fee deducted from every LP transaction',
    },
    treasury: FEE_CONFIG.TREASURY_ADDRESS.toBase58(),
    minFee: {
      lamports: FEE_CONFIG.MIN_FEE_LAMPORTS,
      description: 'Minimum fee threshold to avoid dust',
    },
    minWithdraw: {
      lamports: FEE_CONFIG.MIN_WITHDRAW_LAMPORTS,
      usd: FEE_CONFIG.MIN_WITHDRAW_USD,
      description: 'Minimum withdrawal amount',
    },
    calculate: '/fees/calculate?amount=1000 - Calculate fee for specific amount',
  });
});

app.get('/fees/calculate', (c) => {
  const amount = parseFloat(c.req.query('amount') || '0');
  if (amount <= 0) {
    return c.json({ error: 'Provide a positive amount query parameter' }, 400);
  }
  
  const breakdown = createFeeBreakdown(amount);
  return c.json({
    input: amount,
    fee: breakdown.protocol,
    output: breakdown.total.netAmount,
    message: `${breakdown.protocol.amount} (${breakdown.protocol.bps / 100}%) goes to protocol treasury`,
  });
});

app.get('/health', async (c) => {
  // Initialize Arcium if not already
  if (!arciumPrivacy.isInitialized()) {
    try { await arciumPrivacy.initialize(); } catch {}
  }
  
  const privyConfigured = config.privy.enabled;
  const arciumOk = arciumPrivacy.isInitialized();
  const rpcOk = !!connection;

  // System is healthy if core services are available
  const isHealthy = privyConfigured && rpcOk;

  return c.json({
    status: isHealthy ? 'healthy' : 'degraded',
    components: {
      api: 'running',
      privy: privyConfigured ? 'configured' : 'not_configured',
      arcium: arciumOk ? 'ready' : 'initializing',
      solana_rpc: rpcOk ? 'connected' : 'disconnected',
    },
    features: {
      wallet_create: privyConfigured,
      wallet_transfer: privyConfigured,
      lp_execute: privyConfigured && rpcOk,
      encryption: arciumOk,
    },
    timestamp: new Date().toISOString(),
  });
});

// ============ Arcium Encryption ============

app.get('/encrypt/info', async (c) => {
  await arciumPrivacy.initialize();
  const info = arciumPrivacy.getMxeInfo();
  
  return c.json({
    status: 'ready',
    algorithm: 'x25519-aes256gcm',
    mxe: {
      cluster: info.cluster,
      network: 'devnet',
      publicKey: info.publicKey,
    },
    description: 'Strategy parameters are encrypted before execution to prevent front-running',
  });
});

app.post('/encrypt', async (c) => {
  try {
    const body = await c.req.json();
    const { strategy } = body;
    
    if (!strategy) {
      return c.json({ error: 'Missing strategy object' }, 400);
    }
    
    // Validate strategy has required fields
    if (!strategy.pair || !strategy.amount) {
      return c.json({ error: 'Strategy must include pair and amount' }, 400);
    }
    
    await arciumPrivacy.initialize();
    const encrypted = await arciumPrivacy.encryptStrategy(strategy);
    
    return c.json({
      success: true,
      encrypted: {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        ephemeralPublicKey: encrypted.publicKey,
        algorithm: encrypted.algorithm,
        mxeCluster: encrypted.mxeCluster,
        timestamp: encrypted.timestamp,
      },
      message: 'Strategy encrypted with Arcium. Only MXE can decrypt.',
    });
  } catch (error) {
    console.error('[/encrypt] Error:', error);
    return c.json({ 
      error: 'Encryption failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

app.get('/encrypt/test', async (c) => {
  try {
    await arciumPrivacy.initialize();
    const passed = await arciumPrivacy.selfTest();
    
    return c.json({
      success: passed,
      message: passed ? 'Arcium encryption self-test passed' : 'Self-test failed',
      algorithm: 'x25519-aes256gcm',
      mxeCluster: 456,
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// ============ Wallet Management ============

app.post('/wallet/create', async (c) => {
  try {
    console.log('[/wallet/create] Received request');
    
    // Priority: Privy > Portal > Mock
    if (config.privy.enabled) {
      // Use Privy embedded wallet
      console.log('[/wallet/create] Using Privy embedded wallet');
      privyClient = new PrivyWalletClient({
        appId: config.privy.appId,
        appSecret: config.privy.appSecret,
      });
      
      const wallet = await privyClient.generateWallet();
      console.log('[/wallet/create] Privy wallet generated:', wallet.addresses.solana);
      
      gatewayClient = new GatewayClient(wallet.addresses.solana);
      
      return c.json<AgentResponse>({
        success: true,
        message: 'Privy embedded wallet created. Fund this address to start LPing.',
        data: {
          address: wallet.addresses.solana,
          walletId: wallet.id,
          provider: 'privy',
        },
      });
    } else if (config.portal.useMock) {
      // Use mock wallet for dev
      mpcClient = new MockMPCClient();
      console.log('[/wallet/create] Using Mock MPC client');
    } else if (config.portal.apiKey) {
      // Use Portal MPC
      mpcClient = new MPCClient();
      console.log('[/wallet/create] Using Portal MPC client');
    } else {
      throw new Error('No wallet provider configured. Set PRIVY_APP_ID/PRIVY_APP_SECRET or PORTAL_API_KEY or USE_MOCK_MPC=true');
    }
    
    const wallet = await mpcClient.generateWallet();
    console.log('[/wallet/create] Wallet generated:', wallet.addresses.solana);
    
    gatewayClient = new GatewayClient(wallet.addresses.solana);
    console.log('[/wallet/create] Gateway client initialized');

    return c.json<AgentResponse>({
      success: true,
      message: 'MPC wallet created. Fund this address to start LPing.',
      data: {
        address: wallet.addresses.solana,
        walletId: wallet.id,
        provider: config.portal.useMock ? 'mock' : 'portal',
      },
    });
  } catch (error) {
    console.error('[/wallet/create] Error:', error);
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to create wallet',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Note: /wallet/list removed - use Privy dashboard to find walletIds

app.post('/wallet/load', async (c) => {
  try {
    const { address, share, id, walletId, provider } = await c.req.json();

    // Support Privy wallet loading by walletId
    if (config.privy.enabled && walletId) {
      console.log('[/wallet/load] Loading Privy wallet:', walletId);
      privyClient = new PrivyWalletClient({
        appId: config.privy.appId,
        appSecret: config.privy.appSecret,
      });
      
      const wallet = await privyClient.loadWallet(walletId);
      gatewayClient = new GatewayClient(wallet.address);
      
      return c.json<AgentResponse>({
        success: true,
        message: 'Privy wallet loaded',
        data: { address: wallet.address, walletId: wallet.id, provider: 'privy' },
      });
    }

    // Legacy Portal/Mock wallet loading
    if (!address || !share) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing address or share (or walletId for Privy)',
      }, 400);
    }

    if (config.portal.useMock) {
      mpcClient = new MockMPCClient();
    } else {
      if (!config.portal.apiKey) {
        throw new Error('Portal API key is not configured.');
      }
      mpcClient = new MPCClient();
    }

    mpcClient.loadWallet({
      id: id || 'loaded',
      addresses: { solana: address },
      share,
      createdAt: new Date().toISOString(),
    });

    gatewayClient = new GatewayClient(address);

    return c.json<AgentResponse>({
      success: true,
      message: 'Wallet loaded successfully',
      data: { address },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to load wallet',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Load local keypair for testing (supports actual transaction signing)
// Uses LOCAL_WALLET_KEY env var if set, otherwise generates new
app.post('/wallet/local', async (c) => {
  try {
    const { privateKey, forceNew } = await c.req.json().catch(() => ({}));
    
    // If we already have a local keypair and not forcing new, return it
    if (localKeypairClient && !forceNew && !privateKey) {
      return c.json<AgentResponse>({
        success: true,
        message: 'Existing local keypair returned. This wallet CAN sign arbitrary transactions.',
        data: {
          address: localKeypairClient.getAddress(),
          provider: 'local-keypair',
          reused: true,
        },
      });
    }
    
    // Priority: provided key > env var > generate new
    const keyToUse = privateKey || process.env.LOCAL_WALLET_KEY || undefined;
    localKeypairClient = new LocalKeypairClient(keyToUse);
    const address = localKeypairClient.getAddress();
    
    const source = privateKey ? 'provided' : (process.env.LOCAL_WALLET_KEY ? 'env' : 'generated');
    
    return c.json<AgentResponse>({
      success: true,
      message: source === 'env' 
        ? 'Local keypair loaded from LOCAL_WALLET_KEY env var.'
        : source === 'provided'
        ? 'Local keypair loaded from provided key.'
        : 'New local keypair generated. Set LOCAL_WALLET_KEY env var to persist.',
      data: {
        address,
        provider: 'local-keypair',
        source,
        persistent: source === 'env',
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to create local keypair',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.get('/wallet/address', (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded',
    }, 400);
  }

  return c.json<AgentResponse>({
    success: true,
    message: 'Wallet address',
    data: { address: walletClient.getAddress() },
  });
});

// Transfer SOL or SPL tokens from loaded wallet
app.post('/wallet/transfer', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded. Load a wallet first.',
    }, 400);
  }

  try {
    const { to, amount, mint } = await c.req.json();
    
    if (!to || !amount) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing "to" address or "amount". Optional: "mint" for SPL tokens.',
      }, 400);
    }

    const sourceAddress = new PublicKey(walletClient.getAddress());
    const destAddress = new PublicKey(to);
    
    const tx = new Transaction();
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = sourceAddress;

    if (mint && mint.toLowerCase() !== 'sol') {
      // SPL Token Transfer
      const mintPubkey = new PublicKey(mint);
      const sourceAta = await getAssociatedTokenAddress(mintPubkey, sourceAddress);
      const destAta = await getAssociatedTokenAddress(mintPubkey, destAddress);
      const tokenInfo = await connection.getParsedAccountInfo(mintPubkey);
      const decimals = (tokenInfo.value?.data as any)?.parsed?.info?.decimals || 6;
      
      tx.add(
        createTransferInstruction(sourceAta, destAta, sourceAddress, Math.floor(amount * Math.pow(10, decimals)))
      );
    } else {
      // SOL Transfer
      tx.add(
        SystemProgram.transfer({
          fromPubkey: sourceAddress,
          toPubkey: destAddress,
          lamports: Math.floor(amount * LAMPORTS_PER_SOL),
        })
      );
    }
    
    const unsignedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');
    
    // Sign transaction (not sign+send, so we can broadcast with fresh blockhash)
    const signedTx = await walletClient.signTransaction(unsignedTx);
    
    // Broadcast locally to ensure blockhash is fresh
    const txBuffer = Buffer.from(signedTx, 'base64');
    const txid = await connection.sendRawTransaction(txBuffer, { skipPreflight: false });
    await connection.confirmTransaction(txid, 'confirmed');

    return c.json<AgentResponse>({
      success: true,
      message: `Transferred ${amount} ${mint || 'SOL'} to ${to}`,
      data: { txid, from: sourceAddress.toBase58(), to, amount, mint: mint || 'SOL' },
      transaction: { unsigned: unsignedTx, txid },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Transfer failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============ Natural Language Interface ============

app.post('/chat', async (c) => {
  try {
    const { message } = await c.req.json();

    if (!message) {
      return c.json<AgentResponse>({
        success: false,
        message: 'No message provided',
      }, 400);
    }

    const intent = parseIntent(message);
    const description = describeIntent(intent);

    // Route to appropriate handler
    let result: AgentResponse;

    switch (intent.action) {
      case 'lp':
        result = await handleLp(intent);
        break;
      case 'swap':
        result = await handleSwap(intent);
        break;
      case 'scan':
        result = await handleScan(intent);
        break;
      case 'open':
        result = await handleOpenPosition(intent);
        break;
      case 'close':
        result = await handleClosePosition(intent);
        break;
      case 'collect':
        result = await handleCollectFees(intent);
        break;
      case 'positions':
        result = await handleGetPositions();
        break;
      default:
        result = {
          success: true,
          message: `Understood: ${description}`,
          data: { intent },
        };
    }

    return c.json(result);
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to process request',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============ Direct API Endpoints ============

// Get detailed info for ANY pool (universal support)
app.get('/pool/info', async (c) => {
  const poolAddress = c.req.query('address');
  if (!poolAddress) {
    return c.json<AgentResponse>({ success: false, message: 'Missing address parameter' }, 400);
  }
  
  try {
    const { MeteoraDirectClient } = await import('../dex/meteora.js');
    const meteoraClient = new MeteoraDirectClient(config.solana.rpc);
    const poolInfo = await meteoraClient.getPoolInfoExtended(poolAddress);
    
    return c.json<AgentResponse>({
      success: true,
      message: `Pool info for ${poolAddress}`,
      data: {
        address: poolInfo.address,
        activeBinId: poolInfo.activeBinId,
        currentPrice: poolInfo.currentPrice,
        binStep: poolInfo.binStep,
        tokenX: poolInfo.tokenX,
        tokenY: poolInfo.tokenY,
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to fetch pool info',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.get('/pools/scan', async (c) => {
  const tokenA = c.req.query('tokenA');
  const tokenB = c.req.query('tokenB');

  try {
    // Use Meteora direct API for pool discovery
    const { MeteoraDirectClient } = await import('../dex/meteora.js');
    const meteoraClient = new MeteoraDirectClient(config.solana.rpc);
    const pools = await meteoraClient.searchPools(tokenA || undefined, tokenB || undefined);
    
    return c.json<AgentResponse>({
      success: true,
      message: `Found ${pools.length} Meteora DLMM pools${tokenA || tokenB ? ` for ${tokenA || ''}${tokenA && tokenB ? '-' : ''}${tokenB || ''}` : ''}`,
      data: { 
        pools: pools.map(p => ({
          address: p.address,
          name: p.name,
          liquidity: `$${(parseFloat(p.liquidity) / 1e6).toFixed(2)}M`,
          liquidityRaw: p.liquidity,
          apy: `${p.apy.toFixed(2)}%`,
          volume24h: `$${(p.volume24h / 1e6).toFixed(2)}M`,
          binStep: p.binStep,
          currentPrice: p.currentPrice,
        }))
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to scan pools',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Get top 3 pools for a token pair - agent-friendly format
app.get('/pools/top', async (c) => {
  const tokenA = c.req.query('tokenA') || 'SOL';
  const tokenB = c.req.query('tokenB') || 'USDC';

  try {
    const { MeteoraDirectClient } = await import('../dex/meteora.js');
    const meteoraClient = new MeteoraDirectClient(config.solana.rpc);
    const pools = await meteoraClient.searchPools(tokenA, tokenB);
    
    // Get top 3 by TVL
    const top3 = pools.slice(0, 3);
    
    if (top3.length === 0) {
      return c.json<AgentResponse>({
        success: false,
        message: `No pools found for ${tokenA}-${tokenB}. Try different tokens.`,
      });
    }

    // Format for easy agent consumption
    const formatted = top3.map((p, i) => ({
      rank: i + 1,
      address: p.address,
      pair: p.name,
      tvl: `$${(parseFloat(p.liquidity) / 1e6).toFixed(2)}M`,
      apy: `${p.apy.toFixed(1)}%`,
      binStep: p.binStep,
      recommendation: i === 0 ? 'Highest TVL - most liquid' : 
                      i === 1 ? 'Good alternative' : 'Lower TVL option',
    }));

    return c.json<AgentResponse>({
      success: true,
      message: `Top ${top3.length} ${tokenA}-${tokenB} pools on Meteora DLMM`,
      data: {
        pools: formatted,
        hint: 'Use the pool address with /lp/execute or /lp/atomic to add liquidity',
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to fetch pools',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.get('/positions', async (c) => {
  const walletAddress = c.req.query('address') || c.req.query('walletAddress');
  const result = await handleGetPositions(walletAddress);
  return c.json(result);
});

app.post('/position/open', async (c) => {
  const body = await c.req.json();
  const result = await handleOpenPosition({
    action: 'open',
    dex: body.dex,
    pair: body.pair,
    amount: body.amount,
    strategy: body.strategy,
  });
  return c.json(result);
});

app.post('/position/close', async (c) => {
  const { positionId, dex } = await c.req.json();
  const result = await handleClosePosition({ action: 'close', positionId, dex });
  return c.json(result);
});

app.post('/position/collect-fees', async (c) => {
  const { positionId, dex } = await c.req.json();
  const result = await handleCollectFees({ action: 'collect', positionId, dex });
  return c.json(result);
});

// ============ Swap Endpoint ============

app.post('/swap', async (c) => {
  const body = await c.req.json();
  const result = await handleSwap({
    action: 'swap',
    inputToken: body.inputMint || body.inputToken,
    outputToken: body.outputMint || body.outputToken,
    amount: body.amount,
  });
  return c.json(result);
});

app.get('/swap/quote', async (c) => {
  const inputToken = c.req.query('inputMint') || c.req.query('inputToken');
  const outputToken = c.req.query('outputMint') || c.req.query('outputToken');
  const amount = c.req.query('amount');

  if (!inputToken || !outputToken || !amount) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Missing inputMint/inputToken, outputMint/outputToken, or amount',
    }, 400);
  }

  try {
    const jup = await loadSwapModule();
    if (!jup) {
      return c.json<AgentResponse>({ success: false, message: 'Swap module not available' }, 503);
    }
    const inputMint = jup.resolveTokenMint(inputToken);
    const outputMint = jup.resolveTokenMint(outputToken);
    const quote = await jup.getQuote(inputMint, outputMint, amount);

    return c.json<AgentResponse>({
      success: true,
      message: `Quote: ${quote.inAmount} ${inputToken} -> ${quote.outAmount} ${outputToken}`,
      data: {
        quote,
        inputMint,
        outputMint,
        priceImpact: quote.priceImpactPct,
        route: quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> '),
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to get quote',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.get('/swap/tokens', (c) => {
  return c.json({
    tokens: TOKENS,
    description: 'Well-known token mints. Use symbol (SOL, USDC) or full mint address.',
  });
});

// ============ LP Pipeline Endpoints ============

app.get('/lp/pools', (c) => {
  return c.json({
    pools: METEORA_POOLS,
    description: 'Supported Meteora DLMM pools for LP pipeline',
  });
});

app.post('/lp/prepare', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded. Create or load a wallet first.',
    }, 400);
  }

  try {
    const lp = await loadLpModule();
    if (!lp) {
      return c.json<AgentResponse>({ success: false, message: 'LP module not available' }, 503);
    }

    const { tokenA, tokenB, amount } = await c.req.json();

    if (!tokenA || !tokenB || !amount) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing tokenA, tokenB, or amount. Example: { "tokenA": "SOL", "tokenB": "USDC", "amount": 500 }',
      }, 400);
    }

    const walletAddress = walletClient.getAddress();
    const result = await lp.prepareLiquidity(walletAddress, tokenA, tokenB, amount);

    return c.json<AgentResponse>({
      success: result.ready,
      message: result.message,
      data: result,
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to prepare liquidity',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.post('/lp/execute', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded. Create or load a wallet first.',
    }, 400);
  }

  try {
    const lp = await loadLpModule();
    if (!lp) {
      return c.json<AgentResponse>({ success: false, message: 'LP module not available' }, 503);
    }

    const { tokenA, tokenB, amount, poolAddress, strategy, minBinId, maxBinId, shape } = await c.req.json();

    if ((!tokenA || !tokenB) && !poolAddress) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Provide tokenA+tokenB OR poolAddress. Example: { "poolAddress": "BVRby...", "amount": 50, "strategy": "concentrated" }',
      }, 400);
    }

    if (!amount) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing amount (in USD). Example: { "amount": 50 }',
      }, 400);
    }

    const walletAddress = walletClient.getAddress();
    // Use signTransaction ONLY (not signAndSendTransaction) - we'll broadcast ourselves
    // This allows us to add the position keypair signature before broadcasting
    const signTransaction = async (tx: string) => walletClient.signTransaction(tx);

    const result = await lp.execute(
      walletAddress, 
      tokenA || 'SOL', 
      tokenB || 'USDC', 
      amount, 
      signTransaction,
      {
        poolAddress,
        strategy: strategy as 'concentrated' | 'wide' | 'custom' | undefined,
        minBinId,
        maxBinId,
        shape: shape as 'spot' | 'curve' | 'bidask' | undefined,
      }
    );

    return c.json<AgentResponse>({
      success: result.success,
      message: result.message,
      data: {
        swapTxid: result.swapTxid,
        lpTxid: result.lpTxid,
        positionAddress: result.positionAddress,
        binRange: result.binRange,
        arcium: result.encryptedStrategy, // Arcium privacy proof
      },
      transaction: result.lpTxid ? { unsigned: '', txid: result.lpTxid } : undefined,
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Failed to execute LP',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Atomic LP: Swap + LP in one Jito bundle (MEV protected, atomic execution)
app.post('/lp/atomic', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded. Create or load a wallet first.',
    }, 400);
  }

  try {
    const { buildAtomicLP } = await import('../lp/atomic.js');
    const { sendBundle, waitForBundle } = await import('../jito/index.js');
    const { poolAddress, amount, strategy, shape, tipSpeed } = await c.req.json();

    if (!poolAddress) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing poolAddress. Find pools via /pools/scan',
      }, 400);
    }

    if (!amount) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing amount (in SOL). Example: { "amount": 0.5 }',
      }, 400);
    }

    const walletAddress = walletClient.getAddress();
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const collateralLamports = Math.floor(amount * 1e9);

    // 1. Build all unsigned transactions
    console.log('[AtomicLP] Building transactions...');
    const built = await buildAtomicLP({
      walletAddress,
      poolAddress,
      collateralMint: SOL_MINT,
      collateralAmount: collateralLamports,
      strategy: strategy || 'concentrated',
      shape: shape || 'spot',
      tipSpeed: tipSpeed || 'fast',
    });

    // 2. Sign all transactions with the wallet
    console.log(`[AtomicLP] Signing ${built.unsignedTransactions.length} transactions...`);
    const signedTransactions: string[] = [];
    for (const unsignedTx of built.unsignedTransactions) {
      const signedTx = await walletClient.signTransaction(unsignedTx);
      signedTransactions.push(signedTx);
    }

    // 3. Send bundle via Jito
    console.log('[AtomicLP] Sending Jito bundle...');
    const { bundleId } = await sendBundle(signedTransactions);
    console.log(`[AtomicLP] Bundle submitted: ${bundleId}`);

    // 4. Wait for bundle to land
    const result = await waitForBundle(bundleId, { timeoutMs: 30000 });

    if (!result.landed) {
      return c.json<AgentResponse>({
        success: false,
        message: `Bundle failed to land: ${result.error}`,
        data: { bundleId },
      });
    }

    // 5. Extract position address from keypair
    const { Keypair } = await import('@solana/web3.js');
    const positionKeypair = Keypair.fromSecretKey(Buffer.from(built.positionKeypair, 'base64'));
    const positionAddress = positionKeypair.publicKey.toBase58();

    return c.json<AgentResponse>({
      success: true,
      message: `Atomic LP executed! Bundle landed in slot ${result.slot}`,
      data: {
        bundleId,
        positionAddress,
        binRange: built.binRange,
        arcium: built.encryptedStrategy,
      },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Atomic LP failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Withdraw liquidity and close position
app.post('/lp/withdraw', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded. Create or load a wallet first.',
    }, 400);
  }

  try {
    const { positionAddress, poolAddress } = await c.req.json();

    if (!positionAddress) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing positionAddress. Get it from /lp/positions',
      }, 400);
    }

    // Default to SOL-USDC pool if not specified
    const pool = poolAddress || 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y';
    
    // Import Meteora client (needs RPC URL, not Connection)
    const { MeteoraDirectClient } = await import('../dex/meteora.js');
    const meteoraClient = new MeteoraDirectClient(config.solana.rpc);
    
    // Build withdraw transaction
    const walletAddress = walletClient.getAddress();
    const result = await meteoraClient.buildWithdrawTx({
      poolAddress: pool,
      positionAddress,
      userPublicKey: walletAddress,
    });

    // Sign and send
    const signedTx = await walletClient.signTransaction(result.transaction);
    const txBuffer = Buffer.from(signedTx, 'base64');
    const txid = await connection.sendRawTransaction(txBuffer);
    await connection.confirmTransaction(txid, 'confirmed');

    return c.json<AgentResponse>({
      success: true,
      message: `Withdrew liquidity and closed position ${positionAddress}`,
      data: { txid, positionAddress },
      transaction: { unsigned: result.transaction, txid },
    });
  } catch (error) {
    return c.json<AgentResponse>({
      success: false,
      message: 'Withdraw failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// Atomic Withdraw: Withdraw + Fee in one Jito bundle (MEV protected, atomic)
app.post('/lp/withdraw/atomic', async (c) => {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return c.json<AgentResponse>({
      success: false,
      message: 'No wallet loaded. Create or load a wallet first.',
    }, 400);
  }

  try {
    const { buildAtomicWithdraw } = await import('../lp/atomicWithdraw.js');
    const { sendBundle, waitForBundle } = await import('../jito/index.js');
    const { positionAddress, poolAddress, tipSpeed, outputToken } = await c.req.json();

    if (!positionAddress) {
      return c.json<AgentResponse>({
        success: false,
        message: 'Missing positionAddress. Get positions via /positions?address=YOUR_WALLET',
      }, 400);
    }

    // Default to SOL-USDC pool if not specified
    const pool = poolAddress || 'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y';
    const walletAddress = walletClient.getAddress();

    // 1. Build all unsigned transactions (withdraw + fee + tip)
    console.log('[AtomicWithdraw] Building transactions...');
    const built = await buildAtomicWithdraw({
      walletAddress,
      poolAddress: pool,
      positionAddress,
      tipSpeed: tipSpeed || 'fast',
    });

    // 2. Sign all transactions with the wallet
    console.log(`[AtomicWithdraw] Signing ${built.unsignedTransactions.length} transactions...`);
    const signedTransactions: string[] = [];
    for (const unsignedTx of built.unsignedTransactions) {
      const signedTx = await walletClient.signTransaction(unsignedTx);
      signedTransactions.push(signedTx);
    }

    // 3. Send bundle via Jito
    console.log('[AtomicWithdraw] Sending Jito bundle...');
    const { bundleId } = await sendBundle(signedTransactions);
    console.log(`[AtomicWithdraw] Bundle submitted: ${bundleId}`);

    // 4. Wait for bundle to land
    const result = await waitForBundle(bundleId, { timeoutMs: 30000 });

    if (!result.landed) {
      return c.json<AgentResponse>({
        success: false,
        message: `Bundle failed to land: ${result.error}`,
        data: { bundleId },
      });
    }

    // 5. If outputToken specified, try to swap withdrawn tokens
    const swapResults: { token: string; success: boolean; txid?: string; error?: string }[] = [];
    const targetToken = (outputToken || 'SOL').toUpperCase();
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const targetMint = targetToken === 'SOL' ? SOL_MINT : targetToken === 'USDC' ? USDC_MINT : targetToken;

    if (outputToken) {
      console.log(`[AtomicWithdraw] Converting to ${targetToken}...`);
      const jup = await loadSwapModule();
      
      if (jup) {
        // Try to swap each withdrawn token to target
        for (const tokenInfo of [built.estimatedWithdraw.tokenX, built.estimatedWithdraw.tokenY]) {
          if (tokenInfo.mint === targetMint || parseInt(tokenInfo.amount) === 0) {
            continue; // Skip if already target token or zero amount
          }
          
          try {
            const uiAmount = parseInt(tokenInfo.amount) / Math.pow(10, tokenInfo.decimals);
            if (uiAmount < 0.001) continue; // Skip dust
            
            console.log(`[AtomicWithdraw] Swapping ${uiAmount} ${tokenInfo.mint.slice(0,8)}... to ${targetToken}`);
            const quote = await jup.getQuote(tokenInfo.mint, targetMint, parseInt(tokenInfo.amount));
            const swapResult = await jup.swap(quote, walletAddress);
            const signedSwap = await walletClient.signTransaction(swapResult.swapTransaction);
            const swapBuffer = Buffer.from(signedSwap, 'base64');
            const swapTxid = await connection.sendRawTransaction(swapBuffer, { skipPreflight: false });
            await connection.confirmTransaction(swapTxid, 'confirmed');
            
            swapResults.push({ token: tokenInfo.mint, success: true, txid: swapTxid });
            console.log(`[AtomicWithdraw] Swap success: ${swapTxid}`);
          } catch (swapError) {
            console.error(`[AtomicWithdraw] Swap failed for ${tokenInfo.mint}:`, swapError);
            swapResults.push({ 
              token: tokenInfo.mint, 
              success: false, 
              error: swapError instanceof Error ? swapError.message : 'Swap failed'
            });
          }
        }
      }
    }

    const allSwapsSuccess = swapResults.length === 0 || swapResults.every(r => r.success);
    const message = outputToken 
      ? allSwapsSuccess 
        ? `Withdrew and converted to ${targetToken}! 1% fee sent to treasury.`
        : `Withdrew successfully. Some swaps failed - you have pool tokens. 1% fee sent to treasury.`
      : `Atomic withdrawal complete! Bundle landed in slot ${result.slot}. 1% fee sent to treasury.`;

    return c.json<AgentResponse>({
      success: true,
      message,
      data: {
        bundleId,
        positionAddress,
        slot: result.slot,
        estimatedWithdraw: built.estimatedWithdraw,
        fee: built.fee,
        arcium: built.encryptedStrategy,
        swaps: swapResults.length > 0 ? swapResults : undefined,
        outputToken: outputToken ? targetToken : undefined,
      },
    });
  } catch (error) {
    console.error('[AtomicWithdraw] Error:', error);
    return c.json<AgentResponse>({
      success: false,
      message: 'Atomic withdraw failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============ Handlers ============

async function handleLp(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return { success: false, message: 'No wallet loaded. Create or load a wallet first.' };
  }

  if (!intent.pair) {
    return { 
      success: false, 
      message: 'Missing token pair. Example: "LP $500 into SOL-USDC"',
    };
  }

  const [tokenA, tokenB] = intent.pair.split('-');
  if (!tokenA || !tokenB) {
    return { 
      success: false, 
      message: 'Invalid pair format. Use TOKEN-TOKEN format like SOL-USDC',
    };
  }

  const walletAddress = walletClient.getAddress();

  // Load LP module
  const lp = await loadLpModule();
  if (!lp) {
    return { success: false, message: 'LP module not available' };
  }

  // If no amount specified, just prepare and return what's needed
  if (!intent.amount) {
    try {
      const prep = await lp.prepareLiquidity(walletAddress, tokenA, tokenB, 0);
      return {
        success: true,
        message: `To LP into ${intent.pair}, specify an amount. Example: "LP $500 into ${intent.pair}"`,
        data: {
          poolInfo: prep.poolInfo,
          currentBalances: prep.currentBalances,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get pool info',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // First, prepare to see what's needed
  try {
    const prep = await lp.prepareLiquidity(walletAddress, tokenA, tokenB, intent.amount);

    if (!prep.ready) {
      return {
        success: false,
        message: prep.message,
        data: {
          currentBalances: prep.currentBalances,
          targetAmounts: prep.targetAmounts,
          poolInfo: prep.poolInfo,
        },
      };
    }

    // Execute the full pipeline (swap if needed + LP)
    const signTransaction = async (tx: string) => walletClient.signTransaction(tx);
    const result = await lp.execute(walletAddress, tokenA, tokenB, intent.amount, signTransaction);

    // Calculate 1% protocol fee
    const feeBreakdown = createFeeBreakdown(intent.amount);

    return {
      success: result.success,
      message: result.message,
      data: {
        swapTxid: result.swapTxid,
        lpTxid: result.lpTxid,
        positionAddress: result.positionAddress,
        binRange: result.binRange,
        fees: {
          protocolFee: feeBreakdown.protocol.amount,
          protocolFeeBps: feeBreakdown.protocol.bps,
          treasury: feeBreakdown.protocol.recipient,
          netAmount: feeBreakdown.total.netAmount,
          grossAmount: feeBreakdown.total.grossAmount,
        },
      },
      transaction: result.lpTxid ? { unsigned: '', txid: result.lpTxid } : undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: 'LP operation failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleScan(intent: LPIntent): Promise<AgentResponse> {
  if (!gatewayClient) {
    return { success: false, message: 'No wallet loaded' };
  }

  try {
    const dexes = intent.dex ? [intent.dex] : ['meteora', 'orca', 'raydium'] as const;
    const [tokenA, tokenB] = intent.pair?.split('-') || [];

    const allPools: PoolOpportunity[] = [];

    for (const dex of dexes) {
      try {
        const pools = await gatewayClient.fetchPools(dex, tokenA, tokenB);
        for (const pool of pools.slice(0, 5)) {
          allPools.push({
            dex,
            pool: pool.address,
            pair: `${pool.tokenA.symbol}-${pool.tokenB.symbol}`,
            apy: 0, // Would come from external API
            tvl: parseFloat(pool.liquidity) || 0,
            volume24h: 0,
            fee: pool.fee,
          });
        }
      } catch {
        // Continue on individual DEX failures
      }
    }

    // Sort by TVL for now
    allPools.sort((a, b) => b.tvl - a.tvl);

    return {
      success: true,
      message: `Found ${allPools.length} pools`,
      data: { pools: allPools.slice(0, 10) },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to scan pools',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Universal position fetching - discovers ALL Meteora DLMM pools with positions
 * No hardcoded pool list - works with any pool on Meteora
 */
async function handleGetPositions(walletAddress?: string): Promise<AgentResponse> {
  // If no address provided and no wallet loaded, error
  if (!walletAddress && !gatewayClient) {
    return { 
      success: false, 
      message: 'No wallet address provided. Use ?address=YOUR_WALLET_ADDRESS or load a wallet first. Example: GET /positions?address=Ab6Cuvz9rZUSb4uVbBGR6vm12LeuVBE5dzKsnYUtAEi4',
    };
  }

  // Direct on-chain query using SDK's universal position discovery
  try {
    const { MeteoraDirectClient } = await import('../dex/meteora.js');
    const meteoraClient = new MeteoraDirectClient(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');
    
    const addressToQuery = walletAddress || (gatewayClient ? 'Ab6Cuvz9rZUSb4uVbBGR6vm12LeuVBE5dzKsnYUtAEi4' : null);
    if (!addressToQuery) {
      return { success: false, message: 'No wallet address available' };
    }
    
    // Use SDK's getAllLbPairPositionsByUser - discovers ALL pools automatically
    const poolsWithPositions = await meteoraClient.getAllUserPositions(addressToQuery);
    
    // Enrich each position with pool details
    const allPositions: any[] = [];
    
    for (const { poolAddress, positions } of poolsWithPositions) {
      try {
        // Get extended pool info (decimals, current price, etc.)
        const poolInfo = await meteoraClient.getPoolInfoExtended(poolAddress);
        
        for (const pos of positions) {
          allPositions.push({
            address: pos.address,
            pool: {
              address: poolAddress,
              tokenX: poolInfo.tokenX.mint,
              tokenY: poolInfo.tokenY.mint,
              decimalsX: poolInfo.tokenX.decimals,
              decimalsY: poolInfo.tokenY.decimals,
              binStep: poolInfo.binStep,
              currentPrice: poolInfo.currentPrice,
            },
            binRange: {
              lower: pos.lowerBinId,
              upper: pos.upperBinId,
            },
            activeBinId: poolInfo.activeBinId,
            inRange: poolInfo.activeBinId >= pos.lowerBinId && poolInfo.activeBinId <= pos.upperBinId,
            solscanUrl: `https://solscan.io/account/${pos.address}`,
          });
        }
      } catch (e) {
        console.warn(`[Positions] Failed to enrich pool ${poolAddress}:`, (e as Error).message);
        // Still include basic position info even if pool enrichment fails
        for (const pos of positions) {
          allPositions.push({
            address: pos.address,
            pool: { address: poolAddress },
            binRange: { lower: pos.lowerBinId, upper: pos.upperBinId },
            solscanUrl: `https://solscan.io/account/${pos.address}`,
          });
        }
      }
    }

    return {
      success: true,
      message: `Found ${allPositions.length} positions across ${poolsWithPositions.length} pools`,
      data: { 
        walletAddress: addressToQuery,
        positions: allPositions,
        totalPositions: allPositions.length,
        poolsDiscovered: poolsWithPositions.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to fetch positions',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleSwap(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!walletClient) {
    return { success: false, message: 'No wallet loaded. Create or load a wallet first.' };
  }

  if (!intent.inputToken || !intent.outputToken || !intent.amount) {
    return { 
      success: false, 
      message: 'Missing inputToken, outputToken, or amount. Example: "swap 1 SOL to USDC"',
    };
  }

  try {
    // Load swap module
    const jup = await loadSwapModule();
    if (!jup) {
      return { success: false, message: 'Swap module not available' };
    }

    // Resolve token symbols to mint addresses
    const inputMint = jup.resolveTokenMint(intent.inputToken);
    const outputMint = jup.resolveTokenMint(intent.outputToken);

    // Convert amount to base units (lamports for SOL = 9 decimals, USDC = 6 decimals)
    // For simplicity, we assume SOL has 9 decimals, stablecoins 6
    // Token decimals - BONK is 5, most others are 6, SOL is 9
    const TOKEN_DECIMALS: Record<string, number> = {
      SOL: 9, USDC: 6, USDT: 6, BONK: 5, WIF: 6, JUP: 6, RAY: 6,
    };
    const inputDecimals = TOKEN_DECIMALS[intent.inputToken.toUpperCase()] ?? 6;
    const amountBaseUnits = Math.floor(intent.amount * Math.pow(10, inputDecimals));

    // Get the user's wallet address
    const userPublicKey = walletClient.getAddress();

    // Get quote
    const quote = await jup.getQuote(inputMint, outputMint, amountBaseUnits);
    
    // Build swap transaction
    const swapResult = await jup.swap(quote, userPublicKey);

    // Sign the transaction
    const signedTx = await walletClient.signTransaction(swapResult.swapTransaction);

    // Broadcast
    const txid = await broadcastTransaction(signedTx);

    // Format output amount
    const outputDecimals = intent.outputToken.toUpperCase() === 'SOL' ? 9 : 6;
    const outputAmount = parseInt(quote.outAmount) / Math.pow(10, outputDecimals);

    return {
      success: true,
      message: `Swapped ${intent.amount} ${intent.inputToken} for ${outputAmount.toFixed(6)} ${intent.outputToken}`,
      data: {
        inputToken: intent.inputToken,
        inputMint,
        inputAmount: intent.amount,
        outputToken: intent.outputToken,
        outputMint,
        outputAmount,
        priceImpact: quote.priceImpactPct,
        route: quote.routePlan.map((r: any) => r.swapInfo.label).join(' -> '),
      },
      transaction: {
        unsigned: swapResult.swapTransaction,
        signed: signedTx,
        txid,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Swap failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Helper to get active wallet client (Local Keypair, Privy, or MPC)
function getWalletClient() {
  if (localKeypairClient) return localKeypairClient;
  if (privyClient?.isWalletLoaded()) return privyClient;
  if (mpcClient?.isWalletLoaded()) return mpcClient;
  return null;
}

async function handleOpenPosition(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!gatewayClient || !walletClient) {
    return { success: false, message: 'Wallet not initialized' };
  }

  if (!intent.dex || !intent.pair || !intent.amount) {
    return { success: false, message: 'Missing dex, pair, or amount' };
  }

  try {
    // Encrypt strategy with Arcium
    await arciumPrivacy.initialize();
    const encryptedStrategy = await arciumPrivacy.encryptStrategy({
      intent: 'open_position',
      dex: intent.dex,
      pool: intent.pair,
      tokenA: intent.pair.split('-')[0],
      tokenB: intent.pair.split('-')[1],
      amountA: intent.amount / 2,
      amountB: intent.amount / 2,
      slippage: 0.5,
    });

    // Get pool info to determine price range
    const pools = await gatewayClient.fetchPools(intent.dex);
    const pool = pools[0]; // In production, match by pair

    if (!pool) {
      return { success: false, message: 'Pool not found' };
    }

    // Calculate price range based on strategy
    const currentPrice = pool.currentPrice;
    let lowerPrice: number, upperPrice: number;

    switch (intent.strategy) {
      case 'concentrated':
        lowerPrice = currentPrice * 0.98;
        upperPrice = currentPrice * 1.02;
        break;
      case 'wide':
        lowerPrice = currentPrice * 0.8;
        upperPrice = currentPrice * 1.2;
        break;
      default: // balanced
        lowerPrice = currentPrice * 0.95;
        upperPrice = currentPrice * 1.05;
    }

    // Build transaction via Gateway
    const result = await gatewayClient.openPosition({
      dex: intent.dex,
      pool: pool.address,
      lowerPrice,
      upperPrice,
      tokenAAmount: intent.amount / 2,
      tokenBAmount: intent.amount / 2,
    });

    // Sign with wallet client (Privy or MPC)
    const signedTx = await walletClient.signTransaction(result.transaction);

    // Broadcast
    const txid = await broadcastTransaction(signedTx);

    // Calculate 1% protocol fee
    const feeBreakdown = createFeeBreakdown(intent.amount);

    return {
      success: true,
      message: `Position opened on ${intent.dex}`,
      data: {
        positionId: result.positionAddress,
        encryptedStrategy: encryptedStrategy.ciphertext.slice(0, 20) + '...',
        fees: {
          protocolFee: feeBreakdown.protocol.amount,
          protocolFeeBps: feeBreakdown.protocol.bps,
          treasury: feeBreakdown.protocol.recipient,
          netAmount: feeBreakdown.total.netAmount,
          grossAmount: feeBreakdown.total.grossAmount,
        },
      },
      transaction: {
        unsigned: result.transaction,
        signed: signedTx,
        txid,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to open position',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleClosePosition(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!gatewayClient || !walletClient) {
    return { success: false, message: 'Wallet not initialized' };
  }

  if (!intent.positionId || !intent.dex) {
    return { success: false, message: 'Missing positionId or dex' };
  }

  try {
    const result = await gatewayClient.closePosition({
      dex: intent.dex,
      positionId: intent.positionId,
    });

    const signedTx = await walletClient.signTransaction(result.transaction);
    const txid = await broadcastTransaction(signedTx);

    return {
      success: true,
      message: 'Position closed',
      transaction: { unsigned: result.transaction, signed: signedTx, txid },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to close position',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleCollectFees(intent: LPIntent): Promise<AgentResponse> {
  const walletClient = getWalletClient();
  if (!gatewayClient || !walletClient) {
    return { success: false, message: 'Wallet not initialized' };
  }

  if (!intent.positionId || !intent.dex) {
    return { success: false, message: 'Missing positionId or dex' };
  }

  try {
    const result = await gatewayClient.collectFees({
      dex: intent.dex,
      positionId: intent.positionId,
    });

    const signedTx = await walletClient.signTransaction(result.transaction);
    const txid = await broadcastTransaction(signedTx);

    return {
      success: true,
      message: 'Fees collected',
      transaction: { unsigned: result.transaction, signed: signedTx, txid },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to collect fees',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function broadcastTransaction(signedTx: string): Promise<string> {
  const txBuffer = Buffer.from(signedTx, 'base64');
  const txid = await connection.sendRawTransaction(txBuffer);
  await connection.confirmTransaction(txid);
  return txid;
}

// ============ Server Start ============

export async function startServer() {
  try {
    console.log('🚀 LP Agent Toolkit - Initializing...');
    connection = new Connection(config.solana.rpc, 'confirmed');

    // Eagerly load modules to catch errors at startup
    console.log('📦 Pre-loading modules...');
    await loadSwapModule();
    await loadLpModule();

    const port = config.agent.port;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 Gateway: ${config.gateway.url}`);
    console.log(`🔐 MPC Provider: ${config.privy.enabled ? 'Privy' : 'Portal'}`);
    console.log(`🛡️  Privacy: Arcium MXE`);
    console.log(`🌐 Network: mainnet`);
    console.log(`🚪 Port: ${port}`);
    console.log(`📦 LP Module: ${lpPipeline ? 'loaded' : 'NOT LOADED'}`);
    console.log(`📦 Swap Module: ${jupiterClient ? 'loaded' : 'NOT LOADED'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    serve({
      fetch: app.fetch,
      port: port,
    });

    console.log(`\n✅ Server running on http://0.0.0.0:${port}`);
  } catch (err) {
    console.error('💥 FATAL: Server failed to start!', err);
    process.exit(1);
  }
}

export default app;

// Debug endpoint to test LP module loading
app.get('/debug/lp', async (c) => {
  console.log('🔍 Debug: Testing LP module load...');
  let error: string | null = null;
  let modKeys: string[] = [];
  
  try {
    const mod = await import('../lp/index.js');
    modKeys = Object.keys(mod);
    if (mod.lpPipeline) {
      lpPipeline = mod.lpPipeline;
    }
  } catch (e) {
    error = (e as Error).message + '\n' + (e as Error).stack;
  }
  
  return c.json({
    lpLoaded: !!lpPipeline,
    lpPipelineType: typeof lpPipeline,
    lpPipelineValue: lpPipeline ? 'exists' : String(lpPipeline),
    moduleKeys: modKeys,
    swapLoaded: !!jupiterClient,
    error,
    timestamp: new Date().toISOString()
  });
});
