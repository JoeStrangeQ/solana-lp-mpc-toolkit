/**
 * Bot-specific types and context
 */
import { Context, SessionFlavor } from 'grammy';
import { ConversationFlavor } from '@grammyjs/conversations';

export interface SessionData {
  walletId?: string;
  walletAddress?: string;
  /** Cached alert preferences for settings toggles */
  alertPrefs?: {
    alertOnOutOfRange: boolean;
    autoRebalance: boolean;
    dailySummary: boolean;
  };
}

/**
 * Module-level state for passing data into conversations.
 * grammY conversations have isolated context — ctx.session is not available
 * inside conversation builder functions. Use conversation.external() to access this.
 */
const _pendingPoolSelections = new Map<number, number>(); // chatId -> poolIndex

export function setPendingPool(chatId: number, poolIndex: number): void {
  _pendingPoolSelections.set(chatId, poolIndex);
}

export function consumePendingPool(chatId: number): number | undefined {
  const idx = _pendingPoolSelections.get(chatId);
  _pendingPoolSelections.delete(chatId);
  return idx;
}

type BaseContext = Context & SessionFlavor<SessionData>;
export type BotContext = BaseContext & ConversationFlavor<BaseContext>;
