# 🦐 Solana LP MPC Toolkit

**Privacy-Preserving Liquidity Provision for AI Agents**

An agent-native toolkit for discovering, executing, and managing LP positions across Solana DEXs with **Arcium MPC encryption** for strategy privacy.

[![Built with Arcium](https://img.shields.io/badge/Built%20with-Arcium%20MPC-blue)](https://arcium.com)
[![Solana](https://img.shields.io/badge/Solana-Devnet-green)](https://solana.com)
[![Colosseum Hackathon](https://img.shields.io/badge/Colosseum-Agent%20Hackathon-purple)](https://colosseum.com)

---

## 🎯 Problem

AI agents managing DeFi positions face critical challenges:

1. **Strategy Leakage** - On-chain transactions reveal LP parameters, enabling front-running
2. **Fragmented DEXs** - Each DEX has different SDKs, APIs, and position formats
3. **No Agent-Native Interface** - Existing tools designed for humans, not bots
4. **Position Visibility** - Competitors can see your exact positions and copy strategies

## 💡 Solution

The **Solana LP MPC Toolkit** provides:

### 🔐 Privacy via Arcium MPC
- **Encrypted strategy parameters** before any on-chain execution
- **Private position values** - only the owner can decrypt
- **Hidden execution intent** - prevent MEV and front-running
- Uses real Arcium devnet MXE with x25519 key exchange + RescueCipher

### 🔌 Unified DEX Adapters
One interface for 9 Solana DEXs:
- **Meteora DLMM** - Dynamic liquidity market maker
- **Meteora DAMM v2** - Dynamic AMM
- **Orca Whirlpool** - Concentrated liquidity
- **Raydium CLMM** - Concentrated liquidity
- **Lifinity** - Oracle-based AMM
- **Saber** - Stable swaps
- **Crema** - Concentrated liquidity
- **FluxBeam** - AMM
- **Invariant** - Concentrated liquidity

### 💬 Chat-Native Interface
Natural language commands for Telegram/Discord:
```
"Add $500 to the best SOL-USDC pool"
"Show my LP positions"
"What's the top yielding stablecoin pool?"
```

### 📊 Position Tracking
- Real-time position values across all venues
- Yield earned and fees collected
- Impermanent loss calculations
- Rebalance alerts

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CHAT INTERFACE                            │
│  Telegram │ Discord │ API │ SDK                             │
│  "LP $500 into best SOL-USDC pool"                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              INTENT PARSER & STRATEGY ENGINE                 │
│  - Natural language → structured intent                      │
│  - Query all DEXs for opportunities                          │
│  - Rank by APY / IL risk / liquidity                         │
│  - Select optimal venue + strategy                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               ARCIUM PRIVACY LAYER (MPC)                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  x25519 Key Exchange → Shared Secret                │    │
│  │  RescueCipher Encryption → Private Parameters       │    │
│  │  Only owner can decrypt position values             │    │
│  └─────────────────────────────────────────────────────┘    │
│  MXE Public Key: 01aea1bb8d42745aa30dd68e1358bd54...        │
│  Cluster: 456 (Devnet v0.7.0)                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              UNIFIED DEX ADAPTER LAYER                       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│  │Meteora │ │  Orca  │ │Raydium │ │Lifinity│ │ Saber  │    │
│  │ DLMM   │ │Whirlpl │ │  CLMM  │ │        │ │        │    │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐               │
│  │ Crema  │ │FluxBeam│ │Invarint│ │DAMM v2 │               │
│  └────────┘ └────────┘ └────────┘ └────────┘               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                CONVEX POSITION TRACKER                       │
│  - Real-time position values (encrypted)                     │
│  - Historical yield tracking                                 │
│  - Fee collection for agent-to-agent usage                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 Arcium Integration

We use **real Arcium MPC** for privacy, not mock encryption:

### How It Works

1. **Key Generation**: Client generates x25519 keypair
2. **Shared Secret**: Derived from client private key + MXE public key
3. **RescueCipher**: Arcium's MPC-friendly symmetric cipher
4. **Encrypted Execution**: Strategy params encrypted before any TX

```typescript
import { ArciumPrivacyService, ARCIUM_DEVNET_CONFIG } from './services/arciumPrivacy';

// Initialize with real devnet MXE key
const privacy = new ArciumPrivacyService(ownerPubkey);
await privacy.initializeDevnet();

// Encrypt strategy before execution
const encrypted = privacy.encryptStrategy({
  tokenA: 'SOL',
  tokenB: 'USDC',
  amountA: 10,
  totalValueUSD: 2000,
  strategy: 'concentrated',
  slippageBps: 50,
});

// Only owner with private key can decrypt
const decrypted = privacy.decryptStrategy(encrypted);
```

### Devnet Configuration

```typescript
ARCIUM_DEVNET_CONFIG = {
  clusterOffset: 456,  // v0.7.0
  mxePublicKey: '01aea1bb8d42745aa30dd68e1358bd54b819e64a313df67c83c67a6b95fd5a64',
  clusterAuthority: 'CkgyeACNCpPMzDt2b8n41jTit63VehY1ghPXNU9Lnz8L',
  clusterSize: 2,
}
```

---

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit.git
cd solana-lp-mpc-toolkit

# Install dependencies
npm install

# Run tests
npm test
```

### Test Arcium Encryption

```bash
npx tsx scripts/test-arcium-encryption.ts
```

Expected output:
```
🔐 Testing Arcium Encryption with REAL Devnet MXE Key
✅ Key derivation successful!
✅ RescueCipher roundtrip successful!
✅ Strategy encryption roundtrip successful!
✅ Position value encryption roundtrip successful!
🎉 ALL TESTS PASSED!
```

### Fetch MXE Public Key

```bash
npx tsx scripts/fetch-mxe-key.ts
```

---

## 💬 Chat Commands

### For Telegram/Discord Bots

```
/lp scan                     - Show top LP opportunities
/lp scan SOL-USDC            - Best pools for specific pair
/lp add $500 SOL-USDC        - Add liquidity to best pool
/lp positions                - Show all your positions
/lp yield                    - Show yield earned
/lp remove <position_id>     - Remove liquidity
```

### Natural Language (via Intent Parser)

```
"What's the best pool for SOL-USDC right now?"
"Add $1000 to a concentrated liquidity position"
"Show me stablecoin pools with >20% APY"
"Remove half my liquidity from Meteora"
```

---

## 📁 Project Structure

```
src/lp-toolkit/
├── adapters/           # DEX integrations
│   ├── meteora.ts      # Meteora DLMM
│   ├── meteoraDamm.ts  # Meteora DAMM v2
│   ├── orca.ts         # Orca Whirlpool
│   ├── raydium.ts      # Raydium CLMM
│   ├── lifinity.ts     # Lifinity
│   ├── saber.ts        # Saber
│   ├── crema.ts        # Crema
│   ├── fluxbeam.ts     # FluxBeam
│   ├── invariant.ts    # Invariant
│   └── types.ts        # Unified types
├── services/
│   ├── arciumPrivacy.ts    # 🔐 Arcium MPC encryption
│   ├── yieldScanner.ts     # Cross-DEX yield discovery
│   ├── yieldMonitor.ts     # Natural language alerts
│   └── strategyTemplates.ts # Pre-built strategies
├── api/
│   ├── chatCommands.ts     # Telegram/Discord commands
│   ├── chatDisplay.ts      # Agent-friendly formatting
│   ├── intentParser.ts     # NL → structured intent
│   └── agentApi.ts         # Agent-to-agent API
└── fees/
    └── feeCollector.ts     # Protocol fee collection

convex/
├── lpPositions.ts      # Position schema
└── lpToolkit.ts        # Backend functions

scripts/
├── fetch-mxe-key.ts        # Fetch Arcium MXE key
├── test-arcium-encryption.ts # Verify encryption
└── test-dex-apis.ts        # Test DEX connections
```

---

## 🎯 Strategy Templates

Pre-built strategies for common LP scenarios:

| Strategy | Description | Risk | Best For |
|----------|-------------|------|----------|
| `balanced` | 50/50 split, wide range | Low | Beginners |
| `concentrated` | Tight range around price | Medium | Active management |
| `yield-max` | Highest APY, any risk | High | Yield farmers |
| `delta-neutral` | Hedge IL with perps | Low | Risk-averse |
| `bid-heavy` | Accumulate base token | Medium | Bulls |
| `ask-heavy` | Accumulate quote token | Medium | Bears |

---

## 💰 Fee Model

For agent-to-agent usage:

```
Fee: 0.1% per LP transaction
Split: 70% protocol treasury / 30% referrer
Payment: USDC
```

---

## 🛣️ Roadmap

### Phase 1: Hackathon MVP ✅
- [x] 9 DEX adapters
- [x] Arcium privacy integration
- [x] Chat command interface
- [x] Position tracking schema
- [x] Strategy templates

### Phase 2: Production (Q1 2026)
- [ ] Mainnet deployment
- [ ] Auto-rebalancing
- [ ] IL hedging integration
- [ ] Multi-chain support

### Phase 3: Agent Network (Q2 2026)
- [ ] Agent-to-agent marketplace
- [ ] Strategy sharing (encrypted)
- [ ] Reputation system
- [ ] DAO governance

---

## 🏆 Hackathon Submission

**Colosseum Agent Hackathon (Feb 2-12, 2026)**

- **Agent ID:** 17
- **Project:** Solana LP MPC Toolkit
- **Category:** DeFi Infrastructure
- **Unique Value:** First privacy-preserving LP toolkit for AI agents

### Why Arcium?

Traditional LP tools expose everything on-chain:
- Entry/exit prices
- Position sizes
- Strategy parameters

With Arcium MPC, agents can:
- Execute strategies without revealing parameters
- Track positions privately
- Prevent copy-trading and front-running

---

## 🔗 Links

- **GitHub:** https://github.com/JoeStrangeQ/solana-lp-mpc-toolkit
- **Arcium Docs:** https://docs.arcium.com
- **Colosseum:** https://colosseum.com/agent-hackathon

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

Built with 🦐 by the MnM team for the Colosseum Agent Hackathon 2026.
