# LP Agent Toolkit

**AI-native liquidity management for Solana.**

Terminal or Telegram. Natural language or API. Your agent manages LP — you just tell it what to do.

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 The Vision

AI agents and humans managing LP together, seamlessly:

```
┌─────────────────────────────────────────────────────────────┐
│                        YOU                                  │
└──────────┬─────────────────────────────────────────────────┬┘
           │                                                 │
   ┌───────▼───────┐                               ┌─────────▼─────────┐
   │  @mnm_lp_bot  │                               │     Terminal      │
   │   Telegram    │                               │   (OpenClaw AI)   │
   └───────┬───────┘                               └─────────┬─────────┘
           │                                                 │
           │     "LP 1 SOL into SOL-USDC balanced"          │
           └───────────────────┬─────────────────────────────┘
                               │
                               ▼
             ┌─────────────────────────────────────┐
             │       LP Agent Toolkit API          │
             │  🔐 Arcium | ⚡ Jito | 🔑 Privy MPC │
             └─────────────────────────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
      ☄️ Meteora          🌀 Orca           🔄 Jupiter
        DLMM            Whirlpools           Swaps
```

**Same result, any surface.** Natural language everywhere.

---

## ✨ What Makes This Different

| Traditional LP | LP Agent Toolkit |
|----------------|------------------|
| Swap tokens first | SOL in → Position out (atomic) |
| Exposed to MEV | Jito-bundled (private mempool) |
| Manage keys yourself | MPC custody (Privy) |
| Manual monitoring | 24/7 automated alerts |
| Single DEX | Multi-DEX (Meteora + Orca) |
| CLI only | Telegram + Terminal + API |

---

## 🚀 Features

### Multi-DEX Support
- **Meteora DLMM** — Concentrated liquidity with dynamic bins
- **Orca Whirlpools** — Tick-based concentrated liquidity
- **Unified Pool Discovery** — Best yields across all DEXes

### Atomic Execution
- **Swap + LP in one bundle** — No failed half-states
- **Jito MEV Protection** — Private mempool, no frontrunning
- **Pre-flight Simulation** — Catch errors before broadcast

### Smart Strategies
- 🎯 **Tight (±2%)** — 6 bins, max APR, frequent rebalancing
- 📊 **Balanced (±5%)** — 16 bins, good yield, less work
- 🌊 **Wide (±15%)** — 50 bins, set & forget

### Position Management
- **Real-time Monitoring** — Out-of-range alerts
- **Auto-cleanup** — Closed positions removed automatically
- **IL Estimates** — Impermanent loss displayed on positions
- **Sparkline Charts** — Price history visualization

### 24 Telegram Commands
Full bot control via `/help` — pools, positions, withdraw, swap, claim, rebalance, and more.

---

## 🚀 Quick Start

### Option 1: Telegram Bot

