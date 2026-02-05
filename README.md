# LP Agent Toolkit

**AI-native liquidity provision on Solana with MPC custody, Arcium privacy, and Jito MEV protection.**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 What is this?

A toolkit that enables AI agents to manage LP positions on Solana DEXs:

- **No key management** — MPC custody handles everything
- **MEV protected** — Atomic execution via Jito bundles
- **Private strategies** — Arcium encryption prevents frontrunning
- **Universal pools** — Works with any Meteora DLMM pool

---

## 🚀 Quick Start

### For AI Agents

```bash
# 1. Get the skill file
curl https://lp-agent-api-production.up.railway.app/skill.md

# 2. Create a wallet
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/create

# 3. Discover pools
curl "https://lp-agent-api-production.up.railway.app/pools/top?tokenA=SOL&tokenB=USDC"

# 4. Fund wallet, then LP
curl -X POST https://lp-agent-api-production.up.railway.app/lp/atomic \
  -H "Content-Type: application/json" \
  -d '{"inputToken": "SOL", "poolAddress": "POOL_ADDRESS", "amount": 0.1}'
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

// Execute LP
const result = await client.atomicLP({
  inputToken: 'SOL',
  poolAddress: pools[0].address,
  amount: 0.5,
});
```

---

## 💎 Features

| Feature | Description |
|---------|-------------|
| **MPC Custody** | Privy server wallets — agents never see private keys |
| **Jito Bundles** | Atomic swap→LP execution, private mempool |
| **Arcium Privacy** | Strategy encrypted before execution |
| **Universal Pools** | Any Meteora DLMM pool supported |
| **Pool Discovery** | Top pools by TVL, APY, bin step |
| **1% Protocol Fee** | On withdrawals, to treasury |

---

## 📡 API Endpoints

**Base URL:** `https://lp-agent-api-production.up.railway.app`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/skill.md` | GET | Agent skill file |
| `/wallet/create` | POST | Create MPC wallet |
| `/wallet/load` | POST | Load existing wallet |
| `/pools/top` | GET | Top 3 pools by TVL |
| `/pools/scan` | GET | Search all pools |
| `/lp/atomic` | POST | ⚡ Swap→LP via Jito |
| `/lp/execute` | POST | Add liquidity |
| `/lp/withdraw/atomic` | POST | ⚡ Withdraw via Jito |
| `/positions` | GET | List LP positions |

---

## 🔐 Security

- **Keys**: Never exposed — MPC custody via Privy
- **Strategies**: Encrypted with Arcium before execution  
- **Execution**: Atomic bundles via Jito — no partial failures
- **Mempool**: Private until landed — no frontrunning

---

## 📊 Fee Structure

| Fee | Rate | Description |
|-----|------|-------------|
| Protocol Fee | 1% | On withdrawals |
| Jito Tip | Variable | Based on network congestion |
| Network | ~0.001 SOL | Standard Solana fees |

---

## 🔗 Links

- **API**: https://lp-agent-api-production.up.railway.app
- **SDK**: `npm install @mnm-ag/lp-agent-sdk`
- **Frontend**: https://api.mnm.ag
- **Skill File**: https://lp-agent-api-production.up.railway.app/skill.md

---

## 📜 License

Proprietary. Contact [MnM](https://mnm.ag) for licensing.

---

Built with 🦐 by [MnM](https://mnm.ag) for the Colosseum Agent Hackathon
