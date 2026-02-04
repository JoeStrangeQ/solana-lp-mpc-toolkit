# LP Agent Toolkit

**AI-native liquidity provision on Solana with MPC custody and Arcium privacy.**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 What is this?

A toolkit that enables AI agents to manage LP positions and execute swaps through natural language:

```bash
curl -X POST https://api.mnm.ag/chat -d '{"message": "LP $500 into SOL-USDC"}'
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
| `/wallet/create` | POST | Create MPC wallet |
| `/chat` | POST | Natural language interface |
| `/encrypt` | POST | Encrypt strategy with Arcium |
| `/pools/scan` | GET | Scan LP opportunities |
| `/swap` | POST | Execute swap via Jupiter |
| `/lp/execute` | POST | Execute LP pipeline |
| `/positions` | GET | List LP positions |
| `/fees` | GET | Fee structure |

---

## 🔗 Links

- **Frontend**: [api.mnm.ag](https://api.mnm.ag)
- **API**: [lp-agent-api-production.up.railway.app](https://lp-agent-api-production.up.railway.app)
- **GitHub**: [github.com/JoeStrangeQ/solana-lp-mpc-toolkit](https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit)

---

## 📜 License

MIT

---

Built with 🦐 by [MnM](https://mnm.ag)
