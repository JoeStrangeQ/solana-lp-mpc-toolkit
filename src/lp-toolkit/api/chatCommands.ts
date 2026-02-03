/**
 * LP Toolkit Chat Commands
 * Natural language interface for LP operations
 *
 * Commands:
 * /lp scan [token] [token]     - Scan for LP opportunities
 * /lp positions                 - Show your LP positions
 * /lp add <amount> <pair>       - Add liquidity
 * /lp remove <position_id>      - Remove liquidity
 * /lp claim <position_id>       - Claim fees
 * /lp help                      - Show help
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { YieldScanner, createYieldScanner } from "../services/yieldScanner";
import meteoraAdapter from "../adapters/meteora";
import {
  formatPoolsForChat,
  formatPositionsForChat,
  LPPool,
} from "../adapters/types";

// ============ Types ============

export interface ChatContext {
  connection: Connection;
  userPubkey: PublicKey;
  userKeypair?: Keypair; // For signing transactions
  scanner: YieldScanner;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
  requiresConfirmation?: boolean;
  pendingAction?: PendingAction;
}

export interface PendingAction {
  type: "add_liquidity" | "remove_liquidity" | "claim_fees";
  params: any;
  expiresAt: number;
}

// ============ Command Parser ============

export function parseCommand(
  input: string,
): { command: string; args: string[] } | null {
  const trimmed = input.trim();

  // Check for /lp prefix
  if (!trimmed.toLowerCase().startsWith("/lp")) {
    return null;
  }

  const parts = trimmed.slice(3).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || "help";
  const args = parts.slice(1);

  return { command, args };
}

// ============ Command Handlers ============

/**
 * Handle /lp scan [tokenA] [tokenB]
 */
export async function handleScan(
  ctx: ChatContext,
  args: string[],
): Promise<CommandResult> {
  const tokenA = args[0]?.toUpperCase();
  const tokenB = args[1]?.toUpperCase();

  try {
    const result = await ctx.scanner.scanPools({
      tokenA,
      tokenB,
      minApy: 5,
      minTvl: 50000,
      limit: 10,
      sortBy: "apy",
    });

    if (result.pools.length === 0) {
      return {
        success: true,
        message: `🔍 No pools found${tokenA ? ` for ${tokenA}${tokenB ? `-${tokenB}` : ""}` : ""}.`,
      };
    }

    const poolList = formatPoolsForChat(result.pools, { maxItems: 5 });

    let message = `🔍 **Top LP Opportunities**${tokenA ? ` (${tokenA}${tokenB ? `-${tokenB}` : ""})` : ""}\n\n`;
    message += poolList;

    if (result.recommended) {
      message += `\n\n💡 **${result.reasoning}**`;
      message += `\n\nTo add liquidity: \`/lp add <amount> ${result.recommended.name}\``;
    }

    return {
      success: true,
      message,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Scan failed: ${error.message}`,
    };
  }
}

/**
 * Handle /lp positions
 */
export async function handlePositions(
  ctx: ChatContext,
): Promise<CommandResult> {
  try {
    const aggregated = await ctx.scanner.getAggregatedPositions(ctx.userPubkey);

    if (aggregated.positions.length === 0) {
      return {
        success: true,
        message: `📭 **No LP Positions Found**\n\nYou don't have any active LP positions.\n\nUse \`/lp scan\` to find opportunities!`,
      };
    }

    const message = formatPositionsForChat(aggregated.positions);

    return {
      success: true,
      message,
      data: aggregated,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to fetch positions: ${error.message}`,
    };
  }
}

/**
 * Handle /lp add <amount> <pair>
 */
export async function handleAdd(
  ctx: ChatContext,
  args: string[],
): Promise<CommandResult> {
  if (args.length < 2) {
    return {
      success: false,
      message: `❌ Usage: \`/lp add <amount> <pair>\`\n\nExamples:\n• \`/lp add 100 SOL-USDC\`\n• \`/lp add 500 USDC SOL-USDC\``,
    };
  }

  const amountStr = args[0];
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    return {
      success: false,
      message: `❌ Invalid amount: ${amountStr}`,
    };
  }

  const pair = args[1]?.toUpperCase();

  // Find best pool for this pair
  const result = await ctx.scanner.scanPools({
    tokenA: pair.split("-")[0],
    tokenB: pair.split("-")[1],
    limit: 1,
    sortBy: "apy",
  });

  if (!result.recommended) {
    return {
      success: false,
      message: `❌ No pool found for ${pair}`,
    };
  }

  const pool = result.recommended;

  // Create confirmation message
  const message = `📝 **Add Liquidity Confirmation**

**Pool:** ${pool.name} (${pool.venue})
**Amount:** $${amount.toFixed(2)}
**APY:** ${pool.apy.toFixed(1)}%
**TVL:** $${(pool.tvl / 1e6).toFixed(2)}M

⚠️ This will execute a transaction.

Reply \`confirm\` to proceed or \`cancel\` to abort.`;

  return {
    success: true,
    message,
    requiresConfirmation: true,
    pendingAction: {
      type: "add_liquidity",
      params: {
        pool,
        amount,
        venue: pool.venue,
      },
      expiresAt: Date.now() + 60000, // 1 minute
    },
  };
}

