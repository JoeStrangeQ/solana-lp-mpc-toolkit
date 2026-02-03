# Demo Video Script 🎬

## LP Toolkit with Arcium Privacy - Hackathon Demo

**Duration:** 3-5 minutes
**Format:** Screen recording with voiceover

---

## Scene 1: The Problem (30 sec)

**Show:** Trading bot getting front-run, charts showing slippage

**Say:**

> "AI agents managing DeFi positions face a critical problem: their strategies are visible on-chain. When an agent adds liquidity, MEV bots can see the transaction and front-run it. When they rebalance, competitors copy their moves.
>
> What if agents could manage LP positions... privately?"

---

## Scene 2: Introducing LP Toolkit (30 sec)

**Show:** Terminal with `npm run api`, then README on GitHub

**Say:**

> "Introducing the Solana LP MPC Toolkit - the first privacy-preserving LP toolkit designed for AI agents.
>
> Built with Arcium's multi-party computation, agents can now discover, execute, and manage LP positions across 9 Solana DEXs... without revealing their strategies."

---

## Scene 3: Live Demo - Starting the API (30 sec)

**Terminal commands:**

```bash
cd solana-lp-mpc-toolkit
npm run api
```

**Show:** Server starting, endpoints listed

**Say:**

> "Let's see it in action. I'll start the API server. It exposes 8 endpoints that any AI agent can call over HTTP - no SDK integration required."

---

## Scene 4: Finding Best Pools (45 sec)

**Terminal commands:**

```bash
curl "http://localhost:3456/v1/pools/scan?tokenA=SOL&tokenB=USDC&limit=5"
```

**Show:** JSON response with pool data

**Say:**

> "First, an agent wants to find the best SOL-USDC pools. One API call scans across Meteora, Orca, Raydium, and more. Returns APY, TVL, and a chat-ready display.
>
> No need to integrate 9 different SDKs - one unified interface."

---

## Scene 5: Natural Language Parsing (30 sec)

**Terminal commands:**

```bash
curl -X POST "http://localhost:3456/v1/intent/parse" \
  -H "Content-Type: application/json" \
  -d '{"text": "Add $500 to the best SOL-USDC pool"}'
```

**Show:** Parsed intent JSON

**Say:**

> "Agents work with natural language. A user says 'Add 500 dollars to SOL-USDC' and the intent parser extracts the structured action. Works in any chat interface."

---

## Scene 6: Arcium Privacy (60 sec) ⭐ KEY SCENE

**Terminal commands:**

```bash
curl -X POST "http://localhost:3456/v1/encrypt/strategy" \
  -H "Content-Type: application/json" \
  -d '{
    "ownerPubkey": "YourWallet...",
    "strategy": {
      "tokenA": "SOL",
      "tokenB": "USDC",
      "totalValueUSD": 500,
      "strategy": "concentrated"
    }
  }'
```

**Show:**

- Encrypted ciphertext in response
- Arcium cluster info
- Highlight the encryption ID

**Say:**

> "Here's where Arcium comes in. Before any transaction hits the chain, the strategy parameters are encrypted using Arcium's MXE public key.
>
> The agent's strategy - how much, what range, which pool - is hidden from everyone. Only the owner can decrypt their position details.
>
> We're using real Arcium devnet encryption with x25519 key exchange and RescueCipher. This isn't mock encryption - it's real MPC privacy."

---

## Scene 7: Building Transactions (45 sec)

**Terminal commands:**

```bash
curl -X POST "http://localhost:3456/v1/tx/add-liquidity" \
  -H "Content-Type: application/json" \
  -d '{
    "userPubkey": "YourWallet...",
    "venue": "meteora",
    "tokenA": "SOL",
    "tokenB": "USDC",
    "amountA": 1.0,
    "amountB": 150
  }'
```

**Show:** Unsigned transaction returned

**Say:**

> "The toolkit returns unsigned transactions. The agent doesn't need wallet access - it builds the TX and returns it to the user to sign.
>
> This works with any wallet: Phantom, Solflare, or programmatic signing."

---

## Scene 8: The Complete Flow (30 sec)

**Show:** Diagram or flow animation

**Say:**

> "The complete agent flow:
>
> 1. User says 'Add 500 to SOL-USDC'
> 2. Agent parses intent
> 3. Agent finds best pool across 9 DEXs
> 4. Strategy encrypted with Arcium
> 5. Unsigned TX returned
> 6. User signs and submits
>
> The agent never sees the private key, and MEV bots never see the strategy."

---

## Scene 9: Agent-to-Agent (30 sec)

**Show:** Code snippet from agent-client.ts

**Say:**

> "Any AI agent can integrate. We provide TypeScript examples, a Clawdbot skill template, and full API documentation.
>
> Agents can even call each other - one agent specializing in yield discovery, another in execution."

---

## Scene 10: Closing (30 sec)

**Show:** GitHub repo, README

**Say:**

> "The Solana LP MPC Toolkit: 9 DEXs, 180,000 pools, real Arcium privacy, and an agent-first API.
>
> Built for the Colosseum Agent Hackathon.
>
> Try it: github.com/JoeStrangeQ/solana-lp-mpc-toolkit"

---

## Technical Highlights to Mention

- **Real Arcium integration** - devnet cluster 456, x25519 + RescueCipher
- **184K+ pools** across 5 working DEX APIs
- **8 API endpoints** for complete LP lifecycle
- **Unsigned TX mode** - agents don't need wallet access
- **Agent-friendly errors** - actionable suggestions

## Recording Tips

1. Use a clean terminal with large font
2. Show real API responses (not mocked)
3. Highlight the Arcium encryption step
4. Keep each scene focused
5. Total runtime: 4-5 minutes max
