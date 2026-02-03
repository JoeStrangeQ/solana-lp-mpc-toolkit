# Deployment & Testing Plan

## Goal: Live On-Chain with Arcium Privacy

### Phase 1: Arcium Integration Testing (PRIORITY)

**1.1 Connect to Arcium Devnet**
- [ ] Get Arcium devnet RPC endpoint
- [ ] Fetch real MXE public key from devnet
- [ ] Test x25519 key exchange with real MXE
- [ ] Test RescueCipher encrypt/decrypt roundtrip

**1.2 Deploy Test Circuit**
- [ ] Create simple LP strategy circuit for Arcium
- [ ] Upload circuit using `uploadCircuit()`
- [ ] Finalize computation definition
- [ ] Test encrypted computation submission

**1.3 Prove Security**
- [ ] Document encryption flow
- [ ] Show that strategy params are encrypted before tx
- [ ] Show that only owner can decrypt position values
- [ ] Create test script demonstrating privacy

### Phase 2: DEX Adapter Testing

**2.1 Meteora DLMM (Primary)**
- [ ] Test pool fetching with real API
- [ ] Test position query for real wallet
- [ ] Test addLiquidity tx building (simulate)
- [ ] Test on devnet with small amount

**2.2 Other Adapters**
- [ ] Verify API endpoints work
- [ ] Test pool data parsing
- [ ] Ensure fallback data is reasonable

### Phase 3: End-to-End Flow

**3.1 Full Private LP Flow**
```
1. Agent receives "add $100 to SOL-USDC"
2. Intent parsed → AddLiquidityIntent
3. Strategy encrypted via Arcium
4. Best pool found across DEXs
5. TX built with encrypted params
6. TX submitted to Solana
7. Position tracked in Convex
8. YieldMonitor sends natural language update
```

**3.2 Integration Test Script**
- [ ] Create `test/integration/privateLp.test.ts`
- [ ] Test full flow on devnet
- [ ] Verify encryption is real
- [ ] Verify position tracking works

### Phase 4: Mainnet Preparation

- [ ] Audit smart contract interactions
- [ ] Set up fee collection wallet
- [ ] Configure mainnet RPC
- [ ] Create deployment script
- [ ] Document operational procedures

---

## Immediate Actions (Tonight)

1. **Test Arcium devnet connection**
2. **Create integration test for encrypt/decrypt**
3. **Test Meteora adapter with real API**
4. **Document proof of privacy**

---

## Environment Setup

```bash
# Arcium devnet
ARCIUM_CLUSTER=devnet
ARCIUM_RPC=https://devnet.arcium.network

# Solana devnet
SOLANA_RPC=https://api.devnet.solana.com

# Test wallet (devnet only)
TEST_WALLET=<devnet keypair path>
```
