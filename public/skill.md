# LP Agent Toolkit - Agent Skill

AI-native liquidity provision on Solana with Arcium privacy and Jito MEV protection.

## Base URL
```
https://lp-agent-api-production.up.railway.app
```

## Quick Start

### 1. Create Wallet (MPC custody, no seed phrase)
```bash
curl -X POST $BASE_URL/wallet/create \
  -H "Content-Type: application/json"
```
Response: `{ "data": { "address": "...", "walletId": "..." } }`

### 2. Fund Wallet
Send SOL to the wallet address. That's it - no need to pre-swap.

### 3. Discover Pools
```bash
curl "$BASE_URL/pools/top?tokenA=SOL&tokenB=USDC"
```
Response: Top 3 pools ranked by TVL with recommendations.

### 4. Add Liquidity (Atomic: SOL → Swap → LP in one bundle)
```bash
curl -X POST $BASE_URL/lp/atomic \
  -H "Content-Type: application/json" \
  -d '{
    "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
    "amount": 0.5,
    "strategy": "concentrated"
  }'
```
- Swaps SOL → pool tokens automatically
- Executes via Jito bundle (MEV protected)
- Auto-retries with escalating slippage (3% → 10%)
- Strategy encrypted with Arcium

### 5. Withdraw (with auto-convert to SOL)
```bash
curl -X POST $BASE_URL/lp/withdraw/atomic \
  -H "Content-Type: application/json" \
  -d '{
    "positionAddress": "YOUR_POSITION",
    "poolAddress": "POOL_ADDRESS",
    "convertToSol": true
  }'
```
- Withdraws LP position
- Swaps tokens back to SOL
- 1% fee sent to treasury
- Fallback: returns pool tokens if swap fails

## Endpoints Reference

### Wallet Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/wallet/create` | Create new Privy MPC wallet |
| POST | `/wallet/load` | Load existing wallet by ID |
| GET | `/wallet/{address}` | Get wallet balances |
| POST | `/wallet/transfer` | Transfer SOL/tokens |

### Pool Discovery
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/pools/top` | Top 3 pools by TVL for token pair |
| GET | `/pools/scan` | Scan all DLMM pools |

### Liquidity Provision
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/lp/atomic` | **Recommended**: Atomic swap+LP via Jito |
| POST | `/lp/execute` | Direct LP (requires pre-swapped tokens) |
| POST | `/lp/withdraw/atomic` | Atomic withdraw + convert to SOL |
| POST | `/lp/withdraw` | Basic withdraw |
| GET | `/positions` | List open LP positions |

### Token Swaps
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/swap/quote` | Get Jupiter swap quote |
| POST | `/swap` | Execute swap |
| GET | `/swap/tokens` | List supported tokens |

### Privacy & Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/encrypt` | Encrypt strategy with Arcium |
| GET | `/health` | Service health check |

## Strategy Options

| Strategy | Bin Range | Best For |
|----------|-----------|----------|
| `concentrated` | ±5 bins | High capital efficiency, active management |
| `wide` | ±20 bins | Lower IL, passive management |
| `custom` | User-defined | Advanced strategies |

## Parameters

### `/lp/atomic`
```json
{
  "poolAddress": "string",     // Required: Meteora DLMM pool
  "amount": 0.5,               // Required: SOL amount
  "strategy": "concentrated",  // Optional: concentrated|wide|custom
  "slippageBps": 300,          // Optional: basis points (default: 300 = 3%)
  "tipSpeed": "fast"           // Optional: fast|turbo for Jito
}
```

### `/lp/withdraw/atomic`
```json
{
  "positionAddress": "string", // Required: Position to close
  "poolAddress": "string",     // Required: Pool address
  "convertToSol": true         // Optional: Swap tokens to SOL
}
```

## Features

- **Jito Bundles**: All transactions MEV-protected
- **Auto-Retry**: Slippage escalates 300 → 500 → 750 → 1000 bps
- **Arcium Privacy**: Strategy parameters encrypted before execution
- **MPC Custody**: Privy wallets, no seed phrase exposure
- **1% Protocol Fee**: On LP transactions, to treasury

## Fees

| Type | Amount |
|------|--------|
| Protocol fee | 1% on LP |
| Treasury | `fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt` |

## Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 6004 | Bin slippage exceeded | Auto-retried with higher slippage |
| Timeout | Bundle didn't land | Retry with `tipSpeed: "turbo"` |

## Links

- **API**: https://lp-agent-api-production.up.railway.app
- **GitHub**: https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit
- **Frontend**: https://api.mnm.ag
