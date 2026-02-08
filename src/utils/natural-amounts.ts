/**
 * Natural Language Amount Parser
 * 
 * Parses human-friendly amount expressions into SOL values.
 * 
 * Supported formats:
 * - Numbers: "2.5", "0.1"
 * - Max: "max", "all", "everything"
 * - Percentages: "50%", "half", "quarter"
 * - Relative: "max minus 0.1", "all but fees"
 * - USD: "$100", "100 dollars" (requires price)
 */

// Fee reserve for transaction fees (covers tx fees, rent for ATAs, position rent)
const FEE_RESERVE = 0.15;

export interface ParsedAmount {
  success: boolean;
  amount?: number;
  type: 'absolute' | 'max' | 'percentage' | 'relative' | 'usd' | 'error';
  description?: string;
  error?: string;
}

/**
 * Parse a natural language amount expression
 * @param input - User input string
 * @param balance - Current SOL balance
 * @param solPrice - Optional SOL price in USD for dollar amounts
 */
export function parseNaturalAmount(
  input: string,
  balance: number,
  solPrice?: number
): ParsedAmount {
  const text = input.toLowerCase().trim();
  
  // Empty input
  if (!text) {
    return { success: false, type: 'error', error: 'No amount specified' };
  }
  
  // Simple number
  const simpleNum = parseFloat(text);
  if (!isNaN(simpleNum) && text.match(/^[\d.]+$/)) {
    return validateAmount(simpleNum, balance, 'absolute');
  }
  
  // Max/All variations
  if (text.match(/^(max|all|everything|full|entire)$/)) {
    const maxAmount = Math.floor((balance - FEE_RESERVE) * 100) / 100;
    return validateAmount(maxAmount, balance, 'max', 'Maximum (minus fee reserve)');
  }
  
  // Half/Quarter/Third
  if (text === 'half' || text === '1/2') {
    const amount = Math.floor((balance / 2) * 100) / 100;
    return validateAmount(amount, balance, 'percentage', '50% of balance');
  }
  if (text === 'quarter' || text === '1/4') {
    const amount = Math.floor((balance / 4) * 100) / 100;
    return validateAmount(amount, balance, 'percentage', '25% of balance');
  }
  if (text === 'third' || text === '1/3') {
    const amount = Math.floor((balance / 3) * 100) / 100;
    return validateAmount(amount, balance, 'percentage', '33% of balance');
  }
  
  // Percentage (e.g., "50%", "25 percent")
  const percentMatch = text.match(/^(\d+(?:\.\d+)?)\s*(%|percent)$/);
  if (percentMatch) {
    const pct = parseFloat(percentMatch[1]);
    if (pct <= 0 || pct > 100) {
      return { success: false, type: 'error', error: 'Percentage must be 1-100%' };
    }
    const amount = Math.floor((balance * pct / 100) * 100) / 100;
    return validateAmount(amount, balance, 'percentage', `${pct}% of balance`);
  }
  
  // Relative: "max minus X", "all but X", "everything except X"
  const relativeMatch = text.match(/^(max|all|everything)\s*(minus|but|except|-)\s*(\d+(?:\.\d+)?)\s*(sol)?$/);
  if (relativeMatch) {
    const reserve = parseFloat(relativeMatch[3]);
    const amount = Math.floor((balance - reserve - FEE_RESERVE) * 100) / 100;
    return validateAmount(amount, balance, 'relative', `Maximum minus ${reserve} SOL`);
  }
  
  // "All but fees" / "max minus fees"
  if (text.match(/^(max|all|everything)\s*(minus|but|except)\s*(fees?|gas|reserve)$/)) {
    const amount = Math.floor((balance - FEE_RESERVE) * 100) / 100;
    return validateAmount(amount, balance, 'relative', 'Maximum minus fee reserve');
  }
  
  // USD amounts: "$100", "100 dollars", "100 usd"
  const usdMatch = text.match(/^\$?(\d+(?:\.\d+)?)\s*(dollars?|usd)?$/);
  if (usdMatch && (text.startsWith('$') || text.includes('dollar') || text.includes('usd'))) {
    if (!solPrice) {
      return { success: false, type: 'error', error: 'SOL price not available for USD conversion' };
    }
    const usdAmount = parseFloat(usdMatch[1]);
    const solAmount = Math.floor((usdAmount / solPrice) * 100) / 100;
    return validateAmount(solAmount, balance, 'usd', `$${usdAmount} ≈ ${solAmount} SOL`);
  }
  
  // Number with SOL suffix
  const solMatch = text.match(/^(\d+(?:\.\d+)?)\s*sol$/);
  if (solMatch) {
    const amount = parseFloat(solMatch[1]);
    return validateAmount(amount, balance, 'absolute');
  }
  
  // Fallback: try to parse as number
  const fallbackNum = parseFloat(text.replace(/[^\d.]/g, ''));
  if (!isNaN(fallbackNum) && fallbackNum > 0) {
    return validateAmount(fallbackNum, balance, 'absolute');
  }
  
  return {
    success: false,
    type: 'error',
    error: 'Could not parse amount. Try: "2.5", "max", "50%", or "$100"',
  };
}

function validateAmount(
  amount: number,
  balance: number,
  type: ParsedAmount['type'],
  description?: string
): ParsedAmount {
  if (!Number.isFinite(amount)) {
    return { success: false, type: 'error', error: 'Invalid number' };
  }
  
  if (amount <= 0) {
    return { success: false, type: 'error', error: 'Amount must be greater than 0' };
  }
  
  if (amount < 0.01) {
    return { success: false, type: 'error', error: 'Minimum amount is 0.01 SOL' };
  }
  
  if (amount > balance - FEE_RESERVE) {
    return {
      success: false,
      type: 'error',
      error: `Insufficient balance. Max: ${(balance - FEE_RESERVE).toFixed(2)} SOL`,
    };
  }
  
  return { success: true, amount, type, description };
}

/**
 * Format a ParsedAmount result for display
 */
export function formatParsedAmount(result: ParsedAmount): string {
  if (!result.success) {
    return `❌ ${result.error}`;
  }
  
  const amountStr = `${result.amount!.toFixed(2)} SOL`;
  
  if (result.description) {
    return `✅ ${amountStr} (${result.description})`;
  }
  
  return `✅ ${amountStr}`;
}
