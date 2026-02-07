/**
 * Skill file route for OpenClaw agents
 */
import { Hono } from 'hono';

const app = new Hono();

app.get('/', async (c) => {
  const skillContent = `---
name: lp-agent
description: "Manage Solana LP positions via MnM LP Agent Toolkit. Create wallets, browse pools, add/remove liquidity, monitor positions, claim fees. All transactions Arcium-encrypted and Jito-bundled."
---

# LP Agent Skill

Manage Solana LP positions with natural language. All transactions are Arcium-encrypted and MEV-protected via Jito bundles.

## API Base
\`https://lp-agent-api-production.up.railway.app\`

## Quick Commands

| User Says | Endpoint | Example |
|-----------|----------|---------|
| "Create wallet" | POST /wallet/create | Returns walletId |
| "Check balance" | GET /wallet/:id/balance | SOL + tokens |
| "Show pools" | GET /pools/top | Top pools by TVL |
| "LP X SOL" | POST /lp/atomic | Atomic swap+LP |
| "My positions" | GET /positions/:id | All LP positions |
| "Withdraw" | POST /lp/withdraw/atomic | Atomic withdraw |
| "Claim fees" | POST /fees/claim | Collect LP fees |

## Key Endpoints

### Create Wallet
\`\`\`bash
curl -X POST "https://lp-agent-api-production.up.railway.app/wallet/create"
\`\`\`

### Add Liquidity (Atomic)
\`\`\`bash
curl -X POST "https://lp-agent-api-production.up.railway.app/lp/atomic" \\
  -H "Content-Type: application/json" \\
  -d '{"walletId":"ID","poolAddress":"POOL","amountSol":0.5,"strategy":"concentrated"}'
\`\`\`

### View Positions
\`\`\`bash
curl "https://lp-agent-api-production.up.railway.app/positions/WALLET_ID"
\`\`\`

### Withdraw (Atomic)
\`\`\`bash
curl -X POST "https://lp-agent-api-production.up.railway.app/lp/withdraw/atomic" \\
  -H "Content-Type: application/json" \\
  -d '{"walletId":"ID","poolAddress":"POOL","positionAddress":"POS","convertToSol":true}'
\`\`\`

## Telegram Bot
Users can also use @mnm_lp_bot for the same actions with a button interface.

## Security
- Privy MPC wallets (keys never exposed)
- Arcium-encrypted strategies
- Jito MEV-protected bundles
`;

  c.header('Content-Type', 'text/markdown');
  return c.text(skillContent);
});

export default app;
