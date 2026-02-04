# LP Agent Toolkit - Mission Statement

**Date:** February 4, 2026  
**Hackathon:** Colosseum Agent Hackathon (Feb 2-12, 2026)  
**Status:** ✅ ALL SYSTEMS OPERATIONAL | ⏳ DNS fix pending

---

## 🎯 Mission

Enable AI agents to manage Solana LP positions through natural language with:
- MPC custody via Privy (no private key exposure)
- Privacy-preserving execution via Arcium (AES-256-GCM + x25519)
- One-call swap→LP pipeline

---

## 🔑 Wallets & Credentials

### Privy Configuration
| Item | Value |
|------|-------|
| App ID | `cmf5mesq5006bjx0cyr7pkp9l` (25 chars) |
| App Secret | `privy_app_secret_25MnJs...` (101 chars) |
| Auth Key | `wallet-auth:MIGHAgEA...` (206 chars) |

### Test Wallet (Privy)
| Item | Value |
|------|-------|
| Address | `7upbRKXNurZJAtPXAUPhD641TMRnVuLb9ZWLEpdQzNNM` |
| Wallet ID | `jqxuyjcsw32oyup8duo7drie` |
| Balance | 0.05 SOL + 5 USDC |
| Purpose | E2E testing |

### MnM Leverage Wallet (Source/Treasury)
| Item | Value |
|------|-------|
| Address | `BNQnCszvPwYfjBMUmFgmCooMSRrdkC7LncMQBExDakLp` |
| Balance | ~0.52 SOL + ~10 USDC |
| Storage | 1Password "MnM Leverage Wallet" |
| Purpose | Treasury + test funding source |

### First Privy Wallet (Historical)
| Item | Value |
|------|-------|
| Address | `HTtDgJ74b3QW69yKhjDLPKNsjXSvBctKMCxnnwgjpuBZ` |
| Balance | 0.1 SOL |

---

## ✅ What's Built (100% Complete)

| Component | Status | Notes |
|-----------|--------|-------|
| Privy Wallets | ✅ | Create, load, balance, sign - all working |
| Arcium Privacy | ✅ | x25519-aes256gcm, MXE cluster 456 |
| Meteora DLMM | ✅ | Pool discovery, APY data |
| Jupiter Swaps | ✅ | V6 API integrated |
| NL Intent Parser | ✅ | `/chat` endpoint working |
| Fee System | ✅ | 0.1% (10 bps) to treasury |
| REST API (Hono) | ✅ | All endpoints operational |
| Frontend Dashboard | ✅ | Deployed to Vercel |
| Railway Deployment | ✅ | Premium RPC configured |

---

## 🔧 Infrastructure

### API Server (Railway)
- **URL:** `https://lp-agent-api-production.up.railway.app`
- **RPC:** `https://mnm-solanam-f41a.mainnet.rpcpool.com/b2c7e0db-0000-472e-9b1d-87261a99acea`
- **Status:** ✅ Healthy

### Frontend (Vercel)
- **Project:** lp-agent-toolkit
- **Preview URL:** `https://lp-agent-toolkit-o3i0l3y7e-joe-mnmfuns-projects.vercel.app`
- **Custom Domain:** `api.mnm.ag` (DNS pending)
- **Status:** ✅ Deployed, DNS fix needed

### DNS Configuration
- **Current CNAME:** `d35f7c407ac34017.vercel-dns-017.com`
- **Needed CNAME:** `cname.vercel-dns.com`
- **Registrar:** GoDaddy

---

## 📡 API Endpoints

| Endpoint | Method | Status |
|----------|--------|--------|
| `/health` | GET | ✅ |
| `/wallet/create` | POST | ✅ |
| `/wallet/load` | POST | ✅ |
| `/wallet/balance` | GET | ✅ |
| `/chat` | POST | ✅ |
| `/encrypt` | POST | ✅ |
| `/encrypt/info` | GET | ✅ |
| `/encrypt/test` | GET | ✅ |
| `/pools/scan` | GET | ✅ |
| `/fees` | GET | ✅ |
| `/lp/open` | POST | ✅ |
| `/lp/close` | POST | ✅ |

---

## 🟡 Pending Tasks

| Task | Status | Notes |
|------|--------|-------|
| DNS CNAME update | ⏳ | Change to `cname.vercel-dns.com` |
| E2E LP transaction test | ⏳ | Funds ready, SDK fix deployed |
| Demo video | ⏳ | Needs Joe |
| Colosseum submission | ⏳ | Deadline Feb 12 |

---

## 📝 Session Log (Feb 4, 2026)

### Completed Today
1. ✅ Fixed Privy 401 errors (credentials had extra spaces/chars)
2. ✅ Fixed Privy SDK API (`_rpc()` instead of `.solana()`)
3. ✅ Configured premium RPC (Triton rpcpool)
4. ✅ Transferred test funds (0.05 SOL + 5 USDC)
5. ✅ Moved frontend to lp-agent-toolkit repo
6. ✅ Deployed to Vercel with api.mnm.ag alias
7. ✅ Updated dashboard with live status

### Key Fixes
- `src/mpc/privyClient.ts` - Use `client.wallets._rpc()` for signing
- `src/config/index.ts` - Added `authorizationPrivateKey`
- `vercel.json` - Routes for static + API

---

## 🔗 Links

| Resource | URL |
|----------|-----|
| GitHub | github.com/JoeStrangeQ/solana-lp-mpc-toolkit |
| Railway API | lp-agent-api-production.up.railway.app |
| Vercel Frontend | lp-agent-toolkit-o3i0l3y7e-joe-mnmfuns-projects.vercel.app |
| Custom Domain | api.mnm.ag (DNS pending) |
| Twitter | @mnm_ag |
| Colosseum Agent ID | 17 |

---

## 🌟 North Star

> Enable AI agents to privately manage LP positions with one API call.

**Privacy** via Arcium • **Simplicity** via NL • **Security** via MPC • **Revenue** via 0.1% fee

---

*Last updated: Feb 4, 2026 14:00 CST by Nemmie 🦐*
