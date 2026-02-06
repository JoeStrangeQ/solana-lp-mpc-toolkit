---
name: lp-agent
description: "Manage Solana LP positions via MnM LP Agent Toolkit. Create wallets, browse pools, add/remove liquidity, monitor positions, claim fees. All transactions Arcium-encrypted and Jito-bundled."
metadata:
  {
    "openclaw":
      {
        "emoji": "🏊",
        "requires": { "env": ["LP_AGENT_API"] },
        "config": {
          "LP_AGENT_API": {
            "description": "LP Agent Toolkit API URL",
            "default": "https://lp-agent-api-production.up.railway.app"
          },
          "LP_WALLET_ID": {
            "description": "Your LP wallet ID (from /wallet/create)",
            "optional": true
          }
        }
      },
  }
---

# LP Agent Skill

Manage Solana LP positions with natural language. All transactions are Arcium-encrypted and MEV-protected via Jito bundles.

## API Base

```
https://lp-agent-api-production.up.railway.app
```

## Quick Start

### 1. Create a Wallet

```bash
curl -X POST "$LP_AGENT_API/wallet/create" | jq
```

Store the returned `walletId` - you'll need it for all operations.

### 2. Check Balance

```bash
curl "$LP_AGENT_API/wallet/$WALLET_ID/balance" | jq
```

### 3. View Top Pools

```bash
curl "$LP_AGENT_API/pools/top?tokenA=SOL&tokenB=USDC" | jq
```

### 4. Add Liquidity (Atomic)

```bash
curl -X POST "$LP_AGENT_API/lp/atomic" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "YOUR_WALLET_ID",
    "poolAddress": "POOL_ADDRESS",
    "amountSol": 0.5,
    "strategy": "concentrated"
  }' | jq
```

### 5. View Positions

```bash
curl "$LP_AGENT_API/positions/$WALLET_ID" | jq
```

### 6. Withdraw (Atomic)

```bash
curl -X POST "$LP_AGENT_API/lp/withdraw/atomic" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "YOUR_WALLET_ID",
    "poolAddress": "POOL_ADDRESS",
    "positionAddress": "POSITION_ADDRESS",
    "convertToSol": true
  }' | jq
```

## Natural Language Examples

When users say things like:

| User Says | Action |
|-----------|--------|
| "LP 0.5 SOL into SOL-USDC" | `POST /lp/atomic` with amountSol=0.5 |
| "Check my LP positions" | `GET /positions/$WALLET_ID` |
| "Withdraw from my MET-USDC position" | `POST /lp/withdraw/atomic` |
| "What's my balance?" | `GET /wallet/$WALLET_ID/balance` |
| "Show me top pools" | `GET /pools/top` |
| "Claim my fees" | `POST /fees/claim` |
| "Rebalance my SOL-USDC" | `POST /lp/rebalance/execute` |

## Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/wallet/create` | POST | Create MPC wallet (Privy) |
| `/wallet/:id/balance` | GET | Check wallet balance |
| `/pools/top` | GET | Top pools by TVL |
| `/positions/:walletId` | GET | List LP positions with details |
| `/lp/atomic` | POST | Swap → LP in one Jito bundle |
| `/lp/withdraw/atomic` | POST | Withdraw + optional swap to SOL |
| `/fees/claim` | POST | Claim LP fees |
| `/lp/rebalance/execute` | POST | Atomic rebalance |
| `/notify/register` | POST | Register for Telegram/webhook alerts |

## Telegram Bot

Users can also interact via `@mnm_lp_bot` on Telegram:

- `/start` - Create wallet
- `/balance` - Check balance
- `/pools` - Browse pools with LP buttons
- `/positions` - View positions with action buttons
- `/withdraw` - Withdraw funds
- `/settings` - Alert preferences

## Connecting Telegram to OpenClaw

To have your Clawdbot handle LP Bot messages:

```bash
# The LP Bot can forward NL messages to your OpenClaw gateway
curl -X POST "$LP_AGENT_API/notify/register" \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "YOUR_WALLET_ID",
    "webhook": {
      "url": "http://localhost:18789/webhook/lp-agent",
      "secret": "your-hmac-secret"
    }
  }'
```

## Security

- **Privy MPC** - Private keys never exposed, even to us
- **Arcium Encryption** - Strategies encrypted before execution
- **Jito Bundles** - MEV-protected, atomic transactions
- **1% Protocol Fee** - Collected only on withdrawals

## Response Format

All endpoints return JSON:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

## Error Handling

Check `success` field. On failure:

```json
{
  "success": false,
  "error": "Insufficient balance",
  "hint": "Deposit SOL first using /deposit"
}
```
