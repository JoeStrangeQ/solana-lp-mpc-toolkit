# LP Agent Toolkit

**AI-native liquidity provision on Solana with MPC custody and Arcium privacy.**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 What is this?

A toolkit that enables AI agents to manage LP positions and execute swaps through natural language, with:

- **🔐 Privy Embedded Wallets** - Secure wallet creation and signing for agents. No private keys exposed.
- **🛡️ Arcium Privacy** - Strategy parameters encrypted until execution. No front-running your LP strategy.
- **🔄 Jupiter Swaps** - Best-route token swaps across Solana.
- **🌊 Meteora DLMM** - Concentrated liquidity positions on Solana's top DEX.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Natural Language                          │
│         "swap 1 SOL to USDC" / "LP into SOL-USDC"           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  LP Agent Toolkit API                        │
│                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │   Intent    │ │   Arcium    │ │    Privy    │           │
│  │   Parser    │ │   Privacy   │ │   Wallets   │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
                    │                   │
         ┌──────────┘                   └──────────┐
         ▼                                         ▼
┌─────────────────┐                     ┌─────────────────┐
│     Jupiter     │                     │  Meteora DLMM   │
│   Swap Router   │                     │    (Direct)     │
└─────────────────┘                     └─────────────────┘
         │                                         │
         ▼                                         ▼
┌─────────────────┐                     ┌─────────────────┐
│   Best Route    │                     │  Concentrated   │
│    Execution    │                     │   Liquidity     │
└─────────────────┘                     └─────────────────┘
```

---

## 🚂 Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit)

One-click deploy with Railway:
1. Click the button above
2. Configure environment variables (see `.env.example`)
3. Deploy!

Railway will automatically:
- Detect Node.js 20
- Install dependencies with pnpm
- Build TypeScript
- Start the server with health checks

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+**

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

See `.env.example` for required configuration.

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
  "walletId": "privy_wallet_id"
}
```

### LP Pipeline (Swap→LP)

```bash
# List available pools
GET /lp/pools

# Prepare liquidity (check balances, calc swap needed)
POST /lp/prepare
{
  "tokenA": "SOL",
  "tokenB": "USDC",
  "totalValueUsd": 500
}

# Execute full pipeline (swap to 50/50 if needed, then LP)
POST /lp/execute
{
  "tokenA": "SOL",
  "tokenB": "USDC",
  "totalValueUsd": 500
}
```

### LP Positions (Meteora)

```bash
# Scan pools
GET /pools/scan?tokenA=SOL&tokenB=USDC

# View positions
GET /positions

# Open position (direct)
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
| `convert 100 USDC into SOL` | Execute swap |
| `LP $500 into SOL-USDC` | Full swap→LP pipeline |
| `add liquidity to SOL-USDC pool` | Open LP position |
| `put $1000 in the best SOL pool` | Find best pool + LP |
| `show my positions` | List all positions |

---

## 🔐 Security Model

### Privy Embedded Wallets

- **Server-side signing**: Secure key management via Privy infrastructure
- **No key exposure**: Agent never sees raw private keys
- **Per-agent wallets**: Each agent gets isolated wallet custody

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
├── dex/             # Meteora DLMM integration
│   └── meteora.ts   # LP operations
├── mpc/             # Privy wallet client
├── privacy/         # Arcium encryption layer
├── fees/            # Protocol fee calculation
└── config/          # Environment config
```

---

## 🐳 Docker

### Build & Run

```bash
# Build image
docker build -t lp-agent-toolkit .

# Run container
docker run -p 3456:3456 --env-file .env lp-agent-toolkit
```

### Docker Compose

```bash
# Start service
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

---

## 📜 License

MIT

---

## 🔗 Links

- [Jupiter](https://jup.ag/) - Swap aggregator
- [Meteora](https://meteora.ag/) - DLMM pools
- [Privy](https://privy.io/) - Embedded wallets
- [Arcium](https://www.arcium.com/) - Privacy layer
- [Colosseum Hackathon](https://www.colosseum.org/)

---

Built with 🦐 by [MnM](https://mnm.ag)
