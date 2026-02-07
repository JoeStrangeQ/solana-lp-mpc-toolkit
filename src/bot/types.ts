/**
 * Bot-specific types and context
 */
import { Context, SessionFlavor } from 'grammy';
import { ConversationFlavor } from '@grammyjs/conversations';

export interface SessionData {
  walletId?: string;
  walletAddress?: string;
  /** Pre-selected pool from /pools command (index-based, consumed by LP wizard) */
  pendingPoolIndex?: number;
  /** Pool list cached from /pools for the LP wizard to consume */
  pendingPools?: Array<{ name: string; address: string; apr: number; tvl: number; binStep: number }>;
  /** Cached alert preferences for settings toggles */
  alertPrefs?: {
    alertOnOutOfRange: boolean;
    autoRebalance: boolean;
    dailySummary: boolean;
  };
}

type BaseContext = Context & SessionFlavor<SessionData>;
export type BotContext = BaseContext & ConversationFlavor<BaseContext>;
