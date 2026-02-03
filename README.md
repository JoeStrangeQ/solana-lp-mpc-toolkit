# LP Agent Toolkit

**AI-native liquidity provision across Solana DEXs with MPC custody and Arcium privacy.**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 What is this?

A toolkit that enables AI agents to manage LP positions across Solana DEXs through natural language, with:

- **🔐 MPC Custody** - Threshold signatures via Portal. Neither the agent nor the service holds the full private key.
- **🛡️ Arcium Privacy** - Strategy parameters encrypted until execution. No front-running your LP strategy.
- **🌊 Multi-DEX** - Unified API for Meteora DLMM, Orca Whirlpools, and Raydium CLMM via Hummingbot Gateway.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Natural Language                          │
│           "Add $500 liquidity to SOL-USDC"                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  LP Agent Toolkit API                        │
│                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │   Intent    │ │   Arcium    │ │   Portal    │           │
│  │   Parser    │ │   Privacy   │ │    MPC      │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Hummingbot Gateway (localhost:15888)           │
│                 Unified DEX Interface                        │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Meteora  │   │   Orca   │   │ Raydium  │
        │   DLMM   │   │Whirlpool │   │   CLMM   │
        └──────────┘   └──────────┘   └──────────┘
```

---

## 🚀 Quick Start

### Prerequisites

1. **Hummingbot Gateway** running locally:
   ```bash
   git clone https://github.com/hummingbot/gateway.git
   cd gateway && pnpm install && pnpm build
   pnpm start --passphrase=your-secret --dev
   ```

2. **Portal API Key** (for MPC): [Get one here](https://www.portalhq.io/signup)

3. **Node.js 20+**

### Install & Run

```bash
# Clone
git clone https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit.git
cd solana-lp-mpc-toolkit

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Run
npm start
```

### Environment Variables

```env
# Hummingbot Gateway
GATEWAY_URL=http://localhost:15888
SOLANA_NETWORK=mainnet-beta

# Portal MPC
PORTAL_API_KEY=your_portal_api_key

# Solana RPC
SOLANA_RPC=https://api.mainnet-beta.solana.com

# Server
PORT=3456
```

---

## 📡 API Reference

### Natural Language Interface

```bash
POST /chat
{
  "message": "Add $500 liquidity to the best SOL-USDC pool"
}
```

### Wallet Management

```bash
# Create MPC wallet
POST /wallet/create

# Load existing wallet
POST /wallet/load
{
  "address": "7xKXt...",
  "share": "<encrypted_key_share>",
  "id": "wallet_id"
}
```

### Pool Discovery

```bash
# Scan for opportunities
GET /pools/scan?tokenA=SOL&tokenB=USDC&dex=meteora
```

### Position Management

```bash
# View all positions
GET /positions

# Open position
POST /position/open
{
  "dex": "meteora",
  "pair": "SOL-USDC",
  "amount": 500,
  "strategy": "balanced"
}

# Close position
POST /position/close
{
  "dex": "meteora",
  "positionId": "8abc..."
}

# Collect fees
POST /position/collect-fees
{
  "dex": "meteora",
  "positionId": "8abc..."
}
```

---

## 🔐 Security Model

### MPC Custody (Portal)

- **2-of-2 Threshold**: Agent holds one key share, Portal Enclave holds the other
- **No Full Key Exposure**: Private key is never reconstructed
- **Secure Enclave**: Portal runs in AWS Nitro Enclave

### Arcium Privacy

- **Strategy Encryption**: LP parameters encrypted before execution
- **No Front-Running**: Intent hidden until transaction broadcasts
- **Devnet Ready**: Using Arcium cluster 456 (v0.7.0)

---

## 🗂️ Project Structure

```
src/
├── gateway/          # Hummingbot Gateway client
│   ├── client.ts     # Unified DEX interface
│   └── types.ts      # Gateway types
├── mpc/              # Portal MPC wallet
│   ├── client.ts     # Threshold signing
│   └── types.ts      # MPC types
├── privacy/          # Arcium privacy layer
│   ├── arcium.ts     # Strategy encryption
│   └── types.ts      # Privacy types
├── agent/            # Agent API server
│   ├── server.ts     # Hono REST API
│   ├── intent.ts     # NL parser
│   └── types.ts      # Agent types
├── config/           # Configuration
│   └── index.ts
└── index.ts          # Entry point
```

---

## 🛠️ Supported DEXs

| DEX | Pool Type | Status |
|-----|-----------|--------|
| Meteora | DLMM | ✅ Full Support |
| Orca | Whirlpools | ✅ Full Support |
| Raydium | CLMM | ✅ Full Support |

---

## 🧪 Testing

```bash
# Run tests
npm test

# Type check
npm run typecheck
```

---

## 🗺️ Roadmap

- [x] Hummingbot Gateway integration
- [x] Portal MPC wallet
- [x] Arcium strategy encryption
- [x] Natural language intent parsing
- [ ] Auto-rebalancing positions
- [ ] Confidential SPL integration (when available)
- [ ] Full Arcium MPC signing (Path 1)

---

## 📜 License

MIT

---

## 🔗 Links

- [Hummingbot Gateway](https://github.com/hummingbot/gateway)
- [Portal MPC](https://www.portalhq.io/)
- [Arcium](https://www.arcium.com/)
- [Colosseum Hackathon](https://www.colosseum.org/)

---

Built with 🦐 by [MnM](https://mnm.ag)
