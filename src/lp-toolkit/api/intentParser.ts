/**
 * Natural Language Intent Parser for LP Toolkit
 *
 * Recognizes user intent from natural language, not just /commands
 * This is what makes it agent-native - users speak naturally.
 */

import { LPPool } from "../adapters/types";

// ============ Types ============

export type IntentType =
  | "scan_pools"
  | "show_positions"
  | "add_liquidity"
  | "remove_liquidity"
  | "claim_fees"
  | "check_yield"
  | "rebalance"
  | "help"
  | "unknown";

export interface ParsedIntent {
  type: IntentType;
  confidence: number; // 0-1
  params: {
    tokenA?: string;
    tokenB?: string;
    amount?: number;
    amountToken?: string; // "SOL", "USDC", "USD"
    positionId?: string;
    percentage?: number;
    venue?: string;
  };
  originalText: string;
}

// ============ Patterns ============

const SCAN_PATTERNS = [
  /(?:find|scan|search|show|list|what(?:'s| is| are)?)\s*(?:the\s+)?(?:best|top|good)?\s*(?:lp|liquidity|pool|yield|apy)/i,
  /where\s+(?:should|can|to)\s+(?:i|we)\s+(?:put|add|deposit|stake)/i,
  /(?:best|highest|top)\s+(?:yield|apy|returns?)/i,
  /lp\s+opportunit/i,
];

const POSITION_PATTERNS = [
  /(?:show|list|check|view|what(?:'s| is| are)?)\s*(?:my)?\s*(?:lp\s+)?position/i,
  /(?:how\s+(?:are|is)|check\s+on)\s+(?:my)?\s*(?:lp|liquidity|position)/i,
  /(?:my|the)\s+(?:lp|liquidity)\s+(?:position|portfolio)/i,
  /am\s+i\s+making\s+money/i,
  /portfolio\s+status/i,
];

const ADD_PATTERNS = [
  /(?:add|put|deposit|stake|invest)\s+(?:\$?[\d,.]+)\s*(?:usd|usdc|sol)?/i,
  /(?:lp|provide\s+liquidity)\s+(?:\$?[\d,.]+)/i,
  /(?:put|add)\s+(?:my|some|this)?\s*(?:sol|usdc|money|funds?)\s+(?:to\s+work|into)/i,
];

const REMOVE_PATTERNS = [
  /(?:remove|withdraw|pull|exit|close)\s+(?:my\s+)?(?:lp|liquidity|position)/i,
  /(?:take\s+out|get\s+back|withdraw)\s+(?:my)?\s*(?:money|funds?|liquidity)/i,
  /(?:close|exit)\s+(?:my\s+)?position/i,
];

const CLAIM_PATTERNS = [
  /(?:claim|collect|harvest|get)\s+(?:my\s+)?(?:fees?|rewards?|earnings?|yield)/i,
  /(?:fees?|rewards?)\s+(?:ready|available|to\s+claim)/i,
];

const YIELD_PATTERNS = [
  /(?:how\s+much|what)\s+(?:am\s+i|have\s+i)\s+(?:earn|made|yield)/i,
  /(?:check|show)\s+(?:my\s+)?(?:yield|earnings?|fees?|rewards?)/i,
  /(?:daily|weekly|monthly)\s+(?:yield|earnings?|returns?)/i,
];

// Token patterns
const TOKEN_PATTERN =
  /\b(SOL|USDC|USDT|mSOL|stSOL|JTO|JUP|BONK|RAY|WIF|PYTH|ETH|BTC)\b/gi;
const AMOUNT_PATTERN = /\$?([\d,]+(?:\.\d{1,2})?)\s*(k|m|usd|usdc|sol)?/i;
const PERCENTAGE_PATTERN = /(\d+)\s*%/;
const POSITION_ID_PATTERN = /(?:position\s+)?([a-zA-Z0-9]{6,})/i;

// ============ Parser ============

/**
 * Parse natural language into an intent
 */
export function parseIntent(text: string): ParsedIntent {
  const normalized = text.toLowerCase().trim();
  const params: ParsedIntent["params"] = {};

  // Extract tokens
  const tokens = text.match(TOKEN_PATTERN) || [];
  if (tokens.length >= 1) params.tokenA = tokens[0].toUpperCase();
  if (tokens.length >= 2) params.tokenB = tokens[1].toUpperCase();

  // Extract amount
  const amountMatch = text.match(AMOUNT_PATTERN);
  if (amountMatch) {
    let amount = parseFloat(amountMatch[1].replace(/,/g, ""));
    const suffix = amountMatch[2]?.toLowerCase();
    if (suffix === "k") amount *= 1000;
    if (suffix === "m") amount *= 1000000;
    params.amount = amount;
    params.amountToken =
      suffix === "sol" ? "SOL" : suffix === "usdc" ? "USDC" : "USD";
  }

  // Extract percentage
  const percentMatch = text.match(PERCENTAGE_PATTERN);
  if (percentMatch) {
    params.percentage = parseInt(percentMatch[1]);
  }

  // Check patterns in order of specificity

  // Add liquidity (check before scan - "add 500 to SOL pool" shouldn't be a scan)
  for (const pattern of ADD_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: "add_liquidity",
        confidence: 0.85,
        params,
        originalText: text,
      };
    }
  }

  // Remove liquidity
  for (const pattern of REMOVE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: "remove_liquidity",
        confidence: 0.85,
        params,
        originalText: text,
      };
    }
  }

  // Claim fees
  for (const pattern of CLAIM_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: "claim_fees",
        confidence: 0.85,
        params,
        originalText: text,
      };
    }
  }

  // Check yield
  for (const pattern of YIELD_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: "check_yield",
        confidence: 0.8,
        params,
        originalText: text,
      };
    }
  }

  // Show positions
  for (const pattern of POSITION_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: "show_positions",
        confidence: 0.85,
        params,
        originalText: text,
      };
    }
  }

  // Scan pools
  for (const pattern of SCAN_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        type: "scan_pools",
        confidence: 0.8,
        params,
        originalText: text,
      };
    }
  }

  // Help
  if (/\b(help|how\s+(?:do|does|to)|what\s+can\s+you)\b/i.test(normalized)) {
    return { type: "help", confidence: 0.7, params, originalText: text };
  }

  // Unknown
  return { type: "unknown", confidence: 0, params, originalText: text };
}

