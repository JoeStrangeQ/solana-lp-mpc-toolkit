# LP Agent Toolkit

**One-click liquidity provision for AI agents on Solana.**

SOL in → LP position out. Atomic. Private. MEV-protected.

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 The Problem

AI agents want to earn yield on Solana, but:
- LP requires swapping to the right token pair
- Large positions get frontrun
- Key management is a security nightmare
- Failed transactions leave funds stuck

## ✨ The Solution

**LP Agent Toolkit handles everything:**

```
SOL → [Swap] → [Add Liquidity] → Position
         ↓           ↓
    Jito Bundle (atomic, MEV-protected)
         ↓
    Arcium Encrypted (private strategy)
```

One API call. No pre-swapping. No key exposure. No frontrunning.

---

## 🚀 Quick Start

### For AI Agents

```bash
# 1. Get the skill file
curl https://lp-agent-api-production.up.railway.app/skill.md

# 2. Create a wallet (MPC custody, no seed phrase)
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/create

# 3. Fund wallet with SOL, then discover pools
curl "https://lp-agent-api-production.up.railway.app/pools/top?tokenA=SOL&tokenB=USDC"

# 4. Add liquidity (SOL → swap → LP, all atomic)
curl -X POST https://lp-agent-api-production.up.railway.app/lp/atomic \
  -H "Content-Type: application/json" \
  -d '{"poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y", "amount": 0.5}'

# 5. Withdraw and convert back to SOL
curl -X POST https://lp-agent-api-production.up.railway.app/lp/withdraw/atomic \
  -H "Content-Type: application/json" \
  -d '{"positionAddress": "YOUR_POSITION", "poolAddress": "POOL", "convertToSol": true}'
```

### For Developers

```bash
npm install @mnm-ag/lp-agent-sdk
```

```typescript
import { LPAgentClient } from '@mnm-ag/lp-agent-sdk';

const client = new LPAgentClient();

// Create wallet
const wallet = await client.createWallet();

// Discover pools
const pools = await client.getTopPools('SOL', 'USDC');

// Execute atomic LP (SOL → swap → LP in one bundle)
const result = await client.atomicLP({
  poolAddress: pools[0].address,
  amount: 0.5,
  strategy: 'concentrated',
});

// Withdraw and convert to SOL
const withdraw = await client.atomicWithdraw({
  positionAddress: result.positionAddress,
  convertToSol: true,
});
```

---

## 💎 Key Features

| Feature | Description |
|---------|-------------|
| **Atomic Execution** | SOL → Swap → LP in ONE Jito bundle |
| **Auto-Retry** | Slippage escalates 3% → 5% → 7.5% → 10% on failure |
| **MPC Custody** | Privy wallets — agents never see private keys |
| **Arcium Privacy** | Strategy encrypted before execution |
| **MEV Protection** | Jito bundles prevent frontrunning |
| **Convert to SOL** | Withdraw + swap back to SOL atomically |
| **Pool Discovery** | Find top pools by TVL, APY, bin step |
| **1% Protocol Fee** | On withdrawals, to treasury |

---

## 📡 API Endpoints

**Base URL:** `https://lp-agent-api-production.up.railway.app`

### Core Flow
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/wallet/create` | POST | Create MPC wallet |
| `/pools/top` | GET | Top pools by TVL |
| `/lp/atomic` | POST | ⚡ **SOL → Swap → LP** (Jito bundle) |
| `/lp/withdraw/atomic` | POST | ⚡ **Withdraw → SOL** (Jito bundle) |
| `/positions` | GET | List open positions |

### Additional
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/skill.md` | GET | Agent skill file |
| `/wallet/load` | POST | Load existing wallet |
| `/swap` | POST | Direct token swap |
| `/swap/quote` | GET | Get swap quote |
| `/health` | GET | Service health |

---

## 🔐 Security Model

| Layer | Protection |
|-------|------------|
| **Keys** | MPC custody via Privy — never exposed |
| **Strategies** | Arcium encryption — parameters hidden |
| **Execution** | Jito bundles — atomic or nothing |
| **Mempool** | Private until landed — no frontrunning |

---

## 📊 Fee Structure

| Fee | Rate | When |
|-----|------|------|
| Protocol | 1% | On withdrawals |
| Jito Tip | ~0.0001 SOL | Per bundle |
| Network | ~0.001 SOL | Standard fees |

Treasury: `fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt`

---

## 🔗 Links

| Resource | URL |
|----------|-----|
| **API** | https://lp-agent-api-production.up.railway.app |
| **Skill File** | https://lp-agent-api-production.up.railway.app/skill.md |
| **Frontend** | https://api.mnm.ag |
| **NPM SDK** | `@mnm-ag/lp-agent-sdk` |

---

## 📜 License

Proprietary. Contact [MnM](https://mnm.ag) for licensing.

---

Built with 🦐 by [MnM](https://mnm.ag) for the Colosseum Agent Hackathon

