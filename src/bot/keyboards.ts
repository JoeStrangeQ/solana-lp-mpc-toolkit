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
  pools: Array<{ address: string; name: string; apy?: number }>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const label = pool.apy
      ? `${pool.name} (${pool.apy.toFixed(1)}% APY)`
      : pool.name;
    // Use index-based callback to stay under 64 bytes
    kb.text(label, `lp:pool:${i}`).row();
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
    .text('Custom Amount', 'lp:amt:custom')
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

export function settingsKeyboard(
  walletId: string,
  prefs: { alertOnOutOfRange: boolean; autoRebalance: boolean; dailySummary: boolean },
): InlineKeyboard {
  // Truncate walletId to keep callback data under 64 bytes
  const wid = walletId.slice(0, 20);
  return new InlineKeyboard()
    .text(
      prefs.alertOnOutOfRange ? 'Alerts: ON' : 'Alerts: OFF',
      `set:alert:${wid}`,
    )
    .row()
    .text(
      prefs.autoRebalance ? 'Auto-Rebalance: ON' : 'Auto-Rebalance: OFF',
      `set:rebal:${wid}`,
    )
    .row()
    .text(
      prefs.dailySummary ? 'Daily Summary: ON' : 'Daily Summary: OFF',
      `set:daily:${wid}`,
    )
    .row()
    .text('Done', 'dismiss');
}
