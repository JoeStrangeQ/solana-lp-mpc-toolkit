/**
 * Example Agent Client
 * Shows how any AI agent can use the LP Toolkit API
 *
 * Run: npx tsx examples/agent-client.ts
 * (Requires API server running on port 3456)
 */

const API_BASE = process.env.LP_API_URL || "http://localhost:3456";

interface LPIntent {
  action: "scan" | "add_liquidity" | "remove_liquidity" | "positions";
  tokenA?: string;
  tokenB?: string;
  totalValueUSD?: number;
  positionId?: string;
}

/**
 * Simple LP Agent that can handle natural language requests
 */
class LPAgent {
  private apiBase: string;
  private userWallet: string;

  constructor(userWallet: string, apiBase: string = API_BASE) {
    this.apiBase = apiBase;
    this.userWallet = userWallet;
  }

  /**
   * Process a natural language LP request
   */
  async processRequest(userMessage: string): Promise<string> {
    console.log(`\n🤖 Processing: "${userMessage}"`);

    // 1. Parse the intent
    const intent = await this.parseIntent(userMessage);
    console.log(`   Intent: ${intent.action}`);

    // 2. Route to appropriate handler
    switch (intent.action) {
      case "scan":
        return this.handleScan(intent);
      case "add_liquidity":
        return this.handleAddLiquidity(intent);
      case "positions":
        return this.handlePositions();
      default:
        return "I'm not sure what you want to do. Try:\n- 'Show best SOL-USDC pools'\n- 'Add $500 to SOL-USDC'\n- 'Show my positions'";
    }
  }

  private async parseIntent(text: string): Promise<LPIntent> {
    const response = await fetch(`${this.apiBase}/v1/intent/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    return data.intent;
  }

  private async handleScan(intent: LPIntent): Promise<string> {
    const tokenA = intent.tokenA || "SOL";
    const tokenB = intent.tokenB || "USDC";

    const response = await fetch(
      `${this.apiBase}/v1/pools/scan?tokenA=${tokenA}&tokenB=${tokenB}&limit=5`,
    );
    const data = await response.json();

    if (!data.success) {
      return `❌ Failed to fetch pools: ${data.error}`;
    }

    return `🏊 **Top ${tokenA}-${tokenB} Pools**\n\n${data.chatDisplay}`;
  }

  private async handleAddLiquidity(intent: LPIntent): Promise<string> {
    // First, encrypt the strategy
    const encResponse = await fetch(`${this.apiBase}/v1/encrypt/strategy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerPubkey: this.userWallet,
        strategy: {
          tokenA: intent.tokenA || "SOL",
          tokenB: intent.tokenB || "USDC",
          totalValueUSD: intent.totalValueUSD || 100,
          strategy: "concentrated",
        },
      }),
    });
    const encData = await encResponse.json();

    if (!encData.success) {
      return `❌ Encryption failed: ${encData.error}`;
    }

    // In production: would build and return unsigned TX here
    return `
🔐 **Strategy Encrypted with Arcium MPC**

📊 Operation: Add $${intent.totalValueUSD || 100} to ${intent.tokenA || "SOL"}-${intent.tokenB || "USDC"}
🏦 Best venue will be selected automatically
🔑 Encryption ID: ${encData.encrypted.id}

⚠️ This is a demo - in production, this would return an unsigned transaction for you to sign.

Your strategy parameters are now private and cannot be front-run!
    `.trim();
  }

  private async handlePositions(): Promise<string> {
    const response = await fetch(
      `${this.apiBase}/v1/positions/${this.userWallet}`,
    );
    const data = await response.json();

    if (!data.success) {
      return `❌ Failed to fetch positions: ${data.error}`;
    }

    if (data.count === 0) {
      return "📭 You have no active LP positions.";
    }

    return `
📊 **Your LP Positions**

💰 Total Value: $${data.totalValueUSD.toFixed(2)}
🎁 Unclaimed Fees: $${data.totalUnclaimedFeesUSD.toFixed(2)}
📈 Positions: ${data.count}

${data.chatDisplay}
    `.trim();
  }
}

// ============ Demo ============

async function demo() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🦀 LP Toolkit - Agent Client Demo");
  console.log("═══════════════════════════════════════════════════════════");

  // Check if API is running
  try {
    const health = await fetch(`${API_BASE}/v1/health`);
    if (!health.ok) throw new Error("API not healthy");
    console.log(`\n✅ Connected to LP Toolkit API at ${API_BASE}`);
  } catch (e) {
    console.error(`\n❌ Cannot connect to API at ${API_BASE}`);
    console.error("   Start the server: npx tsx src/api/server.ts");
    process.exit(1);
  }

  // Create agent with a demo wallet
  const demoWallet = "11111111111111111111111111111111"; // System program (for demo)
  const agent = new LPAgent(demoWallet);

  // Example requests
  const requests = [
    "What's the best SOL-USDC pool?",
    "Add $500 to SOL-USDC",
    "Show my positions",
  ];

  for (const request of requests) {
    const response = await agent.processRequest(request);
    console.log("\n" + "─".repeat(50));
    console.log(response);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("✨ Demo complete! This shows how any agent can use the API.");
  console.log("═══════════════════════════════════════════════════════════");
}

demo().catch(console.error);