/**
 * Handle /lp remove <position_id> [percentage]
 */
export async function handleRemove(
  ctx: ChatContext,
  args: string[],
): Promise<CommandResult> {
  if (args.length < 1) {
    return {
      success: false,
      message: `❌ Usage: \`/lp remove <position_id> [percentage]\`\n\nExamples:\n• \`/lp remove abc123\` (remove all)\n• \`/lp remove abc123 50\` (remove 50%)`,
    };
  }

  const positionId = args[0];
  const percentage = args[1] ? parseInt(args[1]) : 100;

  if (percentage < 1 || percentage > 100) {
    return {
      success: false,
      message: `❌ Percentage must be between 1 and 100`,
    };
  }

  // Verify position exists
  const aggregated = await ctx.scanner.getAggregatedPositions(ctx.userPubkey);
  const position = aggregated.positions.find(
    (p) => p.positionId.startsWith(positionId) || p.positionId === positionId,
  );

  if (!position) {
    return {
      success: false,
      message: `❌ Position not found: ${positionId}\n\nUse \`/lp positions\` to see your positions.`,
    };
  }

  const amountToRemove = (position.valueUSD * percentage) / 100;

  const message = `📝 **Remove Liquidity Confirmation**

**Pool:** ${position.poolName} (${position.venue})
**Position Value:** $${position.valueUSD.toFixed(2)}
**Removing:** ${percentage}% ($${amountToRemove.toFixed(2)})
**Unclaimed Fees:** $${position.unclaimedFees.totalUSD.toFixed(2)} (will be claimed)

⚠️ This will execute a transaction.

Reply \`confirm\` to proceed or \`cancel\` to abort.`;

  return {
    success: true,
    message,
    requiresConfirmation: true,
    pendingAction: {
      type: "remove_liquidity",
      params: {
        position,
        percentage,
      },
      expiresAt: Date.now() + 60000,
    },
  };
}

/**
 * Handle /lp claim <position_id>
 */
export async function handleClaim(
  ctx: ChatContext,
  args: string[],
): Promise<CommandResult> {
  if (args.length < 1) {
    return {
      success: false,
      message: `❌ Usage: \`/lp claim <position_id>\``,
    };
  }

  const positionId = args[0];

  // Verify position exists
  const aggregated = await ctx.scanner.getAggregatedPositions(ctx.userPubkey);
  const position = aggregated.positions.find(
    (p) => p.positionId.startsWith(positionId) || p.positionId === positionId,
  );

  if (!position) {
    return {
      success: false,
      message: `❌ Position not found: ${positionId}`,
    };
  }

  if (position.unclaimedFees.totalUSD < 0.01) {
    return {
      success: true,
      message: `ℹ️ No fees to claim for this position (< $0.01)`,
    };
  }

  const message = `📝 **Claim Fees Confirmation**

**Pool:** ${position.poolName}
**Unclaimed Fees:** $${position.unclaimedFees.totalUSD.toFixed(2)}

Reply \`confirm\` to proceed or \`cancel\` to abort.`;

  return {
    success: true,
    message,
    requiresConfirmation: true,
    pendingAction: {
      type: "claim_fees",
      params: {
        position,
      },
      expiresAt: Date.now() + 60000,
    },
  };
}

/**
 * Handle /lp help
 */
export function handleHelp(): CommandResult {
  const message = `🏊 **LP Agent Toolkit**

**Commands:**
\`/lp scan [token] [token]\` - Find LP opportunities
\`/lp positions\` - View your LP positions
\`/lp add <amount> <pair>\` - Add liquidity
\`/lp remove <id> [%]\` - Remove liquidity
\`/lp claim <id>\` - Claim fees
\`/lp help\` - Show this help

**Examples:**
• \`/lp scan SOL USDC\` - Find SOL-USDC pools
• \`/lp add 100 SOL-USDC\` - Add $100 to best pool
• \`/lp remove abc123 50\` - Remove 50% from position

**Supported DEXs:**
• Meteora DLMM
• Orca Whirlpools
• Raydium CLMM

🔐 Powered by Arcium for private execution`;

  return {
    success: true,
    message,
  };
}

// ============ Main Handler ============

/**
 * Process a chat message and return response
 */
export async function processCommand(
  ctx: ChatContext,
  input: string,
): Promise<CommandResult> {
  const parsed = parseCommand(input);

  if (!parsed) {
    // Not an LP command
    return {
      success: false,
      message: "",
    };
  }

  const { command, args } = parsed;

  switch (command) {
    case "scan":
    case "s":
      return handleScan(ctx, args);

    case "positions":
    case "pos":
    case "p":
      return handlePositions(ctx);

    case "add":
    case "a":
      return handleAdd(ctx, args);

    case "remove":
    case "rm":
    case "r":
      return handleRemove(ctx, args);

    case "claim":
    case "c":
      return handleClaim(ctx, args);

    case "help":
    case "h":
    case "":
      return handleHelp();

    default:
      return {
        success: false,
        message: `❌ Unknown command: ${command}\n\nUse \`/lp help\` for available commands.`,
      };
  }
}

export default {
  parseCommand,
  processCommand,
  handleScan,
  handlePositions,
  handleAdd,
  handleRemove,
  handleClaim,
  handleHelp,
};
