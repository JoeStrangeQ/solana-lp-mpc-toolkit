# LP Agent Toolkit - Demo Plan

**Colosseum Agent Hackathon** | Feb 2-12, 2026  
**Team:** MnM  
**Project:** AI-native LP management on Solana with MPC custody & Arcium privacy

---

## 📹 Demo Script (2-3 minutes)

### Opening Hook (15 sec)

**Show:** Terminal with "LP Agent Toolkit" banner

**Say:**
> "What if AI agents could manage DeFi liquidity without exposing their strategies to front-runners? Meet LP Agent Toolkit - the first privacy-preserving LP toolkit designed for AI agents on Solana."

---

### Scene 1: The Problem (20 sec)

**Show:** Split screen - trading bot logs / MEV sandwich attack on Solscan

**Say:**
> "AI agents managing DeFi positions have a problem: everything is on-chain. When an agent adds liquidity, MEV bots see it coming. When they rebalance, competitors copy their moves. Strategy becomes a liability."

---

### Scene 2: The Solution (30 sec)

**Show:** Architecture diagram → API server starting

**Terminal:**
```bash
pnpm start
# Shows: 🚀 LP Agent Toolkit
#        📡 Gateway connected
#        🔐 Privy wallets ready
#        🛡️ Arcium privacy initialized
```

**Say:**
> "LP Agent Toolkit solves this with three innovations:
> 1. **Privy embedded wallets** - agents get secure custody without touching private keys
> 2. **Arcium privacy** - strategy parameters encrypted until execution
> 3. **Agent-first API** - one REST endpoint for swaps, LP, and position management"

---

### Scene 3: Natural Language Interface (30 sec)

**Terminal:**
```bash
curl -X POST localhost:3456/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "LP $500 into SOL-USDC"}'
```

**Show:** Parsed intent + pool analysis response

**Say:**
> "Agents speak in natural language. 'LP 500 dollars into SOL-USDC' gets parsed into a structured intent, the toolkit finds the optimal Meteora DLMM pool, calculates the 50/50 split, and returns what needs to happen."

---

### Scene 4: Privacy Layer (45 sec) ⭐ KEY DIFFERENTIATOR

**Terminal:**
```bash
curl localhost:3456/health
# Shows: arcium: initialized

curl -X POST localhost:3456/position/open \
  -d '{"dex": "meteora", "pair": "SOL-USDC", "amount": 500, "strategy": "balanced"}'
```

**Show:** Response with `encryptedStrategy` field

**Say:**
> "Here's the magic: before any transaction hits the chain, Arcium encrypts the strategy. The amount, the price range, the pool - all hidden from MEV bots. Only the agent's wallet can authorize the decrypted execution.
>
> This isn't theoretical - we're using Arcium's MXE cluster with real x25519 encryption."

---

### Scene 5: Swap Pipeline (30 sec)

**Terminal:**
```bash
curl -X POST localhost:3456/swap \
  -d '{"inputToken": "SOL", "outputToken": "USDC", "amount": 1}'
```

**Show:** Response with Jupiter route + txid

**Say:**
> "The toolkit handles swaps through Jupiter's aggregator - best routes across all Solana DEXs. Agents don't need to integrate multiple SDKs. One API, all of DeFi."

---

### Close (20 sec)

**Show:** GitHub repo / README

**Say:**
> "LP Agent Toolkit: Natural language. Privy custody. Arcium privacy. Built for agents, by agents.
>
> github.com/JoeStrangeQ/solana-lp-mpc-toolkit"

---

## ✅ Live Demo Checklist

### Pre-Demo Setup (30 min before)

- [ ] **Environment ready**
  ```bash
  cd /Users/clawd/clawd/mnm-leverage
  cp .env.example .env
  # Fill in: PRIVY_APP_ID, PRIVY_APP_SECRET, JUPITER_API_KEY, SOLANA_RPC (Helius)
  ```

- [ ] **Server running**
  ```bash
  pnpm install
  pnpm start
  # Verify: curl localhost:3456 → shows version 2.0.0
  ```

- [ ] **Test wallet funded**
  - Create wallet: `curl -X POST localhost:3456/wallet/create`
  - Save address from response
  - Send 0.1 SOL + 20 USDC (for live demo)
  - Confirm: `curl localhost:3456/health` → `wallet: loaded (privy)`

- [ ] **Solscan tab open** - Ready to show transaction confirmations

- [ ] **Terminal font size** - 18pt minimum, dark theme

### Demo Endpoints (in order)

| Step | Endpoint | Expected Response |
|------|----------|-------------------|
| 1 | `GET /` | `version: 2.0.0, status: running` |
| 2 | `GET /health` | `gateway: connected, wallet: loaded, arcium: initialized` |
| 3 | `POST /chat` | Intent parsed, pool info returned |
| 4 | `GET /swap/quote?inputToken=SOL&outputToken=USDC&amount=100000000` | Jupiter quote with route |
| 5 | `POST /swap` | Transaction executed, txid returned |
| 6 | `POST /position/open` | encryptedStrategy + position opened |
| 7 | `GET /positions` | Shows the new position |

### Fallback Plan

If live transactions fail:
1. Use `GET /swap/quote` (no execution, always works)
2. Show POST requests with `"dryRun": true` if we add that
3. Have pre-recorded successful transaction URLs ready

---

## 🎯 Pitch Angles

### For Judges (Technical Innovation)

