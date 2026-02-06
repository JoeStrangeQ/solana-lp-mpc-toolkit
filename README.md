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
└──────────┬─────────────────────────────────┬────────────────┘
           │                                 │
   ┌───────▼───────┐                 ┌───────▼───────┐
   │  @mnm_lp_bot  │                 │   Terminal    │
   │   Telegram    │                 │  (Clawdbot)   │
   └───────┬───────┘                 └───────┬───────┘
           │                                 │
           │     "LP 1 SOL into SOL-USDC"    │
           └─────────────┬───────────────────┘
                         │
                         ▼
           ┌─────────────────────────────┐
           │     LP Agent Toolkit API     │
           │  🔐 Arcium | ⚡ Jito | 🔑 MPC │
           └─────────────────────────────┘
```

**Same result, any surface.** Natural language everywhere.

---

## ✨ What Makes This Different

| Traditional LP | LP Agent Toolkit |
|----------------|------------------|
| Swap tokens first | SOL in → Position out |
| Exposed to MEV | Jito-bundled |
| Manage keys yourself | MPC custody (Privy) |
| Manual monitoring | 24/7 automated alerts |
| CLI only | Telegram + Terminal + API |

---

## 🚀 Quick Start

### Option 1: Telegram Bot

1. Open [@mnm_lp_bot](https://t.me/mnm_lp_bot)
2. Send `/start` to create your wallet
3. Deposit SOL to the address
4. Send `/pools` to see opportunities
5. Tap a pool → Pick amount → Done!

Or just type naturally: *"LP 0.5 SOL into the best pool"*

### Option 2: AI Agent (OpenClaw/Claude)

```bash
# Download the skill
curl -o ~/.openclaw/skills/lp-agent/SKILL.md \
  https://lp-agent-api-production.up.railway.app/skill.md

# Connect your wallet
curl -X POST "https://lp-agent-api-production.up.railway.app/openclaw/connect" \
  -H "Content-Type: application/json" \
  -d '{"walletId": "YOUR_WALLET_ID"}'
```

Then just tell your agent: *"Check my LP positions"* or *"Withdraw from SOL-USDC"*

### Option 3: Direct API

```bash
# Create wallet
curl -X POST https://lp-agent-api-production.up.railway.app/wallet/create

# Atomic LP (SOL → swap → position in one bundle)
curl -X POST https://lp-agent-api-production.up.railway.app/lp/atomic \
  -H "Content-Type: application/json" \
  -d '{"walletId": "...", "poolAddress": "...", "amountSol": 0.5}'
```

---

## 💬 Natural Language Commands

Works in **both** Telegram and Terminal:

| You Say | Action |
|---------|--------|
| "LP 0.5 SOL into SOL-USDC" | Opens concentrated position |
| "Check my balance" | Shows wallet balance |
| "What are the top pools?" | Lists pools by TVL/APY |
| "Show my positions" | Displays all LP with P&L |
| "Withdraw from MET-USDC" | Closes position, returns SOL |
| "Claim my fees" | Collects earned fees |
| "Rebalance my positions" | Re-centers around current price |

---

## 📱 Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Create wallet or show existing |
| `/balance` | Check wallet balance & tokens |
| `/pools` | Browse top pools with LP buttons |
| `/positions` | View positions with details + actions |
| `/deposit` | Get deposit address |
| `/withdraw` | Withdraw funds |
| `/settings` | Alert preferences |
| `/help` | All commands |

---

## 🔔 Monitoring & Alerts

Positions are checked every 5 minutes:

- **Out of Range** → Instant Telegram notification
- **Back in Range** → Confirmation alert
- **Rebalance Needed** → One-tap fix

Configure via `/settings` or webhook for your agent.

---

## 📡 API Reference

**Base URL:** `https://lp-agent-api-production.up.railway.app`

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/wallet/create` | POST | Create MPC wallet |
| `/wallet/:id/balance` | GET | Check balance |
| `/pools/top` | GET | Top pools by TVL |
| `/positions/:walletId` | GET | List LP positions |
| `/lp/execute` | POST | ⚡ Full LP: build + sign + submit (Jito) |
| `/lp/withdraw/execute` | POST | ⚡ Full withdraw: build + sign + submit (Jito) |
| `/lp/atomic` | POST | Build LP bundle (unsigned) |
| `/lp/withdraw/atomic` | POST | Build withdraw bundle (unsigned) |
| `/fees/claim` | POST | Claim LP fees |
| `/lp/rebalance/execute` | POST | Atomic rebalance |

### Integration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/skill.md` | GET | OpenClaw skill file |
| `/openclaw/connect` | POST | One-call agent setup |
| `/openclaw/setup` | GET | Step-by-step guide |
| `/telegram/send` | POST | Send via bot (for agents) |
| `/notify/register` | POST | Configure alerts |

---

## 🔐 Security Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                        │
├──────────────────────────────────────────────────────────┤
│  🔑 MPC CUSTODY (Privy)                                  │
│     Private keys sharded, never reconstructed            │
│     No seed phrases, no exposure                         │
├──────────────────────────────────────────────────────────┤
│  🔐 ARCIUM ENCRYPTION                                    │
│     Strategy encrypted before execution                  │
│     Parameters hidden until settlement                   │
├──────────────────────────────────────────────────────────┤
│  ⚡ JITO BUNDLES                                         │
│     Atomic execution (all or nothing)                    │
│     Private mempool (no frontrunning)                    │
├──────────────────────────────────────────────────────────┤
│  🔒 WEBHOOK SECURITY                                     │
│     HMAC-SHA256 signatures                               │
│     Per-wallet secrets                                   │
└──────────────────────────────────────────────────────────┘
```

**What's protected:**
- ✅ Private keys never leave MPC
- ✅ Strategies encrypted end-to-end
- ✅ Transactions MEV-protected
- ✅ Webhook payloads signed
- ✅ No secrets in client code

---

## 💰 Fee Structure

| Fee | Rate | When |
|-----|------|------|
| Protocol | 1% | On withdrawals |
| Jito Tip | ~0.0001 SOL | Per bundle |
| Network | ~0.001 SOL | Standard fees |

Treasury: `fAihKpm56DA9v8KU7dSifA1Qh4ZXCjgp6xF5apVaoPt`

---

## 🔗 Links

| Resource | URL |
|----------|-----|
| **API** | https://lp-agent-api-production.up.railway.app |
| **Docs** | https://api.mnm.ag |
| **Telegram** | [@mnm_lp_bot](https://t.me/mnm_lp_bot) |
| **Skill File** | [/skill.md](https://lp-agent-api-production.up.railway.app/skill.md) |
| **GitHub** | [solana-lp-mpc-toolkit](https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit) |

---

## 🏆 Hackathon Submission

**Colosseum Agent Hackathon** (Feb 2-12, 2026)

- **Track:** DeFi Agents
- **Agent ID:** 17
- **Name:** MnM LP Agent Toolkit

---

Built with 🦐 by [MnM](https://mnm.ag)
