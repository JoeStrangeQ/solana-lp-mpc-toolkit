# LP Toolkit Skill for Clawdbot

Use when the user wants to:

- Add liquidity to Solana DEX pools
- Check LP positions
- Find best yield opportunities
- Remove liquidity from positions

## Quick Start

```bash
# Start the LP Toolkit API server
cd /path/to/solana-lp-mpc-toolkit
npx tsx src/api/server.ts
```

API runs on `http://localhost:3456`

## Commands

### Scan for Pools

```
User: "What's the best SOL-USDC pool right now?"
```

Call:

```bash
curl "http://localhost:3456/v1/pools/scan?tokenA=SOL&tokenB=USDC&limit=5"
```

Response includes `chatDisplay` ready to forward to user.

### Parse LP Intent

```
User: "Add $500 to the best SOL-USDC pool"
```

Call:

```bash
curl -X POST "http://localhost:3456/v1/intent/parse" \
  -H "Content-Type: application/json" \
  -d '{"text": "Add $500 to the best SOL-USDC pool"}'
```

### Check Positions

```
User: "Show my LP positions"
```

Call:

```bash
curl "http://localhost:3456/v1/positions/USER_WALLET_PUBKEY"
```

### Encrypt Strategy (Privacy)

For private execution via Arcium:

```bash
curl -X POST "http://localhost:3456/v1/encrypt/strategy" \
  -H "Content-Type: application/json" \
  -d '{
    "ownerPubkey": "USER_WALLET_PUBKEY",
    "strategy": {
      "tokenA": "SOL",
      "tokenB": "USDC",
      "totalValueUSD": 500,
      "strategy": "concentrated"
    }
  }'
```

## Example Clawdbot Integration

```typescript
// In your Clawdbot skill handler
async function handleLPRequest(userMessage: string, userWallet: string) {
  const API_BASE = "http://localhost:3456";

  // 1. Parse intent
  const intentRes = await fetch(`${API_BASE}/v1/intent/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: userMessage }),
  });
  const { intent } = await intentRes.json();

  // 2. If scanning, return pool info
  if (intent.action === "scan") {
    const poolsRes = await fetch(
      `${API_BASE}/v1/pools/scan?tokenA=${intent.tokenA}&tokenB=${intent.tokenB}`,
    );
    const { chatDisplay } = await poolsRes.json();
    return chatDisplay; // Ready for Telegram/Discord
  }

  // 3. If checking positions
  if (intent.action === "positions") {
    const posRes = await fetch(`${API_BASE}/v1/positions/${userWallet}`);
    const { chatDisplay } = await posRes.json();
    return chatDisplay;
  }

  // 4. If adding liquidity - encrypt and prepare TX
  if (intent.action === "add_liquidity") {
    const encRes = await fetch(`${API_BASE}/v1/encrypt/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerPubkey: userWallet,
        strategy: intent,
      }),
    });
    const { encrypted } = await encRes.json();

    return `🔐 Strategy encrypted with Arcium MPC
📊 Ready to add ${intent.totalValueUSD} USD to ${intent.tokenA}-${intent.tokenB}
🔑 Only you can decrypt the position details
    
Reply "confirm" to execute.`;
  }
}
```

## Response Formats

All responses include:

- `success: boolean` - Whether the operation succeeded
- `chatDisplay: string` - Pre-formatted text for chat surfaces
- Structured data for programmatic use

## Privacy Features

This toolkit uses Arcium MPC for:

- **Encrypted strategy parameters** - Your LP strategy is private
- **Hidden execution intent** - Prevents front-running
- **Private position values** - Only owner can see amounts

## Supported DEXs

- Meteora DLMM (concentrated)
- Meteora DAMM v2 (full range)
- Orca Whirlpool (concentrated)
- Raydium CLMM (concentrated)
- Saber (stable swaps)
- Lifinity (oracle-based)
- FluxBeam
- Crema
- Invariant

## Troubleshooting

**API not responding:**

- Ensure server is running: `npx tsx src/api/server.ts`
- Check port 3456 is available

**No pools found:**

- Try different token pair
- Some DEX APIs may be temporarily down
- Hardcoded fallback data available

**Encryption errors:**

- Ensure valid Solana public key
- Arcium devnet cluster 456 must be active
