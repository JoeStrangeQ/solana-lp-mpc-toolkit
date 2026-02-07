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

type BaseContext = Context & SessionFlavor<SessionData>;
export type BotContext = BaseContext & ConversationFlavor<BaseContext>;
