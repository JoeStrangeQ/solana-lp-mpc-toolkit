# MnM DLMM Leverage System

**Version:** 2.0  
**Updated:** February 2026  
**Status:** Production Ready (Devnet)

---

## Overview

MnM provides leveraged DLMM (Dynamic Liquidity Market Maker) positions on Solana via Meteora. Users can achieve **2x-5x leverage** on their DLMM yield farming positions through atomic flash loan mechanics.

### Key Innovation

Unlike traditional lending protocols, MnM uses an **atomic leverage-first approach**:

- Borrow → Create LP → Collateralize in **ONE transaction**
- No gap risk between steps
- All-or-nothing execution (reverts on failure)

---

## How It Works

### The Atomic Leverage Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                    ATOMIC LEVERAGE CREATION                      │
│                   (Single Solana Transaction)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Capital ($100 USDC)                                       │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ STEP 1: FLASH BORROW                                  │       │
│  │ ───────────────────                                   │       │
│  │ • Borrow $100 additional from flash loan pool        │       │
│  │ • No collateral required (repaid same tx)            │       │
│  │ • Fee: 0.09% (9 bps)                                 │       │
│  └──────────────────────────────────────────────────────┘       │
│         │                                                        │
│         ▼ Total: $200                                           │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ STEP 2: CREATE DLMM POSITION                          │       │
│  │ ─────────────────────────                             │       │
│  │ • CPI call to Meteora DLMM program                   │       │
│  │ • Create position with $200 (user + borrowed)        │       │
│  │ • Select bin range (±10 bins default)                │       │
│  │ • Split: 50% SOL / 50% USDC (balanced)               │       │
│  └──────────────────────────────────────────────────────┘       │
│         │                                                        │
│         ▼ Receive LP Tokens                                     │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ STEP 3: DEPOSIT LP AS COLLATERAL                      │       │
│  │ ─────────────────────────────                         │       │
│  │ • Lock LP tokens in MnM collateral vault             │       │
│  │ • LP token value = $200                              │       │
│  │ • Collateral position PDA created                    │       │
│  └──────────────────────────────────────────────────────┘       │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ STEP 4: BORROW AGAINST COLLATERAL                     │       │
│  │ ────────────────────────────────                      │       │
│  │ • Borrow $100 USDC against $200 LP (50% LTV)         │       │
│  │ • Max LTV: 80% (allows up to 5x leverage)            │       │
│  │ • Health Factor: 1.7 (healthy)                       │       │
│  └──────────────────────────────────────────────────────┘       │
│         │                                                        │
│         ▼ $100 USDC                                             │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ STEP 5: REPAY FLASH LOAN                              │       │
│  │ ───────────────────────                               │       │
│  │ • Repay $100 principal + $0.09 fee                   │       │
│  │ • Flash loan closed                                   │       │
│  │ • Transaction complete                                │       │
│  └──────────────────────────────────────────────────────┘       │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ ✅ RESULT: 2x LEVERAGED POSITION ACTIVE               │       │
│  │                                                        │       │
│  │ • User deposited: $100                                │       │
│  │ • Position size: $200                                 │       │
│  │ • Effective leverage: 2.0x                           │       │
│  │ • User earns fees on $200, not $100                  │       │
│  │ • Debt: $100 USDC (accruing interest)                │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Leverage

Amplify your DLMM position size beyond your capital:

| Leverage | Your Capital | Position Size | LTV Required |
| -------- | ------------ | ------------- | ------------ |
| 2x       | $100         | $200          | 50%          |
| 3x       | $100         | $300          | 66.7%        |
| 4x       | $100         | $400          | 75%          |
| 5x       | $100         | $500          | 80% (max)    |

**Formula:** `Leverage = 1 / (1 - LTV)`

### Health Factor

Measures position safety. Think of it as distance from liquidation:

```
                    HEALTH FACTOR SCALE
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    < 1.0      │  LIQUIDATABLE 🔴
    ───────────┼────────────────────────────────
    1.0 - 1.1  │  DANGER       🟠
    ───────────┼────────────────────────────────
    1.1 - 1.2  │  WARNING      🟡
    ───────────┼────────────────────────────────
    > 1.2      │  HEALTHY      🟢
    ───────────┼────────────────────────────────
    > 1.5      │  SAFE         ✅
```

