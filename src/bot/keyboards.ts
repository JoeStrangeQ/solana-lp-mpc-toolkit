/**
 * Inline keyboard builders for the Telegram bot
 *
 * IMPORTANT: All callback_data strings must be <= 64 bytes (Telegram limit).
 * We use short prefixes: lp:, wd:, rb:, etc.
 */
import { InlineKeyboard } from 'grammy';

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Balance', 'cmd:balance')
    .text('Positions', 'cmd:positions')
    .row()
    .text('Add LP', 'cmd:pools')
    .text('Withdraw', 'cmd:withdraw')
    .row()
    .text('Top Pools', 'cmd:pools')
    .text('Settings', 'cmd:settings');
}

export function poolSelectionKeyboard(
  pools: Array<{ address: string; name: string; apy?: number; dex?: string }>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const pool of pools) {
    const label = pool.apy
      ? `${pool.name} (${pool.apy.toFixed(1)}% APY)`
      : pool.name;
    // Use address prefix for stable lookup (11 chars + prefix = ~20 bytes, under 64 limit)
    const dexTag = pool.dex === 'orca' ? 'o' : 'm';
    kb.text(label, `lp:p:${dexTag}:${pool.address.slice(0, 11)}`).row();
  }
  kb.text('Cancel', 'cancel');
  return kb;
}

export function amountKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('0.1 SOL', 'lp:amt:0.1')
    .text('0.5 SOL', 'lp:amt:0.5')
    .row()
    .text('1 SOL', 'lp:amt:1')
    .text('5 SOL', 'lp:amt:5')
    .row()
    .text('Max', 'lp:amt:max')
    .text('Custom', 'lp:amt:custom')
    .row()
    .text('Cancel', 'cancel');
}

export function strategyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Concentrated (+/- 5 bins)', 'lp:str:c')
    .row()
    .text('Wide (+/- 20 bins)', 'lp:str:w')
    .row()
    .text('Cancel', 'cancel');
}

export function distributionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Spot (uniform)', 'lp:dist:spot')
    .row()
    .text('Curve (bell)', 'lp:dist:curve')
    .row()
    .text('Bid-Ask', 'lp:dist:bidask')
    .row()
    .text('Cancel', 'cancel');
}

export function confirmKeyboard(action: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Confirm', `cf:${action}`)
    .text('Cancel', 'cancel');
}

export function positionActionsKeyboard(posIndex: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Withdraw', `wd:${posIndex}`)
    .text('Rebalance', `rb:${posIndex}`)
    .row()
    .text('Claim Fees', `fee:${posIndex}`)
    .row()
    .text('View on Solscan', `scan:${posIndex}`);
}

export function withdrawConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Withdraw & Keep Tokens', 'wd:cf:keep')
    .row()
    .text('Withdraw & Convert to SOL', 'wd:cf:sol')
    .row()
    .text('Cancel', 'cancel');
}

export function rebalanceStrategyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Concentrated (+/- 5 bins)', 'rb:str:c')
    .row()
    .text('Wide (+/- 20 bins)', 'rb:str:w')
    .row()
    .text('Cancel', 'cancel');
}

export function alertActionKeyboard(posIndex: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Rebalance', `rb:${posIndex}`)
    .text('Snooze 1h', `snooze:${posIndex}`)
    .row()
    .text('OK', 'dismiss');
}

export interface SettingsPrefs {
  alertOnOutOfRange: boolean;
  autoRebalance: boolean;
  dailySummary: boolean;
  alertThreshold?: number; // % value change to trigger alert (0 = any)
  quietHoursEnabled?: boolean;
}

export function settingsKeyboard(
  walletId: string,
  prefs: SettingsPrefs,
): InlineKeyboard {
  // Truncate walletId to keep callback data under 64 bytes
  const wid = walletId.slice(0, 20);
  
  const thresholdLabel = prefs.alertThreshold 
    ? `Threshold: ${prefs.alertThreshold}%` 
    : 'Threshold: Any';
  
  return new InlineKeyboard()
    .text(
      prefs.alertOnOutOfRange ? '🔔 Alerts: ON' : '🔕 Alerts: OFF',
      `set:alert:${wid}`,
    )
    .row()
    .text(
      prefs.autoRebalance ? '⚡ Auto-Rebal: ON' : '⚡ Auto-Rebal: OFF',
      `set:rebal:${wid}`,
    )
    .row()
    .text(
      prefs.dailySummary ? '📊 Daily: ON' : '📊 Daily: OFF',
      `set:daily:${wid}`,
    )
    .row()
    .text(`📏 ${thresholdLabel}`, `set:thresh:${wid}`)
    .row()
    .text(
      prefs.quietHoursEnabled ? '🌙 Quiet: ON' : '🌙 Quiet: OFF',
      `set:quiet:${wid}`,
    )
    .row()
    .text('Done', 'dismiss');
}
