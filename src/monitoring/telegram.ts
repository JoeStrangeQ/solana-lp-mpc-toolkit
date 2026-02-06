/**
 * Telegram Alert Delivery
 * 
 * Sends alerts via Telegram Bot API.
 * Supports inline buttons for actions.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

export interface TelegramConfig {
  botToken: string;
  defaultChatId?: string | number;
}

export interface SendResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

// Config from environment
function getConfig(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN not configured');
    return null;
  }
  
  return {
    botToken,
    defaultChatId: process.env.TELEGRAM_DEFAULT_CHAT_ID,
  };
}

/**
 * Send a text message via Telegram
 */
export async function sendMessage(params: {
  chatId: string | number;
  text: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  replyMarkup?: any;
  disableNotification?: boolean;
}): Promise<SendResult> {
  const config = getConfig();
  
  if (!config) {
    return { success: false, error: 'Telegram not configured' };
  }
  
  try {
    const url = `${TELEGRAM_API}${config.botToken}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        parse_mode: params.parseMode || 'Markdown',
        reply_markup: params.replyMarkup,
        disable_notification: params.disableNotification,
      }),
    });
    
    const data = await response.json() as any;
    
    if (data.ok) {
      console.log(`[Telegram] ✅ Message sent to ${params.chatId}`);
      return { success: true, messageId: data.result.message_id };
    } else {
      console.error(`[Telegram] ❌ Failed: ${data.description}`);
      return { success: false, error: data.description };
    }
  } catch (error: any) {
    console.error(`[Telegram] ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Send an alert with inline action buttons
 */
export async function sendAlert(params: {
  chatId: string | number;
  title: string;
  message: string;
  actions?: Array<{
    label: string;
    action: string;
    data?: Record<string, any>;
  }>;
  priority?: 'high' | 'normal' | 'low';
}): Promise<SendResult> {
  // Build inline keyboard if actions provided
  let replyMarkup = undefined;
  
  if (params.actions && params.actions.length > 0) {
    const buttons = params.actions.map(action => ({
      text: action.label,
      callback_data: JSON.stringify({
        a: action.action,
        d: action.data,
      }).slice(0, 64), // Telegram has 64 byte limit
    }));
    
    // Arrange buttons in rows (max 3 per row)
    const rows = [];
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(buttons.slice(i, i + 3));
    }
    
    replyMarkup = { inline_keyboard: rows };
  }
  
  // Format message
  const fullMessage = `*${escapeMarkdown(params.title)}*\n\n${params.message}`;
  
  return sendMessage({
    chatId: params.chatId,
    text: fullMessage,
    parseMode: 'Markdown',
    replyMarkup,
    disableNotification: params.priority === 'low',
  });
}

/**
 * Send out-of-range alert
 */
export async function sendOutOfRangeAlert(params: {
  chatId: string | number;
  poolName: string;
  positionAddress: string;
  currentBin: number;
  binRange: { lower: number; upper: number };
  direction: 'above' | 'below';
  distance: number;
}): Promise<SendResult> {
  const message = [
    `Position: \`${params.positionAddress.slice(0, 8)}...\``,
    `Current bin: ${params.currentBin}`,
    `Your range: ${params.binRange.lower} - ${params.binRange.upper}`,
    `Status: ${params.distance} bins ${params.direction} range`,
  ].join('\n');
  
  return sendAlert({
    chatId: params.chatId,
    title: `🚨 ${params.poolName} Out of Range`,
    message,
    actions: [
      { label: '🔄 Rebalance', action: 'rebalance', data: { pos: params.positionAddress.slice(0, 16) } },
      { label: '⏰ Snooze', action: 'snooze' },
      { label: '✓ OK', action: 'dismiss' },
    ],
    priority: 'high',
  });
}

/**
 * Send rebalance prompt
 */
export async function sendRebalancePrompt(params: {
  chatId: string | number;
  poolName: string;
  positionAddress: string;
  currentRange: string;
  suggestedRange: string;
}): Promise<SendResult> {
  const message = [
    `Your ${params.poolName} position has been out of range.`,
    ``,
    `Current: ${params.currentRange}`,
    `Suggested: ${params.suggestedRange}`,
    ``,
    `Want me to rebalance?`,
  ].join('\n');
  
  return sendAlert({
    chatId: params.chatId,
    title: `🔄 Rebalance ${params.poolName}?`,
    message,
    actions: [
      { label: '✅ Yes', action: 'confirm_rebalance', data: { pos: params.positionAddress.slice(0, 16) } },
      { label: '❌ No', action: 'dismiss' },
      { label: '⚙️ Custom', action: 'custom_range' },
    ],
    priority: 'high',
  });
}

/**
 * Send daily summary
 */
export async function sendDailySummary(params: {
  chatId: string | number;
  positions: Array<{
    poolName: string;
    inRange: boolean;
    value?: number;
  }>;
  totalValue?: number;
  feesEarned?: number;
}): Promise<SendResult> {
  const inRange = params.positions.filter(p => p.inRange).length;
  const outOfRange = params.positions.length - inRange;
  const statusEmoji = outOfRange > 0 ? '⚠️' : '✅';
  
  const positionLines = params.positions.map(p => 
    `• ${p.poolName}: ${p.inRange ? '✅ In range' : '⚠️ Out of range'}${p.value ? ` ($${p.value.toFixed(2)})` : ''}`
  );
  
  const message = [
    `*Positions:*`,
    ...positionLines,
    ``,
    `*Summary:*`,
    `• Total: ${params.positions.length} positions`,
    `• In range: ${inRange}`,
    outOfRange > 0 ? `• Out of range: ${outOfRange} ⚠️` : '',
    params.totalValue ? `• Total value: $${params.totalValue.toFixed(2)}` : '',
    params.feesEarned ? `• Fees earned: $${params.feesEarned.toFixed(2)}` : '',
  ].filter(Boolean).join('\n');
  
  return sendAlert({
    chatId: params.chatId,
    title: `${statusEmoji} Daily LP Summary`,
    message,
    priority: 'low',
  });
}

/**
 * Send rebalance completion notification
 */
export async function sendRebalanceComplete(params: {
  chatId: string | number;
  poolName: string;
  oldRange: string;
  newRange: string;
  success: boolean;
  error?: string;
}): Promise<SendResult> {
  if (params.success) {
    return sendAlert({
      chatId: params.chatId,
      title: `✅ ${params.poolName} Rebalanced`,
      message: [
        `Old range: ${params.oldRange}`,
        `New range: ${params.newRange}`,
        ``,
        `Your position is now in range and earning fees!`,
      ].join('\n'),
      priority: 'normal',
    });
  } else {
    return sendAlert({
      chatId: params.chatId,
      title: `❌ ${params.poolName} Rebalance Failed`,
      message: [
        `Error: ${params.error || 'Unknown error'}`,
        ``,
        `Your tokens are safe in your wallet. You can try again.`,
      ].join('\n'),
      actions: [
        { label: '🔄 Retry', action: 'retry_rebalance' },
      ],
      priority: 'high',
    });
  }
}

/**
 * Send position status update
 */
export async function sendPositionUpdate(params: {
  chatId: string | number;
  poolName: string;
  status: 'entered_range' | 'exited_range';
  currentBin: number;
  binRange: { lower: number; upper: number };
}): Promise<SendResult> {
  if (params.status === 'entered_range') {
    return sendAlert({
      chatId: params.chatId,
      title: `✅ ${params.poolName} Back in Range`,
      message: [
        `Your position is back in range!`,
        `Current bin: ${params.currentBin}`,
        `Range: ${params.binRange.lower} - ${params.binRange.upper}`,
      ].join('\n'),
      priority: 'normal',
    });
  } else {
    return sendOutOfRangeAlert({
      chatId: params.chatId,
      poolName: params.poolName,
      positionAddress: '', // Will be filled in by caller
      currentBin: params.currentBin,
      binRange: params.binRange,
      direction: params.currentBin < params.binRange.lower ? 'below' : 'above',
      distance: params.currentBin < params.binRange.lower 
        ? params.binRange.lower - params.currentBin
        : params.currentBin - params.binRange.upper,
    });
  }
}

/**
 * Escape special characters for Telegram Markdown
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Verify bot token is valid
 */
export async function verifyBot(): Promise<{ valid: boolean; username?: string; error?: string }> {
  const config = getConfig();
  
  if (!config) {
    return { valid: false, error: 'Not configured' };
  }
  
  try {
    const response = await fetch(`${TELEGRAM_API}${config.botToken}/getMe`);
    const data = await response.json() as any;
    
    if (data.ok) {
      return { valid: true, username: data.result.username };
    } else {
      return { valid: false, error: data.description };
    }
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
}

export default {
  sendMessage,
  sendAlert,
  sendOutOfRangeAlert,
  sendRebalancePrompt,
  sendDailySummary,
  sendRebalanceComplete,
  sendPositionUpdate,
  verifyBot,
};
