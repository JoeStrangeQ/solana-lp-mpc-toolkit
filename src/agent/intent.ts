/**
 * Natural Language Intent Parser
 * 
 * Converts plain English commands to structured LP intents
 */

import type { LPIntent } from './types';
import type { DEX } from '../gateway/types';

const DEX_ALIASES: Record<string, DEX> = {
  meteora: 'meteora',
  dlmm: 'meteora',
  orca: 'orca',
  whirlpool: 'orca',
  whirlpools: 'orca',
  raydium: 'raydium',
  ray: 'raydium',
};

// Supported token symbols for swap parsing
const TOKEN_SYMBOLS = ['SOL', 'USDC', 'USDT', 'BONK', 'WIF', 'JUP', 'RAY'];

const PAIR_PATTERNS = [
  // USDC-SOL, BONK/WIF, etc.
  /\b([A-Z]{2,6})[-\/]([A-Z]{2,6})\b/gi,
];

const AMOUNT_PATTERNS = [
  /\$?([\d,]+(?:\.\d+)?)\s*(?:dollars?|usd)?/i,
  /([\d,]+(?:\.\d+)?)\s*(?:SOL|USDC|USDT)/i,
];

// Swap patterns: "swap 1 SOL to USDC", "convert 100 USDC into SOL", "exchange 5 SOL for USDC"
const SWAP_PATTERNS = [
  /swap\s+([\d.]+)\s*(\w+)\s+(?:to|for|into)\s+(\w+)/i,
  /convert\s+([\d.]+)\s*(\w+)\s+(?:to|for|into)\s+(\w+)/i,
  /exchange\s+([\d.]+)\s*(\w+)\s+(?:to|for|into)\s+(\w+)/i,
  /([\d.]+)\s*(\w+)\s+(?:to|->|=>)\s+(\w+)/i,
];

export function parseIntent(text: string): LPIntent {
  const lower = text.toLowerCase();

  // Check for swap intent first (specific patterns)
  for (const pattern of SWAP_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const [, amountStr, inputToken, outputToken] = match;
      return {
        action: 'swap',
        amount: parseFloat(amountStr),
        inputToken: inputToken.toUpperCase(),
        outputToken: outputToken.toUpperCase(),
      };
    }
  }

  // Extract amount first (needed for action detection)
  let amount: number | undefined;
  let match = text.match(/\$?([\d,]+(?:\.\d+)?)\s*(?:dollars?|usd)/i);
  if (match) {
    amount = parseFloat(match[1].replace(/,/g, ''));
  } else {
    match = text.match(/(?<![-\/])\b([\d,]+(?:\.\d+)?)\b(?![-/]|%)/);
    if (match) {
      amount = parseFloat(match[1].replace(/,/g, ''));
    }
  }

  // Determine action
  let action: LPIntent['action'] = 'positions';
  
  if (/\b(swap|convert|exchange)\b/.test(lower)) {
    action = 'swap';
  } else if (/\b(scan|search|find|best|top|opportunities?|show me)\b/.test(lower)) {
    action = 'scan';
  } else if (/\b(add|put|deposit|lp|provide|open|invest)\b/.test(lower) && (/\b(liquidity|position)\b/.test(lower) || amount)) {
    action = 'open';
  } else if (/\b(close|exit|withdraw all|remove all)\b/.test(lower)) {
    action = 'close';
  } else if (/\b(add more|increase|top up)\b/.test(lower)) {
    action = 'add';
  } else if (/\b(remove|withdraw|take out|pull out)\b/.test(lower) && !/all/.test(lower)) {
    action = 'remove';
  } else if (/\b(collect|claim|harvest|get)\b/.test(lower) && /\b(fees?|rewards?)\b/.test(lower)) {
    action = 'collect';
  } else if (/\b(show|list|my|positions?|portfolio|what are)\b/.test(lower)) {
    action = 'positions';
  }

  // Determine DEX
  let dex: DEX | undefined;
  for (const [alias, dexName] of Object.entries(DEX_ALIASES)) {
    if (lower.includes(alias)) {
      dex = dexName;
      break;
    }
  }

  // Extract pair
  let pair: string | undefined;
  for (const pattern of PAIR_PATTERNS) {
    const pairMatch = text.match(pattern);
    if (pairMatch) {
      pair = pairMatch[0].toUpperCase().replace('/', '-');
      break;
    }
  }

  // Extract percentage
  let percentage: number | undefined;
  const percentMatch = text.match(/(\d+)\s*%/);
  if (percentMatch) {
    percentage = parseInt(percentMatch[1]);
  }

  // Determine strategy
  let strategy: LPIntent['strategy'];
  if (/\b(balanced|spot|equal)\b/.test(lower)) {
    strategy = 'balanced';
  } else if (/\b(concentrated|tight|narrow)\b/.test(lower)) {
    strategy = 'concentrated';
  } else if (/\b(wide|broad|range)\b/.test(lower)) {
    strategy = 'wide';
  }

  // Extract position ID (for close/add/remove/collect)
  let positionId: string | undefined;
  const positionMatch = text.match(/position\s+([A-Za-z0-9]+)/i);
  if (positionMatch) {
    positionId = positionMatch[1];
  }

  return {
    action,
    dex,
    pair,
    amount,
    positionId,
    percentage,
    strategy,
  };
}

/**
 * Format intent back to human-readable description
 */
export function describeIntent(intent: LPIntent): string {
  const parts: string[] = [];

  switch (intent.action) {
    case 'swap':
      parts.push('Swap');
      if (intent.amount) parts.push(`${intent.amount}`);
      if (intent.inputToken) parts.push(intent.inputToken);
      if (intent.outputToken) parts.push(`to ${intent.outputToken}`);
      break;

    case 'scan':
      parts.push('Scan for LP opportunities');
      if (intent.pair) parts.push(`for ${intent.pair}`);
      if (intent.dex) parts.push(`on ${intent.dex}`);
      break;

    case 'open':
      parts.push('Open LP position');
      if (intent.amount) parts.push(`with $${intent.amount}`);
      if (intent.pair) parts.push(`in ${intent.pair}`);
      if (intent.dex) parts.push(`on ${intent.dex}`);
      if (intent.strategy) parts.push(`(${intent.strategy} strategy)`);
      break;

    case 'close':
      parts.push('Close position');
      if (intent.positionId) parts.push(intent.positionId);
      break;

    case 'add':
      parts.push('Add liquidity');
      if (intent.amount) parts.push(`($${intent.amount})`);
      if (intent.positionId) parts.push(`to position ${intent.positionId}`);
      break;

    case 'remove':
      parts.push('Remove liquidity');
      if (intent.percentage) parts.push(`(${intent.percentage}%)`);
      if (intent.positionId) parts.push(`from position ${intent.positionId}`);
      break;

    case 'collect':
      parts.push('Collect fees');
      if (intent.positionId) parts.push(`from position ${intent.positionId}`);
      break;

    case 'positions':
      parts.push('Show LP positions');
      break;
  }

  return parts.join(' ');
}