/**
 * Check if text is likely an LP-related query
 */
export function isLPRelated(text: string): boolean {
  const lpKeywords =
    /\b(lp|liquidity|pool|defi|yield|apy|swap|dex|meteora|orca|raydium|position|stake|farm)\b/i;
  return lpKeywords.test(text);
}

/**
 * Generate a natural response based on intent
 */
export function suggestResponse(intent: ParsedIntent): string {
  switch (intent.type) {
    case "scan_pools":
      if (intent.params.tokenA) {
        return `Looking for the best ${intent.params.tokenA}${intent.params.tokenB ? `-${intent.params.tokenB}` : ""} pools...`;
      }
      return "Scanning for top LP opportunities...";

    case "show_positions":
      return "Fetching your LP positions...";

    case "add_liquidity":
      const amt = intent.params.amount;
      return amt
        ? `Got it - adding $${amt} to liquidity. Let me find the best pool...`
        : "How much would you like to add?";

    case "remove_liquidity":
      return intent.params.percentage
        ? `Preparing to remove ${intent.params.percentage}% of your position...`
        : "Which position would you like to close?";

    case "claim_fees":
      return "Checking your claimable fees...";

    case "check_yield":
      return "Calculating your earnings...";

    default:
      return "";
  }
}

export default {
  parseIntent,
  isLPRelated,
  suggestResponse,
};
