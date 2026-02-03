# Solana LP MPC Toolkit

**A unified, privacy-preserving interface for AI agents to manage LP positions across Solana DEXs**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2026)

[![Arcium](https://img.shields.io/badge/Privacy-Arcium%20MPC-blue)]()
[![DEXs](https://img.shields.io/badge/DEXs-9%20Supported-green)]()

---

## What is this?

LP MPC Toolkit lets AI agents (chatbots, automated systems) discover and manage liquidity positions across **9 Solana DEXs** through a unified API with **privacy-preserving execution via Arcium**.

Instead of learning each DEX's SDK separately, agents can:
- Scan for the best yield opportunities across all venues
- Execute LP operations with encrypted parameters
- Track positions with natural language updates
- Receive alerts when positions need attention

---

## Key Features

### 🔐 Privacy via Arcium MPC
- **Real SDK integration** - x25519 key exchange, RescueCipher encryption
- Strategy parameters encrypted before execution
- Position sizes hidden from observers
- Prevents front-running and copy-trading

### 🤖 Agent-Native Design
- Natural language intent parsing ("put 2 SOL to work")
- Yield updates formatted for chat ("Earning ~$1.80/day")
- Position alerts ("⚠️ Your Meteora position is out of range")
- Agent-to-Agent API for bot-to-bot communication

### 📊 9 DEX Adapters
| DEX | Type | IL Risk |
|-----|------|---------|
| Meteora DLMM | Concentrated | Standard |
| Meteora DAMM v2 | Full Range | Lower |
| Orca Whirlpool | Concentrated | Standard |
| Raydium CLMM | Concentrated | Standard |
| Lifinity | Oracle-based | ~60% reduced |
| Saber | Stable Swap | ~90% reduced |
| Crema | Concentrated | Standard |
| FluxBeam | Concentrated | Standard |
| Invariant | CLMM | Standard |

---

## Quick Start

```typescript
import { 
  createYieldScanner, 
  parseIntent,
  formatPoolRecommendation,
  ArciumPrivacyService,
  createYieldMonitor,
} from 'solana-lp-mpc-toolkit';

// 1. Natural language parsing
const intent = parseIntent("put 2 SOL to work");
// { type: 'add_liquidity', params: { amount: 400, tokenA: 'SOL' } }

// 2. Find best pool across all DEXs
const scanner = createYieldScanner(connection);
const { pools, recommended } = await scanner.scanPools({
  tokenA: intent.params.tokenA,
  minApy: 10,
});

// 3. Format for chat (agent-native)
const message = formatPoolRecommendation(pools, intent.params.amount);
// "🥇 Meteora SOL-USDC - 45% APY → ~$1.80/day"

// 4. Execute with privacy
const privacy = new ArciumPrivacyService(userPubkey);
await privacy.initialize(connection, programId);
const encrypted = privacy.encryptStrategy(intent);

// 5. Monitor and get natural language updates
const monitor = createYieldMonitor(connection, userPubkey);
const updates = await monitor.checkAndReport();
// "💰 SOL-USDC: You have $42.50 in fees ready to claim"
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CHAT INTERFACE                            │
│  "LP $500 into best SOL-USDC pool"                          │
│  Intent Parser → Natural Language Understanding              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 ARCIUM PRIVACY LAYER                         │
│  x25519 Key Exchange → RescueCipher → MXE Execution         │
│  Strategy params encrypted, position sizes hidden            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              UNIFIED DEX ADAPTER LAYER (9 DEXs)             │
│  Meteora │ Orca │ Raydium │ Lifinity │ Saber │ + 4 more    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               YIELD MONITOR (Agent Updates)                  │
│  Natural language alerts, position tracking, fee reminders   │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent-to-Agent API

Other bots can use the toolkit via REST API:

```bash
# Get best pools
GET /pools?tokenA=SOL&tokenB=USDC

# Get quote with fee calculation
POST /quote { tokenA: "SOL", amountUSD: 500 }

# Execute LP operation (requires auth)
POST /execute { action: "add", venue: "meteora", ... }

# Natural language interpretation
POST /interpret { text: "find me some yield" }
```

**Fee Structure:** 0.1% per LP transaction (70% treasury, 30% referrer)

---

## LP Strategies

| Strategy | Range | Best For |
|----------|-------|----------|
| Balanced | ±20% | Beginners, set-and-forget |
| Concentrated | ±5% | Active traders, fee maximizers |
| Yield-Max | ±50% | Passive income, volatile pairs |
| Delta-Neutral | ±30% | Risk-averse, hedged positions |
| Bid-Heavy | Skewed buy | DCA, accumulating token A |
| Ask-Heavy | Skewed sell | Taking profits, exit strategy |

---

## Project Structure

```
src/lp-toolkit/
├── adapters/           # 9 DEX adapters
│   ├── meteora.ts
│   ├── meteora-damm.ts
│   ├── orca.ts
│   ├── raydium.ts
│   ├── lifinity.ts
│   ├── saber.ts
│   ├── crema.ts
│   ├── fluxbeam.ts
│   └── invariant.ts
├── services/
│   ├── yieldScanner.ts     # Cross-DEX yield comparison
│   ├── arciumPrivacy.ts    # Arcium SDK integration
│   ├── privateExecutor.ts  # Private LP execution
│   └── yieldMonitor.ts     # Natural language updates
├── api/
│   ├── chatCommands.ts     # /lp commands
│   ├── intentParser.ts     # Natural language parsing
│   ├── chatDisplay.ts      # Agent-native formatting
│   └── agentApi.ts         # Bot-to-bot API
├── strategies/
│   └── templates.ts        # 6 LP strategies
├── fees/
│   └── feeCollector.ts     # Protocol fee collection
└── index.ts                # Main exports
```

---

## Tech Stack

- **Privacy**: Arcium MPC (x25519, RescueCipher)
- **Blockchain**: Solana Web3.js
- **DEX SDKs**: Meteora, Orca, Raydium, Lifinity, Saber
- **State**: Convex (position tracking)
- **Language**: TypeScript

---

## Status

This is a hackathon project. Core functionality is implemented:
- ✅ 9 DEX adapters
- ✅ Arcium privacy integration
- ✅ Natural language parsing
- ✅ Yield monitoring
- ✅ Agent API

---

## License

MIT
