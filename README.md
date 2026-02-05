# LP Agent Toolkit

**AI-native liquidity provision on Solana with MPC custody and Arcium privacy.**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 What is this?

A toolkit that enables AI agents to manage LP positions and execute swaps through natural language:

```bash
curl -X POST https://lp-agent-api-production.up.railway.app/chat -d '{"message": "LP $500 into SOL-USDC"}'
```

---

## 💎 Value Proposition

| Feature | Benefit |
|---------|---------|
| **Natural Language** | Agents speak plainly: "LP $500 into SOL-USDC" |
| **MPC Custody** | Privy wallets - no private keys exposed to agents |
| **Privacy Layer** | Arcium encryption prevents MEV and front-running |
| **One-Call Pipeline** | Swap → LP in a single API call |
| **Multi-DEX** | Meteora DLMM, Orca, Raydium support |

---

## 🔐 Security Framework

### Privy Embedded Wallets
- **Server-side signing**: Keys never leave Privy infrastructure
- **No key exposure**: Agent never sees raw private keys
- **Per-agent isolation**: Each agent gets dedicated wallet custody
- **Authorization keys**: Additional signing layer for server wallets

### Arcium Privacy Layer
- **Algorithm**: x25519 ECDH + AES-256-GCM
- **Strategy Encryption**: LP parameters encrypted before execution
- **MEV Protection**: Intent hidden until transaction broadcasts
- **MXE Integration**: Arcium devnet cluster 456

### Protocol Security
- **0.1% Protocol Fee**: Transparent fee to treasury
- **Rate Limiting**: API protection against abuse
- **Input Validation**: All parameters validated before execution

---

## 🚀 Installation

### Prerequisites
- Node.js 20+
- pnpm

### Quick Start

```bash
# Clone
git clone https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit.git
cd solana-lp-mpc-toolkit

# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env with your API keys:
# - PRIVY_APP_ID
# - PRIVY_APP_SECRET  
# - SOLANA_RPC_URL

# Run
pnpm start
```

### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit)

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/wallet/create` | POST | Create Privy wallet |
| `/wallet/load` | POST | Load existing wallet |
| `/wallet/transfer` | POST | Transfer SOL or SPL tokens |
| `/encrypt` | POST | Encrypt strategy with Arcium |
| `/encrypt/test` | GET | Verify Arcium encryption |
| `/lp/prepare` | POST | Check balances, prepare LP |
| `/lp/execute` | POST | Execute LP with Arcium |
| `/lp/withdraw` | POST | Withdraw and close position |
| `/fees` | GET | Fee structure (1%) |

---

## ✅ Verified Working (Feb 4, 2026)

**Full E2E pipeline tested on mainnet:**

```bash
# 1. Load wallet
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/load \
  -H "Content-Type: application/json" \
  -d '{"walletId":"eouu630z8fl0ddzubzn4tt4b"}'

# 2. Execute LP with Arcium encryption
curl -X POST https://lp-agent-api-production.up.railway.app/lp/execute \
  -H "Content-Type: application/json" \
  -d '{"tokenA":"SOL","tokenB":"USDC","amount":3}'

# Response includes Arcium proof:
# {
#   "success": true,
#   "data": {
#     "lpTxid": "326EXN8Uig...",
#     "positionAddress": "2kwmZfNvCD...",
#     "arcium": { "ciphertext": "...", "mxeCluster": 456 }
#   }
# }

# 3. Withdraw position
curl -X POST https://lp-agent-api-production.up.railway.app/lp/withdraw \
  -H "Content-Type: application/json" \
  -d '{"positionAddress":"2kwmZfNvCD8znYVX6ipjCbeVrG916dhDKLnsMLBZCLdf"}'
```

**Verified Transactions:**
- [LP Position](https://solscan.io/tx/326EXN8UigFvGsboyyNfMGjStgXokEyLnWCV64aZQhUyMveW9VNuRxQ6dawnL4H8Cs3YHmcqCoYNhev22LHUgJor)
- [Withdraw](https://solscan.io/tx/5f77deQ4WageKkcFCoXviRejJ1vLmUNJHhit9TokqTUvVd98NwyxN2k3BvhShuigtrtub1YkGEpinQZnjyqMpUje)

---

## 🔗 Links

- **Frontend**: [mnm-web-seven.vercel.app](https://mnm-web-seven.vercel.app)
- **API**: [lp-agent-api-production.up.railway.app](https://lp-agent-api-production.up.railway.app)
- **GitHub**: [github.com/JoeStrangeQ/solana-lp-mpc-toolkit](https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit)

---

## 📜 License

MIT

---

Built with 🦐 by [MnM](https://mnm.ag)