1. Open [@mnm_lp_bot](https://t.me/mnm_lp_bot)
2. Send `/start` to create your wallet
3. Deposit SOL to the address
4. Send `/pools` to see opportunities
5. Tap a pool → Pick amount → Choose strategy → Done!

### Option 2: AI Agent (OpenClaw/Claude)

```bash
# Your agent can use the API directly
curl -X POST https://lp-agent-api-production.up.railway.app/lp/atomic \
  -H "Content-Type: application/json" \
  -d '{"walletId": "...", "poolAddress": "...", "amountSol": 0.5}'
```

### Option 3: Direct API

```bash
# Create wallet
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/create

# Get top pools (Meteora + Orca unified)
curl https://lp-agent-api-production.up.railway.app/unified/pools

# Check positions
curl "https://lp-agent-api-production.up.railway.app/positions?address=YOUR_WALLET"
```

---

## 📱 Telegram Commands

| Category | Commands |
|----------|----------|
| **Getting Started** | `/start` `/help` `/about` `/deposit` |
| **Portfolio** | `/portfolio` `/positions` `/balance` `/history` |
| **Pool Discovery** | `/pools` `/find SOL USDC` |
| **Liquidity** | `/lp` `/withdraw` `/claim` `/rebalance` `/swap` |
| **Market Data** | `/price` `/gas` `/simulate` |
| **Settings** | `/settings` `/alerts` `/status` `/refresh` |

### Natural Language Amounts

The bot understands flexible inputs:
- Numbers: `2.5`, `0.1 SOL`
- Percentages: `50%`, `half`, `quarter`
- Max: `max`, `all`, `everything`
- Relative: `max minus 0.1`, `all but fees`

---

## 📡 API Reference

**Base URL:** `https://lp-agent-api-production.up.railway.app`

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | System health + Telegram status |
| `/unified/pools` | GET | Top pools across Meteora + Orca |
| `/pools/top` | GET | Risk-scored Meteora pools |
| `/positions` | GET | List all LP positions (multi-DEX) |
| `/lp/atomic` | POST | Atomic swap→LP via Jito |
| `/lp/withdraw/atomic` | POST | Atomic withdraw + fee |
| `/lp/rebalance/execute` | POST | Rebalance out-of-range position |
| `/wallet/create` | POST | Create Privy MPC wallet |
| `/wallet/:id/balance` | GET | Check balance |

### Monitoring

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/monitor/add` | POST | Track position |
| `/monitor/positions` | GET | List tracked positions |
| `/health/telegram` | GET | Telegram bot health |

---

## 🛠 Architecture

### Reliability Features
- **Circuit Breakers** — Jupiter Ultra auto-disconnects after 3 failures
- **Retry Logic** — Exponential backoff on oracle/RPC failures  
- **30s Timeouts** — Wallet signing operations
- **Request Tracing** — Unique ID on every request
- **Pre-flight Simulation** — Catches errors before Jito submission

### Performance Features
- **Pool Caching** — 60s TTL for pool data, 10s for bin prices
- **Connection Pool** — Shared RPC connection
- **Parallel Loading** — Batch pool discovery
- **Bin Precompute** — Prices cached during monitoring

### Smart Simulation
For atomic bundles (swap→LP), later transactions depend on earlier ones:
- Only hard-fails on first transaction
- Subsequent "insufficient funds" errors treated as expected
- Lets Jito handle the atomic execution

---

## 🔐 Security

```
┌──────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                         │
├──────────────────────────────────────────────────────────────┤
│  🔑 MPC CUSTODY (Privy)                                      │
│     Private keys sharded across nodes, never reconstructed   │
├──────────────────────────────────────────────────────────────┤
│  🔐 ARCIUM ENCRYPTION                                        │
│     Strategy encrypted before execution (x25519-aes256gcm)   │
├──────────────────────────────────────────────────────────────┤
│  ⚡ JITO BUNDLES                                              │
│     Atomic execution, private mempool, no frontrunning       │
├──────────────────────────────────────────────────────────────┤
│  🛡️ PRE-FLIGHT SIMULATION                                    │
│     Transactions validated before broadcast                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 💰 Fee Structure

| Fee | Rate | When |
|-----|------|------|
| Protocol | 1% | On withdrawals |
| Jito Tip | ~0.001-0.005 SOL | Per bundle |
| Network | ~0.001 SOL | Standard fees |
| Reserve | 0.15 SOL | Held for tx fees |

Treasury: `fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt`

---

## 📊 Tech Stack

- **Framework:** Hono (edge-ready)
- **Bot:** grammY (Telegram)
- **DEXes:** Meteora DLMM, Orca Whirlpools
- **Swaps:** Jupiter (excludes Meteora DLMM routes)
- **Bundles:** Jito Block Engine
- **Wallets:** Privy MPC
- **Privacy:** Arcium Encryption
- **Cache:** Upstash Redis
- **Deploy:** Railway

---

## 🔗 Links

| Resource | URL |
|----------|-----|
| **API** | https://lp-agent-api-production.up.railway.app |
| **Frontend** | https://api.mnm.ag |
| **Telegram** | [@mnm_lp_bot](https://t.me/mnm_lp_bot) |
| **GitHub** | [solana-lp-mpc-toolkit](https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit) |
| **Health** | [/health](https://lp-agent-api-production.up.railway.app/health) |

---

## 🏆 Hackathon

**Colosseum Agent Hackathon** (Feb 2-12, 2026)

- **Track:** DeFi Agents
- **Agent ID:** 17
- **Team:** MnM Labs

### What We Built

1. **Multi-DEX LP Agent** — Unified interface for Meteora + Orca
2. **Atomic Execution** — Swap→LP in one Jito bundle
3. **24/7 Monitoring** — Position tracking with Telegram alerts
4. **AI-Native Design** — Natural language, agent-friendly API
5. **Privacy Layer** — Arcium encryption for strategies
6. **MPC Custody** — No exposed private keys

---

## 📝 Changelog (Feb 8, 2026)

### New Features
- ✅ Orca Whirlpool integration (LP + position discovery)
- ✅ Unified pool view (Meteora + Orca + Raydium data)
- ✅ Strategy selector with bin counts (6/16/50 bins)
- ✅ Pool display shows bin step / tick spacing
- ✅ Pre-flight simulation for all LP flows
- ✅ Smart simulation for dependent transactions

### Bug Fixes
- ✅ Orca fee payer fix (transaction rebuilding)
- ✅ Auto-cleanup of closed positions from monitoring
- ✅ Exclude Meteora DLMM from Jupiter swaps (bitmap extension fix)
- ✅ FEE_RESERVE consistency (0.15 SOL everywhere)
- ✅ Better error messages for low-liquidity tokens

### UX Improvements
- ✅ Strategy buttons show bin counts
- ✅ Pool list shows bin step (Meteora) / tick spacing (Orca)
- ✅ Clear error messages for common failures
- ✅ Human-friendly yield display ($X/day per $100)

---

Built with 🦐 by [MnM Labs](https://mnm.ag)
