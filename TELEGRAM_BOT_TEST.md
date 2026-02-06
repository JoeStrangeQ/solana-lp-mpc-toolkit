# Telegram Bot Test Plan

## Status: 🚧 IN PROGRESS

## Commands to Test

### 1. /start
- [ ] Creates wallet if none exists
- [ ] Shows existing wallet if already created
- [ ] Displays welcome message with quick actions

### 2. /balance  
- [ ] Shows SOL balance
- [ ] Shows token balances with symbols (not addresses)
- [ ] Shows USD values
- [ ] Shows Solscan link

### 3. /pools
- [ ] Fetches real pools from Meteora API
- [ ] Shows pools with TVL > $100K
- [ ] Sorted by APR (highest first)
- [ ] Tap pool → shows amount selection
- [ ] Amount selection → strategy selection
- [ ] Execute → opens position

### 4. /positions
- [ ] Shows all LP positions
- [ ] Shows pair name, range, dollar amounts
- [ ] Shows fees earned
- [ ] Action buttons (rebalance, withdraw, claim)
- [ ] Refresh button works

### 5. /deposit
- [ ] Shows wallet address for deposits
- [ ] QR code or copy button

### 6. /withdraw
- [ ] Lists positions to withdraw
- [ ] Withdrawal confirmation
- [ ] Execute withdrawal

### 7. /settings
- [ ] Toggle out-of-range alerts
- [ ] Toggle auto-rebalance
- [ ] Toggle daily summary

### 8. /help
- [ ] Shows all commands
- [ ] Shows NL examples

## Natural Language Tests

- [ ] "LP 0.5 SOL into SOL-USDC"
- [ ] "LP into BFS-SOL" (with pool address)
- [ ] "Check my balance"
- [ ] "Show my positions"
- [ ] "What are the top pools?"
- [ ] "Withdraw from MET-USDC"

## Position Testing (5 pools with 100K+ liquidity)

1. [ ] BFS-SOL (E6sr5aGsJwk...) - ~50% APR
2. [ ] BigTrout-SOL (2fBRjFUvsk...) - ~15% APR
3. [ ] Goyim-SOL (6wgEyQmy8H...) - ~7% APR
4. [ ] XAUt0-SOL (DxT2uLqvBD...) - ~3.5% APR
5. [ ] testicle-SOL (ptVzGfsAqX...) - ~2.9% APR

## Test Results Log

*(Updated automatically)*
