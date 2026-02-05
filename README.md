# LP Agent Toolkit

**AI-native liquidity provision on Solana with MPC custody, Arcium privacy, and Jito MEV protection.**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2-12, 2026).

---

## 🎯 What is this?

A toolkit that enables AI agents to manage LP positions through natural language or direct API calls:

```bash
# Natural language
curl -X POST https://api.mnm.ag/chat -d '{"message": "LP $500 into SOL-USDC"}'

# Direct API
curl -X POST https://lp-agent-api-production.up.railway.app/lp/execute \
  -d '{"poolAddress": "BGm1tav...", "amount": 500}'
```

---

## 🔥 Key Features

### 1. Atomic Swap → LP via Jito Bundles
Execute swap and LP in a single atomic transaction. Either both succeed or both fail — no partial execution risk.

```bash
curl -X POST /lp/atomic -d '{
  "inputToken": "SOL",
  "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
  "amount": 0.5,
  "strategy": "spot"
}'
# Returns: bundleId, positionAddress, txSignatures
```

**Why it matters:**
- Swap SOL → USDC + Add liquidity happens atomically
- Jito bundles hide transactions until they land (private mempool)
- MEV bots can't frontrun your LP position
- No stuck funds from partial execution

### 2. Universal Pool Support
Works with ANY Meteora DLMM pool, not just hardcoded pairs:

```bash
# Find pools by token pair
curl /pools/scan?tokenA=JUP&tokenB=SOL

# Get pool info
curl /pool/info?address=YOUR_POOL_ADDRESS

# LP into any pool
curl -X POST /lp/execute -d '{"poolAddress": "...", "amount": 100}'
```

### 3. Arcium Privacy Layer
Strategy parameters are encrypted before execution:

```javascript
// What gets encrypted:
{
  "intent": "atomic_lp",
  "pool": "BGm1tav58oGcs...",
  "amount": 50000000,
  "binRange": [-2537, -2527]
}
// → ciphertext that only you can decrypt
```

**Privacy flow:**
1. Encrypt strategy params with Arcium (x25519 + AES-256-GCM)
2. Build unsigned transactions
3. Sign with Privy MPC wallet
4. Send via Jito bundle (private mempool)
5. Bundle lands atomically — MEV bots see nothing until it's done

### 4. MPC Custody via Privy
Agents transact without ever touching private keys:

```bash
# Create wallet (agent never sees keys)
curl -X POST /wallet/create
# Returns: { walletId, address }

# Sign transactions server-side
curl -X POST /lp/execute -d '{"amount": 100}'
# Privy signs, we broadcast
```

---

## 💎 Value Proposition

| Feature | Traditional | LP Agent Toolkit |
|---------|-------------|------------------|
| **Key Management** | Agent holds private keys 😰 | MPC custody, keys never exposed ✅ |
| **MEV Protection** | Broadcast to public mempool | Jito private bundles ✅ |
| **Strategy Privacy** | Intent visible before execution | Arcium encrypted ✅ |
| **Execution** | Multiple txs, partial failure risk | Atomic bundles ✅ |
| **Pool Support** | Hardcoded pools | Any Meteora DLMM pool ✅ |

---

## 🚀 Quick Start

### For AI Agents

```bash
# 1. Get the skill file (describes all capabilities)
curl https://lp-agent-api-production.up.railway.app/skill.md

# 2. Create a wallet
curl -X POST /wallet/create

# 3. Fund it, then LP
curl -X POST /lp/atomic -d '{
  "inputToken": "SOL",
  "poolAddress": "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y",
  "amount": 0.1
}'
```

### Self-Hosting

```bash
git clone https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit.git
cd solana-lp-mpc-toolkit
pnpm install
cp .env.example .env
# Configure: PRIVY_APP_ID, PRIVY_APP_SECRET, SOLANA_RPC, JUPITER_API_KEY, JITO_API_KEY
pnpm start
```

---

## 📡 API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/skill.md` | GET | Agent skill file |
| `/wallet/create` | POST | Create Privy wallet |
| `/wallet/load` | POST | Load existing wallet |
| `/wallet/transfer` | POST | Transfer SOL or SPL tokens |
| `/pools/scan` | GET | Find pools by token pair |
| `/pool/info` | GET | Get pool details (decimals, price, bins) |
| `/positions` | GET | List all LP positions for a wallet |
| `/lp/execute` | POST | Add liquidity (regular) |
| `/lp/atomic` | POST | Swap → LP atomic via Jito |
| `/lp/withdraw` | POST | Withdraw and close position |
| `/encrypt` | POST | Encrypt strategy with Arcium |

### Natural Language Examples

| What you say | What happens |
|--------------|--------------|
| `"LP $500 into SOL-USDC"` | Add liquidity with automatic pool selection |
| `"Swap all my USDC to SOL"` | Convert tokens via Jupiter aggregator |
| `"LP 50 SOL into the highest APY pool"` | Finds best yield opportunity |
| `"Withdraw my SOL-USDC position"` | Close position and return tokens |
| `"Show my LP positions"` | List all positions with P&L |

---

## 🔐 Security

### What's Protected

| Layer | Protection |
|-------|------------|
| **Keys** | Privy MPC — agent never sees private keys |
| **Strategy** | Arcium encryption — intent hidden until execution |
| **Mempool** | Jito bundles — transactions invisible until landed |
| **Execution** | Atomic bundles — no partial failure states |

### What's NOT Protected

- On-chain transaction data (visible after landing)
- Position details (standard Meteora accounts)
- Your wallet balance (public blockchain)

The privacy is in the **process**, not the final state. This prevents frontrunning and MEV extraction.

---

## ✅ Verified Working (Feb 5, 2026)

**Atomic LP via Jito:**
```
Bundle: 865c90c3538bb73b16753bdd8f92c2cab72cbb963bdcac809883e9390e4676b2
Slot: 398302030
Position: Dm8VteuFXJcQGCHLz2TFKDUoVxuYqLDEiHpLHGcXAy5o
```

**Regular LP with Arcium:**
- [Transaction](https://solscan.io/tx/4bcgk9kkrAiBTDh5DkYTNDjXrsw1KCLjB4xu2W7MSLqigV3MMmvKDovgJqtEzgGVG7nMLi48TbW2Q8F5KnC6LunX)

---

## 🔗 Links

- **API**: https://lp-agent-api-production.up.railway.app
- **Frontend**: https://mnm-web-seven.vercel.app
- **GitHub**: https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit
- **Skill File**: https://lp-agent-api-production.up.railway.app/skill.md

---

## 📜 License

MIT

---

Built with 🦐 by [MnM](https://mnm.ag) for the Colosseum Agent Hackathon
