# MnM DLMM Leverage Protocol

**Leveraged concentrated liquidity positions on Solana via Meteora DLMM**

[![Status](https://img.shields.io/badge/Status-Devnet-yellow)]()
[![Leverage](https://img.shields.io/badge/Leverage-2x--5x-blue)]()

---

## Overview

MnM enables users to open leveraged DLMM positions with **2x-5x leverage** through atomic flash loan mechanics. Deposit $100, control a $500 position, earn amplified trading fees.

```
User Capital ($100)  ──▶  Flash Borrow ($400)  ──▶  Create LP ($500)
                                                          │
                   Repay Flash ◀── Borrow ($400) ◀── Lock LP as Collateral
```

All steps execute atomically in a **single Solana transaction**.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

---

## Key Features

- **Atomic Leverage**: No gap risk - borrow, LP, collateralize in one tx
- **DLMM Integration**: Native Meteora DLMM support
- **Real-time Risk**: Health factor monitoring with liquidation alerts
- **Flexible**: 2x-5x leverage, multiple pool support

---

## Documentation

| Document                                    | Description                    |
| ------------------------------------------- | ------------------------------ |
| [DLMM_LEVERAGE.md](./docs/DLMM_LEVERAGE.md) | How the leverage system works  |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md)   | Technical architecture & flows |

---

## Supported Pools

| Pool      | Status    |
| --------- | --------- |
| SOL/USDC  | ✅ Active |
| USDC/USDT | ✅ Active |
| SOL/USDT  | ✅ Active |

---

## Risk Parameters

| Parameter             | Value |
| --------------------- | ----- |
| Max LTV               | 80%   |
| Liquidation Threshold | 85%   |
| Liquidation Penalty   | 5%    |
| Max Leverage          | 5x    |

---

## Project Structure

```
mnm-leverage/
├── src/
│   ├── components/     # React UI components
│   ├── services/       # TypeScript service layer
│   ├── hooks/          # React hooks
│   └── utils/          # Calculations & helpers
├── docs/               # Documentation
├── tests/              # Test suites
└── convex/             # State persistence
```

---

## Tech Stack

- **Frontend**: React + Vite + TypeScript
- **State**: Convex
- **Wallet**: Solana Wallet Adapter
- **Oracle**: Pyth Network
- **DLMM**: Meteora SDK

---

## Status

| Milestone           | Status           |
| ------------------- | ---------------- |
| Core Services       | ✅ Complete      |
| Frontend Components | ✅ Complete      |
| Devnet Deployment   | ✅ Deployed      |
| Mainnet             | 🔜 Pending Audit |

---

## License

MIT
