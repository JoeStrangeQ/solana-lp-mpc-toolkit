# LP Agent Toolkit

**A unified interface for AI agents to manage liquidity positions across Solana DEXs**

Built for the [Colosseum Agent Hackathon](https://www.colosseum.org/) (Feb 2026)

---

## What is this?

LP Agent Toolkit lets AI assistants (chatbots, agents, automated systems) discover and manage LP positions across multiple Solana DEXs through a simple, unified API.

Instead of learning each DEX's SDK separately, agents can:
- Scan for the best yield opportunities across venues
- Add/remove liquidity with consistent parameters
- Track positions and unclaimed fees
- Execute strategies with privacy via Arcium

---

## Supported DEXs

| DEX | Type | Status |
|-----|------|--------|
| Meteora | DLMM (Concentrated) | ✅ |
| Orca | Whirlpool (Concentrated) | ✅ |
| Raydium | CLMM (Concentrated) | ✅ |
| Phoenix | CLOB | 🔜 |

---

## Example Usage

```typescript
import { adapters, getAllAdapters } from './lp-toolkit/adapters';

// Scan all DEXs for best SOL-USDC opportunities
const pools = await Promise.all(
  getAllAdapters().map(a => a.getPools(connection))
);
const allPools = pools.flat().filter(p => p.name === 'SOL-USDC');
const best = allPools.sort((a, b) => b.apy - a.apy)[0];

// Add liquidity to the best pool
const { transaction, positionId } = await adapters[best.venue].addLiquidity(
  connection,
  wallet,
  { poolAddress: best.address, totalValueUSD: 500, strategy: 'balanced' }
);
```

---

## Chat Commands (WIP)

Designed for chat-native interaction:

```
/lp scan              → Show top LP opportunities
/lp add 500 SOL-USDC  → Add $500 to best SOL-USDC pool
/lp positions         → Show all your positions
/lp yield             → Show unclaimed fees
```

---

## Privacy with Arcium

Strategy parameters can be encrypted via Arcium's MPC network:
- Hide which pools you're targeting
- Keep position sizes private
- Encrypted agent-to-agent communication

---

## Project Structure

```
src/lp-toolkit/
├── adapters/
│   ├── meteora.ts    # Meteora DLMM adapter
│   ├── orca.ts       # Orca Whirlpool adapter
│   ├── raydium.ts    # Raydium CLMM adapter
│   └── types.ts      # Unified interfaces
├── services/
│   ├── yieldScanner.ts    # Cross-DEX yield comparison
│   └── arciumPrivacy.ts   # Encryption layer
└── api/
    └── chatCommands.ts    # Chat interface
```

---

## Tech Stack

- TypeScript
- Solana Web3.js
- Meteora DLMM SDK
- Orca Whirlpools SDK
- Raydium SDK v2
- Arcium Client
- Convex (state persistence)

---

## Status

This is a hackathon project in active development. Core adapters are implemented; integration testing and chat interface are in progress.

---

## License

MIT