**Formula:** `Health Factor = (Collateral × Liquidation Threshold) / Debt`

### LTV (Loan-to-Value)

The ratio of debt to collateral:

```
LTV = Debt / Collateral

Example:
  Collateral: $200 LP tokens
  Debt: $100 USDC
  LTV: $100 / $200 = 50%
```

---

## Risk Parameters

```
┌─────────────────────────────────────────────────────────────┐
│                    RISK PARAMETERS                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  MAX_LTV                    80%     Maximum borrowing limit  │
│  LIQUIDATION_THRESHOLD      85%     Triggers liquidation     │
│  LIQUIDATION_PENALTY        5%      Bonus to liquidators     │
│  MAX_LEVERAGE               5x      (1 / (1 - 0.80))         │
│  HEALTH_FACTOR_WARNING      1.2     Yellow warning zone      │
│  HEALTH_FACTOR_DANGER       1.1     Orange danger zone       │
│  MIN_INITIAL_HEALTH         1.3     Required for new loans   │
│  MAX_PRICE_IMPACT           1%      Trade size limit         │
│  DEFAULT_SLIPPAGE           0.5%    Slippage tolerance       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Supported Pools

| Pool      | Address                                        | Status    |
| --------- | ---------------------------------------------- | --------- |
| SOL/USDC  | `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`  | ✅ Active |
| USDC/USDT | `ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq` | ✅ Active |
| SOL/USDT  | `Gf8YTgnugSZgdGBYYMpMi6v1bPgjCgX7BrrLzH6FNCvz` | ✅ Active |

---

## API Reference

### Create Leveraged Position

```typescript
import { buildLeverageTransaction } from "./services/leverageService";

const result = await buildLeverageTransaction({
  connection,
  user: keypair,
  baseAsset: "USDC",
  baseAmount: 100, // $100 initial capital
  targetLeverage: 2, // 2x leverage
  poolAddress: DLMM_POOLS.SOL_USDC,
  binRange: 10, // ±10 bins from active
  slippageTolerance: 0.5, // 0.5%
});

// Sign and send
await sendAndConfirmTransaction(connection, result.transaction, [keypair]);

// Result
console.log(result.summary);
// {
//   initialCapital: 100,
//   borrowedAmount: 100,
//   totalPositionSize: 200,
//   effectiveLeverage: 2,
//   estimatedHealthFactor: 1.7,
//   liquidationThreshold: 117.65
// }
```

### Calculate Position Risk

```typescript
import { calculatePositionRisk } from "./utils/riskCalculations";

const risk = calculatePositionRisk(
  1000, // $1000 collateral value
  400, // $400 debt
  100, // $100 price per collateral unit
);

// Returns:
// {
//   healthFactor: 2.125,
//   currentLTV: 0.4,
//   liquidationPrice: 47.06,
//   safetyMargin: 52.94,
//   status: 'healthy',
//   requiredCollateralToSafe: 0,
//   maxWithdrawable: 435.29
// }
```

### Validate Borrow

```typescript
import { validateBorrow } from "./utils/riskCalculations";

const validation = validateBorrow(
  1000, // Current collateral
  200, // Current debt
  300, // New borrow amount
);

// Returns:
// {
//   valid: true,
//   newHealthFactor: 1.7,
//   error: undefined
// }
```

---

## Deleverage Flow

Reducing or closing a leveraged position:

```
┌─────────────────────────────────────────────────────────────┐
│                    DELEVERAGE FLOW                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Leveraged Position (2x)                                    │
│  • LP Value: $200                                           │
│  • Debt: $100                                               │
│  • Equity: $100                                             │
│         │                                                    │
│         ▼                                                    │
│  ┌────────────────────────────────────┐                     │
│  │ 1. REMOVE LIQUIDITY                 │                     │
│  │    Withdraw from DLMM position      │                     │
│  │    Receive: SOL + USDC              │                     │
│  └────────────────────────────────────┘                     │
│         │                                                    │
│         ▼                                                    │
│  ┌────────────────────────────────────┐                     │
│  │ 2. SWAP TO DEBT TOKEN               │                     │
│  │    Convert SOL → USDC if needed     │                     │
│  └────────────────────────────────────┘                     │
│         │                                                    │
│         ▼                                                    │
│  ┌────────────────────────────────────┐                     │
│  │ 3. REPAY DEBT                       │                     │
│  │    Pay back $100 + accrued interest │                     │
│  └────────────────────────────────────┘                     │
│         │                                                    │
│         ▼                                                    │
│  ┌────────────────────────────────────┐                     │
│  │ 4. WITHDRAW REMAINING               │                     │
│  │    User receives remaining equity   │                     │
│  └────────────────────────────────────┘                     │
│         │                                                    │
│         ▼                                                    │
│  ✅ Position Closed                                          │
│  User receives: ~$100 (minus fees/IL)                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Liquidation Mechanics

