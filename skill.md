# LP Agent Toolkit - Skill File

> AI-native liquidity provision on Solana with MPC custody, Arcium privacy, and Jito MEV protection.

## Overview

This toolkit enables AI agents to:
- **Create wallets** with MPC custody (no private keys exposed)
- **Execute LP positions** on any Meteora DLMM pool
- **Atomic operations** via Jito bundles (MEV protected)
- **Encrypt strategies** with Arcium to prevent frontrunning
- **Collect fees** 1% on withdrawals to protocol treasury

## Base URL
```
https://lp-agent-api-production.up.railway.app
```

---

## 🔥 Recommended Flow

### Step 1: Create/Load Wallet
```bash
# Create new wallet
curl -X POST /wallet/create

# Or load existing
curl -X POST /wallet/load -d '{"walletId": "YOUR_WALLET_ID"}'
```

### Step 2: Discover Pools (REQUIRED if user didn't specify)
```bash
# Get top 3 pools for a token pair
curl "/pools/top?tokenA=SOL&tokenB=USDC"
```

**Response:**
```json
{
  "success": true,
  "message": "Top 3 SOL-USDC pools on Meteora DLMM",
  "data": {
    "pools": [
      {
        "rank": 1,
        "address": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
        "pair": "SOL-USDC",
        "tvl": "$4.54M",
        "apy": "8361.5%",
        "binStep": 10,
        "recommendation": "Highest TVL - most liquid"
      },
      {
        "rank": 2,
        "address": "BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh",
        "pair": "SOL-USDC",
        "tvl": "$2.71M",
        "apy": "567.2%",
        "binStep": 20,
        "recommendation": "Good alternative"
      },
      {
        "rank": 3,
        "address": "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
        "pair": "SOL-USDC",
        "tvl": "$1.40M",
        "apy": "2793.8%",
        "binStep": 4,
        "recommendation": "Lower TVL option"
      }
    ],
    "hint": "Use the pool address with /lp/execute or /lp/atomic"
  }
}
```

**Show this to the user and let them choose**, or pick the highest TVL pool by default.

### Step 3: Execute LP

**Option A: Atomic (Recommended)**
```bash
# Swap + LP in one atomic bundle via Jito
curl -X POST /lp/atomic -d '{
  "inputToken": "SOL",
  "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
  "amount": 0.5,
  "strategy": "spot"
}'
```

**Option B: Regular (if you already have both tokens)**
```bash
curl -X POST /lp/execute -d '{
  "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
  "amount": 50,
  "strategy": "spot"
}'
```

### Step 4: Monitor Positions
```bash
curl "/positions?address=YOUR_WALLET_ADDRESS"
```

### Step 5: Withdraw (Atomic)
```bash
# Withdraw with 1% fee to treasury
curl -X POST /lp/withdraw/atomic -d '{
  "positionAddress": "YOUR_POSITION_ADDRESS",
  "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y"
}'
```

---

## API Reference

### Wallet

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/wallet/create` | POST | Create MPC wallet |
| `/wallet/load` | POST | Load by walletId |
| `/wallet/transfer` | POST | Transfer SOL/tokens |

### Pool Discovery

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/pools/top` | GET | **Top 3 pools** with TVL, APY, binStep |
| `/pools/scan` | GET | Full pool list |
| `/pool/info` | GET | Single pool details |

### LP Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/lp/atomic` | POST | ⚡ Swap→LP via Jito (MEV protected) |
| `/lp/execute` | POST | Add liquidity (regular) |
| `/lp/withdraw/atomic` | POST | ⚡ Withdraw + 1% fee via Jito |
| `/lp/withdraw` | POST | Withdraw (regular) |
| `/positions` | GET | List all positions |

### Privacy

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/encrypt` | POST | Encrypt with Arcium |
| `/encrypt/test` | GET | Verify encryption works |

---

## Fee Structure

- **Withdrawal fee**: 1% (100 bps)
- **Treasury**: `fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt`
- **Minimum withdrawal**: 0.01 SOL / $5 USD

---

## Strategy Options

| Strategy | Description |
|----------|-------------|
| `spot` | Uniform distribution around current price |
| `curve` | Bell curve - concentrated at center |
| `bidask` | Two-sided - heavier at edges |
| `concentrated` | Default, ±5 bins |
| `wide` | Broader range, ±20 bins |

---

## Example: Full LP Flow

```bash
# 1. Load wallet
curl -X POST /wallet/load -d '{"walletId": "eouu630z8fl0ddzubzn4tt4b"}'

# 2. User says: "LP $100 into SOL-USDC"
#    → No pool specified, so fetch options first:
curl "/pools/top?tokenA=SOL&tokenB=USDC"

# 3. Show user the pools, they pick rank 1 (or default to it)

# 4. Execute atomic LP
curl -X POST /lp/atomic -d '{
  "inputToken": "SOL",
  "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
  "amount": 1.25
}'

# 5. Response includes:
# - bundleId (Jito)
# - positionAddress
# - arcium ciphertext
```

---

## Privacy & Security

### What's Protected
- **Keys**: Privy MPC - agent never sees private keys
- **Strategy**: Arcium encrypts intent before execution
- **Mempool**: Jito bundles - txs invisible until landed
- **Execution**: Atomic - no partial failures

### What's Public (after landing)
- Transaction data on Solana
- Position details (standard Meteora accounts)
- Your wallet balance

The privacy is in the **process**, not the final state.

---

## Links

- **API**: https://lp-agent-api-production.up.railway.app
- **Health**: https://lp-agent-api-production.up.railway.app/health
- **GitHub**: https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit

Built with 🦐 by MnM for the Colosseum Agent Hackathon
