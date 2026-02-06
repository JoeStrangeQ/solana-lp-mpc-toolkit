# Percolator Skill

Interact with the Percolator perpetuals risk engine on Solana.

## What is Percolator?

A formally verified risk engine for building leveraged markets. You bring the matching logic, it handles the risk management.

**Repos:**
- [percolator](https://github.com/aeyakovenko/percolator) - Core risk engine library
- [percolator-prog](https://github.com/aeyakovenko/percolator-prog) - Solana program
- [percolator-match](https://github.com/aeyakovenko/percolator-match) - Demo matcher
- [percolator-cli](https://github.com/aeyakovenko/percolator-cli) - TypeScript CLI (this skill)

## Setup

```bash
# Clone and build
git clone https://github.com/aeyakovenko/percolator-cli
cd percolator-cli
pnpm install && pnpm build

# Configure
cat > ~/.config/percolator-cli.json << 'EOF'
{
  "rpcUrl": "https://api.devnet.solana.com",
  "programId": "2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp",
  "walletPath": "~/.config/solana/id.json"
}
EOF
```

## Devnet Test Market

A live SOL/USD perp market on devnet:

```
Slab:    A7wQtRT9DhFqYho8wTVqQCDc7kYPTUXGPATiyVbZKVFs
Matcher: 4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy
Oracle:  99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR (Chainlink SOL/USD)
Type:    INVERTED (price = 1/SOL in USD terms)

Risk Parameters:
- Maintenance Margin: 5%
- Initial Margin: 10%
- Trading Fee: 10 bps
```

## Quick Start (Agent Flow)

### 1. Get devnet SOL
```bash
solana airdrop 2 --url devnet
```

### 2. Wrap SOL for collateral
```bash
spl-token wrap 1 --url devnet
```

### 3. Initialize user account
```bash
percolator-cli init-user --slab A7wQtRT9DhFqYho8wTVqQCDc7kYPTUXGPATiyVbZKVFs
```

### 4. Deposit collateral
```bash
# Deposit 0.05 SOL (50M lamports)
percolator-cli deposit \
  --slab A7wQtRT9DhFqYho8wTVqQCDc7kYPTUXGPATiyVbZKVFs \
  --user-idx <your-idx> \
  --amount 50000000
```

### 5. Check best prices
```bash
percolator-cli best-price \
  --slab A7wQtRT9DhFqYho8wTVqQCDc7kYPTUXGPATiyVbZKVFs \
  --oracle 99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR
```

### 6. Trade
```bash
# IMPORTANT: Run keeper crank first (must be within 200 slots)
percolator-cli keeper-crank \
  --slab A7wQtRT9DhFqYho8wTVqQCDc7kYPTUXGPATiyVbZKVFs \
  --oracle 99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR

# Then trade (long 1000 units via 50bps matcher)
percolator-cli trade-cpi \
  --slab A7wQtRT9DhFqYho8wTVqQCDc7kYPTUXGPATiyVbZKVFs \
  --user-idx <your-idx> \
  --lp-idx 0 \
  --size 1000 \
  --matcher-program 4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy \
  --matcher-ctx 5n3jT6iy9TK3XNMQarC1sK26zS8ofjLG3dvE9iDEFYhK \
  --oracle 99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR
```

## Key Commands

| Command | Description |
|---------|-------------|
| `init-user` | Create trading account |
| `deposit` | Add collateral |
| `withdraw` | Remove collateral |
| `trade-cpi` | Trade via matcher |
| `trade-nocpi` | Direct trade (no matcher) |
| `best-price` | Check bid/ask quotes |
| `keeper-crank` | Update funding (required before trades) |
| `slab:get` | View market state |

## Agent Integration Ideas

1. **Hedging Bot**: Monitor spot positions, open perp shorts to hedge
2. **Arbitrage**: Compare perp price vs spot, trade the spread
3. **LP Manager**: Create LP with custom matcher, manage inventory
4. **Risk Monitor**: Track margin ratios, alert on liquidation risk

## Creating Custom Markets

You can build your own matching logic. See percolator-match for the 50bps passive matcher example. Key requirement: **Matcher MUST verify LP PDA signature** to prevent unauthorized trades.

## WARNINGS

⚠️ **NOT AUDITED** - Educational/testing only
⚠️ **Keeper crank required** - Must run within 200 slots of trading
⚠️ **Devnet only** - Do not use with real funds