**Lead with:**
> "We integrated three bleeding-edge technologies into one agent-native toolkit"

**Key points:**
1. **First Arcium integration for LP privacy** - Strategy parameters encrypted on-chain
2. **Privy server-side wallets for agents** - No key exposure, deterministic signing
3. **Intent parser handles real DeFi commands** - Tested with actual Claude/GPT outputs
4. **Full pipeline orchestration** - Swap → rebalance → LP in one call

**Technical flex:**
- Meteora DLMM bin-range calculation
- Jupiter route aggregation
- Automatic 50/50 rebalancing with slippage protection

### For Users (Problem/Solution)

**Hook:**
> "Your trading strategy is your edge. Why should the whole chain see it before you execute?"

**Pain points we solve:**
1. **MEV sandwich attacks** - Your LP gets front-run, you lose value
2. **Strategy copying** - Competitors mirror your successful positions
3. **Key management nightmare** - Running a hot wallet for your agent is terrifying

**Our solution:**
- Encrypt strategy → execute privately → no one sees your moves
- Privy handles keys → your agent never touches secrets
- One API → don't integrate 9 DEX SDKs

### For Investors (Market Opportunity)

**Market size:**
- Solana DeFi TVL: $4B+ (and growing)
- AI agent market: $100B+ projected by 2027
- MEV extracted on Solana: $500M+ annually

**Why now:**
- Arcium just launched devnet - we're early adopters
- Agent frameworks (CrewAI, LangChain) exploding
- Privy server wallets = secure agent custody finally possible

**Moat:**
- First-mover on privacy LP toolkit
- Integration complexity keeps out casual competitors
- Relationships with Arcium, Privy, Jupiter teams

**Business model paths:**
1. **Protocol fee** - 1% on LP operations (already built in)
2. **SaaS for agent operators** - Hosted version with dashboard
3. **Whitelabel for trading desks** - Custom deployments

---

## 🎨 Visual Assets Needed

### 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent / Chat                          │
│              "LP $500 into SOL-USDC"                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               LP AGENT TOOLKIT API                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Intent   │  │ Arcium   │  │ Privy    │  │ Pipeline │   │
│  │ Parser   │  │ Privacy  │  │ Wallets  │  │ Logic    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Jupiter  │ │ Meteora  │ │ Solana   │
    │ (Swaps)  │ │ (DLMM)   │ │ (RPC)    │
    └──────────┘ └──────────┘ └──────────┘
```

**Create in:** Figma or Excalidraw  
**Style:** Clean, dark background, neon accents (matches Solana aesthetic)

### 2. Screenshots Needed

| Screenshot | Source | Notes |
|------------|--------|-------|
| Server startup | Terminal | Shows all components initialized |
| /chat response | curl + jq | Highlighted intent parsing |
| /swap/quote | curl + jq | Show Jupiter route |
| Encrypted strategy | curl response | Highlight ciphertext field |
| Position created | curl + Solscan | Link to actual transaction |
| /positions list | curl + jq | Show position with bin range |

### 3. Demo GIF (optional but high impact)

**15-second loop showing:**
1. User types "LP $100 into SOL-USDC"
2. Terminal shows API call
3. Response shows encrypted strategy
4. Solscan shows successful transaction

**Tool:** asciinema → gif converter

### 4. Slide Deck (if presenting)

| Slide | Content |
|-------|---------|
| 1 | Title + logo + tagline |
| 2 | The problem (MEV, strategy exposure) |
| 3 | Our solution (3 pillars) |
| 4 | Architecture diagram |
| 5 | Live demo (embedded video or live) |
| 6 | Technical differentiators |
| 7 | Market opportunity |
| 8 | Team + links |

---

## 🗓️ Demo Recording Checklist

- [ ] Clean desktop (hide personal files, notifications off)
- [ ] Terminal: iTerm2 with Solarized Dark, 18pt Fira Code
- [ ] Browser: Solscan in dark mode, bookmarked
- [ ] Audio: Good mic, no background noise
- [ ] Test recording: 30 sec test → check audio levels
- [ ] Backup plan: Have curl commands in a script, not typed live

### Recording Flow

```bash
# Have this script ready:
#!/bin/bash

echo "=== LP Agent Toolkit Demo ==="

echo "\n1. Health check..."
curl -s localhost:3456/health | jq

echo "\n2. Natural language parsing..."
curl -s -X POST localhost:3456/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "LP $500 into SOL-USDC"}' | jq

echo "\n3. Swap quote..."
curl -s "localhost:3456/swap/quote?inputToken=SOL&outputToken=USDC&amount=100000000" | jq

# Continue with live calls only if wallet is funded
```

---

## 📝 Notes

**What makes this UNIQUE:**
1. **Agent-native from day 1** - Not a DeFi tool with agent wrapper, but built for agents
2. **Privacy as feature** - Arcium isn't an afterthought, it's core architecture
3. **No wallet exposure** - Privy server wallets mean agents never see keys

**Potential questions from judges:**
- "How does Arcium prevent front-running?" → Explain MXE encryption timing
- "What happens if Privy goes down?" → Discuss key recovery, self-custody path
- "Why not just use a centralized solution?" → Explain the decentralization value prop

**Links to have ready:**
- GitHub repo
- Arcium docs: https://docs.arcium.com
- Privy docs: https://docs.privy.io
- Meteora DLMM: https://docs.meteora.ag
- Jupiter API: https://docs.jup.ag

---

*Last updated: Auto-generated demo plan*
