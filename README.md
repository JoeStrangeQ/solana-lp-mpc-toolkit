# LP Agent Toolkit

**AI-native liquidity provision on Solana with MPC custody and Arcium privacy.**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 What is this?

A toolkit that enables AI agents to manage LP positions and execute swaps through natural language, with:

- **🔐 MPC Custody** - Threshold signatures via Portal/Privy. Neither the agent nor the service holds the full private key.
- **🛡️ Arcium Privacy** - Strategy parameters encrypted until execution. No front-running your LP strategy.
- **🔄 Jupiter Swaps** - Best-route token swaps across Solana.
- **🌊 Meteora DLMM** - Concentrated liquidity positions via Hummingbot Gateway.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Natural Language                          │
│         "swap 1 SOL to USDC" / "add liquidity"              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  LP Agent Toolkit API                        │
│                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │   Intent    │ │   Arcium    │ │ Portal/Privy│           │
│  │   Parser    │ │   Privacy   │ │     MPC     │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
                    │                   │
         ┌──────────┘                   └──────────┐
         ▼                                         ▼
┌─────────────────┐                     ┌─────────────────┐
│     Jupiter     │                     │    Hummingbot   │
│   Swap Router   │                     │     Gateway     │
└─────────────────┘                     └─────────────────┘
         │                                         │
         ▼                                         ▼
┌─────────────────┐                     ┌─────────────────┐
│   Best Route    │                     │  Meteora DLMM   │
│    Execution    │                     │   Positions     │
└─────────────────┘                     └─────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+**
- **Docker** (for Hummingbot Gateway, optional for swap-only usage)

### Install & Run

```bash
# Clone
git clone https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit.git
cd solana-lp-mpc-toolkit

# Install
pnpm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Run
pnpm start
```

### Environment Variables

```env
# Required
SOLANA_RPC=https://api.mainnet-beta.solana.com

# Wallet Provider (pick one)
PORTAL_API_KEY=your_portal_api_key      # Portal MPC
PRIVY_APP_ID=your_privy_app_id          # OR Privy embedded wallet
PRIVY_APP_SECRET=your_privy_secret
USE_MOCK_MPC=true                        # OR mock for dev

# Swaps
JUPITER_API_KEY=your_jupiter_api_key    # Optional, improves rate limits

# LP (optional, for Meteora positions)
GATEWAY_URL=http://localhost:15888
SOLANA_NETWORK=mainnet-beta

# Privacy
ARCIUM_CLUSTER=456

# Server
PORT=3456
```

---

## 📡 API Reference

### Natural Language

```bash
# Swap tokens
POST /chat
{ "message": "swap 1 SOL to USDC" }

# Open LP position
POST /chat
{ "message": "add $500 liquidity to SOL-USDC on meteora" }
```

### Token Swaps (Jupiter)

```bash
# Execute swap
POST /swap
{
  "inputToken": "SOL",
  "outputToken": "USDC",
  "amount": 1
}

# Get quote (no execution)
GET /swap/quote?inputToken=SOL&outputToken=USDC&amount=1000000000

# List supported tokens
GET /swap/tokens
```

**Supported Tokens:** SOL, USDC, USDT, BONK, WIF, JUP, RAY (or any mint address)

### Wallet Management

```bash
# Create MPC wallet
POST /wallet/create

# Load existing wallet
POST /wallet/load
{
  "walletId": "privy_wallet_id"      # For Privy
}
# OR
{
  "address": "7xKXt...",
  "share": "<encrypted_key_share>",  # For Portal
  "id": "wallet_id"
}
```

### LP Positions (Meteora)

```bash
# Scan pools
GET /pools/scan?tokenA=SOL&tokenB=USDC

# View positions
GET /positions

# Open position
POST /position/open
{
  "dex": "meteora",
  "pair": "SOL-USDC",
  "amount": 500,
  "strategy": "balanced"  # balanced | concentrated | wide
}

# Close position
POST /position/close
{ "dex": "meteora", "positionId": "8abc..." }

# Collect fees
POST /position/collect-fees
{ "dex": "meteora", "positionId": "8abc..." }
```

### Fee Info

```bash
# View fee structure
GET /fees

# Calculate fee for amount
GET /fees/calculate?amount=1000
```

---

## 💬 Natural Language Examples

The `/chat` endpoint understands:

| Input | Action |
|-------|--------|
| `swap 1 SOL to USDC` | Execute swap via Jupiter |
| `swap 100 USDC for BONK` | Execute swap |
| `add $500 to SOL-USDC` | Open LP position |
| `show my positions` | List all positions |
| `close position 8abc...` | Close LP position |

---

## 🔐 Security Model

### MPC Custody

- **Portal**: 2-of-2 threshold signing via AWS Nitro Enclave
- **Privy**: Embedded wallet with server-side signing
- **No Full Key Exposure**: Private key never reconstructed in cleartext

### Arcium Privacy

- **Strategy Encryption**: LP parameters encrypted before execution
- **No Front-Running**: Intent hidden until transaction broadcasts
- **MXE Integration**: Using Arcium devnet cluster

---

## 🗂️ Project Structure

```
src/
├── agent/           # API server & intent parsing
│   ├── server.ts    # Hono REST API
│   └── intent.ts    # Natural language parser
├── swap/            # Jupiter integration
│   └── jupiter.ts   # Quote & swap execution
├── gateway/         # Hummingbot Gateway client
├── mpc/             # Portal & Privy wallet clients
├── privacy/         # Arcium encryption layer
├── fees/            # Protocol fee calculation
└── config/          # Environment config
```

---

## 📜 License

MIT

---

## 🔗 Links

- [Jupiter](https://jup.ag/) - Swap aggregator
- [Meteora](https://meteora.ag/) - DLMM pools
- [Portal](https://www.portalhq.io/) - MPC custody
- [Privy](https://privy.io/) - Embedded wallets
- [Arcium](https://www.arcium.com/) - Privacy layer
- [Hummingbot Gateway](https://github.com/hummingbot/gateway) - DEX interface

---

Built with 🦐 by [MnM](https://mnm.ag)
