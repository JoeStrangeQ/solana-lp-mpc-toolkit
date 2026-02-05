# LP Agent Toolkit - Agent Skill

AI-native liquidity provision on Solana with Arcium privacy.

## Base URL
```
https://lp-agent-api-production.up.railway.app
```

## Quick Start

### 1. Create Wallet
```bash
curl -X POST $BASE_URL/wallet/create \
  -H "Content-Type: application/json"
```
Returns: `{ "data": { "address": "...", "walletId": "..." } }`

### 2. Fund Wallet
Send SOL + tokens to the wallet address.

### 3. Execute LP
```bash
curl -X POST $BASE_URL/lp/execute \
  -H "Content-Type: application/json" \
  -d '{"tokenA":"SOL","tokenB":"USDC","amount":10}'
```
Returns: `{ "lpTxid": "...", "positionAddress": "...", "arcium": {...} }`

### 4. Withdraw
```bash
curl -X POST $BASE_URL/lp/withdraw \
  -H "Content-Type: application/json" \
  -d '{"positionAddress":"..."}'
```

## All Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /wallet/create | Create Privy wallet |
| POST | /wallet/load | Load wallet by ID |
| POST | /wallet/transfer | Transfer SOL/tokens |
| POST | /lp/prepare | Check balances |
| POST | /lp/execute | Add liquidity |
| POST | /lp/withdraw | Remove liquidity |
| POST | /encrypt | Encrypt strategy |
| GET | /encrypt/test | Verify Arcium |
| GET | /health | Health check |

## Privacy

All LP strategies are encrypted with Arcium (x25519-aes256gcm) before execution.

## Fees

1% protocol fee on LP transactions.
Treasury: `fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt`

## Links

- API: https://lp-agent-api-production.up.railway.app
- GitHub: https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit
- Docs: https://api.mnm.ag