When Health Factor drops below 1.0:

```
┌─────────────────────────────────────────────────────────────┐
│                    LIQUIDATION FLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Unhealthy Position                                         │
│  • LP Value: $100 (dropped from $200)                       │
│  • Debt: $100                                               │
│  • Health Factor: 0.85 (< 1.0)                              │
│         │                                                    │
│         ▼                                                    │
│  ┌────────────────────────────────────┐                     │
│  │ LIQUIDATOR INITIATES               │                     │
│  │ • Repays up to 50% of debt ($50)   │                     │
│  │ • Receives collateral + 5% bonus   │                     │
│  │ • Collateral seized: $52.50        │                     │
│  └────────────────────────────────────┘                     │
│         │                                                    │
│         ▼                                                    │
│  ┌────────────────────────────────────┐                     │
│  │ POST-LIQUIDATION                   │                     │
│  │ • Remaining collateral: $47.50     │                     │
│  │ • Remaining debt: $50              │                     │
│  │ • New Health Factor: 0.81         │                     │
│  │ • May need another liquidation     │                     │
│  └────────────────────────────────────┘                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

### Atomicity

All leverage operations are atomic:

- Single transaction = no partial state
- Failure at any step reverts entire operation
- No gap risk between borrow and collateralize

### Oracle

Uses Pyth Network for price feeds:

- Maximum staleness: 60 seconds
- Price validation on every operation
- Fallback to Switchboard if Pyth unavailable

### Flash Loan Safety

- Flash loans must be repaid in same transaction
- Receipt PDA uses slot number (prevents reuse)
- 0.09% fee deters abuse

### Liquidation Protection

- 85% threshold (not 80%) gives buffer
- 5% penalty incentivizes timely liquidations
- 50% max per liquidation prevents total loss

---

## Frontend Components

| Component                   | Purpose                    |
| --------------------------- | -------------------------- |
| `DLMMLeverageInterface.tsx` | Main leverage creation UI  |
| `PositionManager.tsx`       | View/manage open positions |
| `HealthFactorDisplay.tsx`   | Risk visualization         |
| `PoolSelector.tsx`          | DLMM pool selection        |
| `LeverageSlider.tsx`        | Leverage amount control    |

---

## Services

| Service                | Purpose                        |
| ---------------------- | ------------------------------ |
| `dlmmService.ts`       | Meteora DLMM SDK integration   |
| `collateralService.ts` | LP token collateral management |
| `leverageService.ts`   | Atomic leverage transactions   |
| `lendingService.ts`    | Pool deposit/withdraw          |

---

## Testing

```bash
# Run unit tests
cd mnm-leverage
npx ts-node tests/leverage-flow.test.ts

# Run integration tests (requires devnet)
npx ts-node tests/dlmm-integration.test.ts
```

---

## Deployment Status

| Environment | Status       | Address  |
| ----------- | ------------ | -------- |
| Devnet      | ✅ Deployed  | `MnM...` |
| Mainnet     | 🔜 Pending   | -        |
| Audit       | 📋 Scheduled | -        |

---

## Comparison: MnM vs Alternatives

| Feature            | MnM (Atomic) | DeFiTuna  | Position-First |
| ------------------ | ------------ | --------- | -------------- |
| Execution          | Single tx    | Single tx | Multiple txs   |
| Gap Risk           | None         | None      | Between steps  |
| Partial Entry      | No           | No        | Yes            |
| UX Complexity      | Low          | Low       | High           |
| MEV Exposure       | Medium       | Medium    | Low            |
| Capital Efficiency | High         | High      | Lower          |

---

## Next Steps

1. **Mainnet Deployment** - After security review
2. **Additional Pools** - More Meteora pools
3. **Manual Loop Option** - For advanced users
4. **Rebalancing Tools** - Position management

---

_For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md)_
