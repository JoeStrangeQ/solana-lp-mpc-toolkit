/**
 * Notification Routes - Registration, notification delivery, Telegram integration
 */
import { Hono } from 'hono';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config/index.js';
import { loadWalletById } from '../services/wallet-service.js';
import { FEE_CONFIG, SAMPLE_POOLS } from '../services/pool-service.js';
import { discoverAllPositions } from '../utils/position-discovery.js';
import {
  getRecipient,
  upsertRecipient,
  consumeLinkCode,
  sendAlert,
  handleTelegramCallback,
  type AlertPayload,
} from '../notifications/index.js';
import {
  onboardTelegram,
  onboardAgent,
  handleStart,
  handleLink,
  handleBalance,
  handlePositions,
  handleStatus,
  handleDeposit,
  handleWithdraw,
  handleSettings,
  handlePools,
  handleLpAmountPrompt,
  handleLpStrategyPrompt,
  getUserByChat,
  linkWalletToChat,
} from '../onboarding/index.js';

const app = new Hono();

// One-call agent onboarding
app.post('/onboard', async (c) => {
  try {
    const body = await c.req.json();
    const { webhookUrl, webhookSecret } = body;

    if (!webhookUrl) {
      return c.json({
        error: 'webhookUrl is required',
        example: {
          webhookUrl: 'https://your-agent.com/webhook',
          webhookSecret: 'optional-hmac-secret',
        },
      }, 400);
    }

    const result = await onboardAgent(webhookUrl, webhookSecret);

    return c.json({
      success: true,
      walletId: result.user.walletId,
      walletAddress: result.user.walletAddress,
      webhook: { url: webhookUrl, configured: true },
      message: result.message,
      nextSteps: [
        `1. Send SOL to ${result.user.walletAddress}`,
        '2. Create LP position: POST /lp/execute { walletId, poolAddress, ... }',
        '3. Receive alerts at your webhook URL',
      ],
    });
  } catch (error: any) {
    console.error('[Onboard] Error:', error);
    return c.json({ error: 'Onboarding failed', details: error.message }, 500);
  }
});

// Register for notifications
app.post('/notify/register', async (c) => {
  const body = await c.req.json();
  const { walletId, telegramCode, webhookUrl, webhookSecret, preferences } = body;

  if (!walletId) {
    return c.json({ error: 'walletId is required' }, 400);
  }

  const updates: any = { walletId, preferences };

  if (telegramCode) {
    const linkCode = await consumeLinkCode(telegramCode);
    if (!linkCode) {
      return c.json({ error: 'Invalid or expired link code' }, 400);
    }
    updates.telegram = {
      chatId: linkCode.chatId,
      linkedAt: new Date().toISOString(),
    };
  }

  if (webhookUrl) {
    updates.webhook = {
      url: webhookUrl,
      secret: webhookSecret,
      linkedAt: new Date().toISOString(),
    };
  }

  const recipient = await upsertRecipient(updates);

  return c.json({
    success: true,
    message: 'Notification preferences saved',
    recipient: {
      walletId: recipient.walletId,
      telegram: recipient.telegram ? { linked: true, chatId: recipient.telegram.chatId } : undefined,
      webhook: recipient.webhook ? { linked: true, url: recipient.webhook.url } : undefined,
      preferences: recipient.preferences,
    },
  });
});

// Get notification settings
app.get('/notify/:walletId', async (c) => {
  const walletId = c.req.param('walletId');
  const recipient = await getRecipient(walletId);

  if (!recipient) {
    return c.json({ error: 'Not registered for notifications' }, 404);
  }

  return c.json({
    walletId: recipient.walletId,
    telegram: recipient.telegram ? { linked: true } : undefined,
    webhook: recipient.webhook ? { linked: true, url: recipient.webhook.url } : undefined,
    preferences: recipient.preferences,
  });
});

// Send positions report
app.post('/notify/:walletId/positions', async (c) => {
  const walletId = c.req.param('walletId');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
  }

  const recipient = await getRecipient(walletId);
  if (!recipient?.telegram?.chatId) {
    return c.json({ error: 'No Telegram linked for this wallet' }, 400);
  }

  const conn = new Connection(config.solana?.rpc || 'https://api.mainnet-beta.solana.com');

  let walletAddress: string;
  try {
    const { wallet } = await loadWalletById(walletId);
    walletAddress = wallet.address;
  } catch (e: any) {
    return c.json({ error: 'Wallet not found', details: e.message }, 404);
  }

  const positions = await discoverAllPositions(conn, walletAddress);

  if (positions.length === 0) {
    const text = [
      `*No LP Positions Found*`,
      ``,
      `Wallet: \`${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}\``,
      ``,
      `You don't have any Meteora DLMM positions yet.`,
      ``,
      `Use /balance to check your SOL balance.`,
    ].join('\n');

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: recipient.telegram.chatId, text, parse_mode: 'Markdown' }),
    });

    return c.json({ success: true, positions: 0 });
  }

  const positionLines = positions.map((p: any) => {
    const status = p.inRange ? '(IN)' : '(OUT)';
    const priceDisplay = p.priceRange?.currentPrice
      ? `$${p.priceRange.currentPrice < 1 ? p.priceRange.currentPrice.toFixed(4) : p.priceRange.currentPrice.toFixed(2)}`
      : 'N/A';
    const rangeDisplay = p.priceRange?.display || 'Unknown';
    const feesX = p.fees?.tokenXFormatted || '0';
    const feesY = p.fees?.tokenYFormatted || '0';

    return [
      `${status} *${p.pool?.name || 'Unknown Pool'}* - ${p.inRange ? 'IN RANGE' : 'OUT OF RANGE'}`,
      `Price: ${priceDisplay} (${rangeDisplay.split(' ')[0]} - ${rangeDisplay.split(' ')[2]})`,
      `Fees: ${feesX} + ${feesY}`,
    ].join('\n');
  }).join('\n\n');

  const text = [
    `*Your LP Positions*`,
    ``,
    positionLines,
    ``,
    `Monitoring: Every 5 min`,
    `Alerts: Active`,
  ].join('\n');

  const buttons: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];

  const solscanRow = positions.slice(0, 2).map((p: any) => ({
    text: `View ${p.pool?.name || 'Position'}`,
    url: `https://solscan.io/account/${p.address}`,
  }));
  if (solscanRow.length > 0) buttons.push(solscanRow);

  buttons.push([
    { text: 'Claim Fees', callback_data: 'claim_fees' },
    { text: 'Rebalance', callback_data: 'rebalance' },
  ]);
  buttons.push([
    { text: 'Add LP', callback_data: 'add_lp' },
    { text: 'Withdraw', callback_data: 'withdraw' },
  ]);
  buttons.push([
    { text: 'Balance', callback_data: 'balance' },
    { text: 'Settings', callback_data: 'settings' },
  ]);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: recipient.telegram.chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    }),
  });

  const data = await response.json() as any;

  return c.json({
    success: data.ok,
    positions: positions.length,
    error: data.ok ? undefined : data.description,
  });
});

// Test notification
app.post('/notify/:walletId/test', async (c) => {
  const walletId = c.req.param('walletId');

  const testPayload: AlertPayload = {
    event: 'out_of_range',
    walletId,
    timestamp: new Date().toISOString(),
    position: {
      address: 'test-position',
      poolName: 'TEST-POOL',
      poolAddress: 'test-pool-address',
    },
    details: {
      message: 'This is a test notification from LP Agent Toolkit',
      currentBin: 100,
      binRange: { lower: 90, upper: 110 },
      direction: 'above',
      distance: 5,
    },
    action: {
      suggested: 'rebalance',
      endpoint: 'POST /lp/rebalance/execute',
      method: 'POST',
      params: { walletId, positionAddress: 'test' },
    },
  };

  const results = await sendAlert(walletId, testPayload);

  return c.json({
    success: results.telegram?.success || results.webhook?.success || false,
    results,
  });
});

// OpenClaw setup guide
app.get('/openclaw/setup', async (c) => {
  const walletId = c.req.query('walletId');

  return c.json({
    title: 'Connect LP Agent to OpenClaw',
    description: 'Enable natural language LP management through your Clawdbot',
    steps: [
      {
        step: 1,
        title: 'Install the LP Agent Skill',
        action: 'Add to your OpenClaw skills directory',
        command: `curl -o ~/.openclaw/skills/lp-agent/SKILL.md https://lp-agent-api-production.up.railway.app/skill.md`,
      },
      {
        step: 2,
        title: 'Configure your wallet',
        config: {
          LP_AGENT_API: 'https://lp-agent-api-production.up.railway.app',
          LP_WALLET_ID: walletId || '<your-wallet-id>',
        },
      },
      {
        step: 3,
        title: 'Register webhook',
        command: walletId ? `curl -X POST "${c.req.url.split('/openclaw')[0]}/notify/register" -H "Content-Type: application/json" -d '{"walletId":"${walletId}","webhook":{"url":"http://localhost:18789/webhook/lp-agent"}}'` : 'First create a wallet with POST /wallet/create',
      },
      {
        step: 4,
        title: 'Test the integration',
        examples: ['LP 0.5 SOL into the best pool', 'Check my positions'],
      },
    ],
    skillUrl: 'https://lp-agent-api-production.up.railway.app/skill.md',
    docsUrl: 'https://api.mnm.ag',
    telegramBot: '@mnm_lp_bot',
  });
});

// OpenClaw connect
app.post('/openclaw/connect', async (c) => {
  try {
    const body = await c.req.json();
    const { walletId, openclawGateway } = body;

    if (!walletId) {
      return c.json({ error: 'Missing walletId' }, 400);
    }

    const gatewayUrl = openclawGateway || 'http://localhost:18789';

    await upsertRecipient({
      walletId,
      webhook: {
        url: `${gatewayUrl}/webhook/lp-agent`,
        secret: `lp-${walletId.slice(0, 8)}`,
        linkedAt: new Date().toISOString(),
      },
    });

    return c.json({
      success: true,
      message: 'OpenClaw connected!',
      config: {
        addToOpenclawConfig: {
          'env.LP_AGENT_API': 'https://lp-agent-api-production.up.railway.app',
          'env.LP_WALLET_ID': walletId,
        },
      },
      webhookRegistered: {
        url: `${gatewayUrl}/webhook/lp-agent`,
        events: ['natural_language', 'alerts'],
      },
      nextSteps: [
        '1. Copy the skill file',
        '2. Restart OpenClaw to load the skill',
        '3. Try: "LP 0.5 SOL into SOL-USDC"',
      ],
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;

/**
 * Telegram webhook/management routes (legacy raw Telegram API)
 * These will be replaced by grammY bot in Task #4
 */
export function telegramRoutes() {
  const tApp = new Hono();

  // Natural language handler
  async function handleNaturalLanguage(
    chatId: number | string,
    text: string,
    user: any,
    botToken: string
  ): Promise<boolean> {
    const intents: Array<{ pattern: RegExp; handler: () => Promise<string | { text: string; buttons?: any[][] }> }> = [
      {
        pattern: /balance|how much|what.*have/i,
        handler: async () => handleBalance(chatId),
      },
      {
        pattern: /position|my lp|portfolio|holdings/i,
        handler: async () => handlePositions(chatId),
      },
      {
        pattern: /pool|top pool|best pool|where.*lp|apy/i,
        handler: async () => handlePools(chatId),
      },
      {
        pattern: /lp\s+(\d+\.?\d*)\s*(sol)?|add.*liquidity|provide.*liquidity|lp.*into/i,
        handler: async () => {
          const poolAddressMatch = text.match(/([1-9A-HJ-NP-Za-km-z]{32,44})/);
          if (poolAddressMatch) {
            const poolAddress = poolAddressMatch[1];
            try {
              const meteoraResp = await fetch(`https://dlmm-api.meteora.ag/pair/${poolAddress}`);
              if (meteoraResp.ok) {
                const poolData = await meteoraResp.json() as any;
                const pairName = poolData.name ||
                  (poolData.mint_x_symbol && poolData.mint_y_symbol
                    ? `${poolData.mint_x_symbol}-${poolData.mint_y_symbol}`
                    : null) ||
                  `Pool ${poolAddress.slice(0, 8)}...`;
                return handleLpAmountPrompt(poolAddress, pairName);
              }
            } catch (e) {
              console.error('Meteora pool lookup failed:', e);
            }
            return handleLpAmountPrompt(poolAddress, `Pool ${poolAddress.slice(0, 8)}...`);
          }

          const pairMatch = text.match(/([A-Z]{2,10})[- ]([A-Z]{2,10})/i);
          if (pairMatch) {
            const tokenA = pairMatch[1].toUpperCase();
            const tokenB = pairMatch[2].toUpperCase();
            const pairName = `${tokenA}-${tokenB}`;

            const knownPools: Record<string, string> = {
              'SOL-USDC': '9Q1njS4j8svdjCnGd2xJn7RAkqrJ2vqjaPs3sXRZ6UR7',
              'USDC-SOL': '9Q1njS4j8svdjCnGd2xJn7RAkqrJ2vqjaPs3sXRZ6UR7',
              'MET-USDC': '5hbf9JP8k5zdrZp9pokPypFQoBse5mGCmW6nqodurGcd',
              'USDC-MET': '5hbf9JP8k5zdrZp9pokPypFQoBse5mGCmW6nqodurGcd',
              'BFS-SOL': 'E6sr5aGsJwkmvxQxLWrLzo78wMFQm7JUn6aCTGpF4zmH',
              'SOL-BFS': 'E6sr5aGsJwkmvxQxLWrLzo78wMFQm7JUn6aCTGpF4zmH',
            };

            const poolAddress = knownPools[pairName] || knownPools[`${tokenB}-${tokenA}`];
            if (poolAddress) {
              return handleLpAmountPrompt(poolAddress, pairName);
            }

            return {
              text: `*Pool Not Found*\n\nCouldn't find a ${pairName} pool.\n\nTry /pools to see available pools.`,
            };
          }

          return handleLpAmountPrompt('BVRbyLjjfSBcoyiYFUxFjLYrKnPYS9DbYEoHSdniRLsE', 'SOL-USDC');
        },
      },
      {
        pattern: /withdraw|pull out|exit|remove.*liquidity/i,
        handler: async () => handleWithdraw(chatId),
      },
      {
        pattern: /claim|fees|collect/i,
        handler: async () => ({
          text: `*Claiming Fees...*\n\nEncrypting with Arcium...\nBuilding Jito bundle...\n\nI'll notify you when complete!`,
        }),
      },
      {
        pattern: /deposit|fund|send.*sol/i,
        handler: async () => handleDeposit(chatId),
      },
    ];

    for (const { pattern, handler } of intents) {
      if (pattern.test(text)) {
        const result = await handler();

        if (typeof result === 'string') {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: result, parse_mode: 'Markdown' }),
          });
        } else if (result.buttons) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: result.text,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: result.buttons },
            }),
          });
        }
        return true;
      }
    }

    const recipient = await getRecipient(user.walletId);
    if (recipient?.webhook?.url) {
      try {
        const payload = {
          event: 'natural_language',
          chatId,
          walletId: user.walletId,
          message: text,
          timestamp: new Date().toISOString(),
          replyEndpoint: `https://lp-agent-api-production.up.railway.app/telegram/send`,
        };

        const reqBody = JSON.stringify(payload);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'MnM-LP-Toolkit/1.0',
        };

        if (recipient.webhook.secret) {
          const crypto = await import('crypto');
          const signature = crypto.createHmac('sha256', recipient.webhook.secret).update(reqBody).digest('hex');
          headers['X-Signature'] = `sha256=${signature}`;
        }

        await fetch(recipient.webhook.url, {
          method: 'POST',
          headers,
          body: reqBody,
          signal: AbortSignal.timeout(5000),
        });

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: `Processing your request...`, parse_mode: 'Markdown' }),
        });

        return true;
      } catch {
        // Webhook failed, fall through
      }
    }

    return false;
  }

  // Telegram webhook
  tApp.post('/webhook', async (c) => {
    const update = await c.req.json();
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      return c.json({ ok: false, error: 'Bot token not configured' });
    }

    try {
      const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
      const text = update.message?.text || '';
      const username = update.message?.from?.username;

      const hasPhoto = update.message?.photo;
      const hasDocument = update.message?.document;
      const hasSticker = update.message?.sticker;
      const hasVoice = update.message?.voice;

      if (hasPhoto || hasDocument || hasSticker || hasVoice) {
        const mediaType = hasPhoto ? 'images' : hasDocument ? 'documents' : hasSticker ? 'stickers' : 'voice messages';
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `I can't process ${mediaType} yet. Try sending a text command like /balance or /pools instead!`,
            parse_mode: 'Markdown',
          }),
        });
        return c.json({ ok: true });
      }

      let response = '';

      if (update.message?.text) {
        const command = text.split(' ')[0].toLowerCase();

        switch (command) {
          case '/start':
            response = await handleStart(chatId, username);
            break;
          case '/link': {
            const walletIdArg = text.split(' ')[1];
            if (!walletIdArg) {
              response = [
                `*Link Existing Wallet*`,
                ``,
                `Usage: \`/link <walletId>\``,
                ``,
                `Your walletId was returned when you created the wallet via API.`,
              ].join('\n');
            } else {
              response = await handleLink(chatId, walletIdArg.trim(), username);
            }
            break;
          }
          case '/balance': {
            const balResult = await handleBalance(chatId);
            if (balResult.buttons) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: balResult.text,
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: balResult.buttons },
                }),
              });
              return c.json({ ok: true });
            }
            response = balResult.text;
            break;
          }
          case '/positions': {
            const posResult = await handlePositions(chatId);
            if (posResult.buttons) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: posResult.text,
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: posResult.buttons },
                }),
              });
              return c.json({ ok: true });
            }
            response = posResult.text;
            break;
          }
          case '/status':
            response = `Use /positions for full portfolio view, or /balance for wallet balance.`;
            break;
          case '/deposit':
            response = await handleDeposit(chatId);
            break;
          case '/withdraw': {
            const withdrawResult = await handleWithdraw(chatId);
            if (withdrawResult.buttons) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: withdrawResult.text,
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: withdrawResult.buttons },
                }),
              });
              return c.json({ ok: true });
            }
            response = withdrawResult.text;
            break;
          }
          case '/settings': {
            const settingsResult = await handleSettings(chatId);
            if (settingsResult.buttons) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: settingsResult.text,
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: settingsResult.buttons },
                }),
              });
              return c.json({ ok: true });
            }
            response = settingsResult.text;
            break;
          }
          case '/pools': {
            const poolsResult = await handlePools(chatId);
            if (poolsResult.buttons) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: poolsResult.text,
                  parse_mode: 'Markdown',
                  reply_markup: { inline_keyboard: poolsResult.buttons },
                }),
              });
              return c.json({ ok: true });
            }
            response = poolsResult.text;
            break;
          }
          case '/help':
            response = [
              `*MnM LP Toolkit Commands*`,
              ``,
              `/start - Create wallet or show existing`,
              `/balance - Check wallet balance`,
              `/pools - Browse top LP pools`,
              `/positions - View your LP positions`,
              `/deposit - Get deposit address`,
              `/withdraw - Withdraw funds`,
              `/settings - Alert preferences`,
              `/help - This message`,
              ``,
              `All transactions encrypted with *Arcium*`,
              `MEV-protected via *Jito bundles*`,
              ``,
              `_Docs: api.mnm.ag_`,
            ].join('\n');
            break;
          default: {
            const user = await getUserByChat(chatId);
            if (!user) {
              response = `Hi! Use /start to create your wallet.`;
            } else {
              const nlResponse = await handleNaturalLanguage(chatId, text, user, botToken);
              if (nlResponse) {
                return c.json({ ok: true });
              }
              response = `I didn't understand that. Try /help for commands, or be more specific like "LP 0.5 SOL into SOL-USDC"`;
            }
          }
        }

        if (response) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: response, parse_mode: 'Markdown' }),
          });
        }
      }

      // Handle callback queries
      if (update.callback_query) {
        const data = update.callback_query.data;
        const callbackId = update.callback_query.id;

        if (chatId && data) {
          response = await handleTelegramCallback(chatId, data);

          await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackId, text: 'Processing...' }),
          });

          if (response.startsWith('LP_AMOUNT_PROMPT:')) {
            const [, poolAddress, poolName] = response.split(':');
            const prompt = handleLpAmountPrompt(poolAddress, poolName);
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: prompt.text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: prompt.buttons },
              }),
            });
            return c.json({ ok: true });
          }

          if (response.startsWith('LP_STRATEGY_PROMPT:')) {
            const [, poolAddress, amount] = response.split(':');
            const prompt = handleLpStrategyPrompt(poolAddress, amount);
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: prompt.text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: prompt.buttons },
              }),
            });
            return c.json({ ok: true });
          }

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: response, parse_mode: 'Markdown' }),
          });
          return c.json({ ok: true });
        }
      }

      return c.json({ ok: true });
    } catch (error: any) {
      console.error('[Telegram Webhook] Error:', error);
      return c.json({ ok: false, error: error.message });
    }
  });

  // Telegram bot info
  tApp.get('/info', async (c) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
    }

    try {
      const meResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const meData = await meResponse.json() as any;
      const cmdResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMyCommands`);
      const cmdData = await cmdResponse.json() as any;

      return c.json({
        success: true,
        bot: meData.ok ? { id: meData.result.id, username: meData.result.username, name: meData.result.first_name } : null,
        commands: cmdData.ok ? cmdData.result : [],
        commandsCount: cmdData.ok ? cmdData.result.length : 0,
      });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  // Set bot commands
  tApp.post('/commands', async (c) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
    }

    const commands = [
      { command: 'start', description: 'Create wallet or show existing' },
      { command: 'balance', description: 'Check wallet balance & tokens' },
      { command: 'pools', description: 'Browse top LP pools' },
      { command: 'positions', description: 'View your LP positions' },
      { command: 'deposit', description: 'Get deposit address' },
      { command: 'withdraw', description: 'Withdraw funds' },
      { command: 'settings', description: 'Alert preferences' },
      { command: 'help', description: 'Show all commands' },
    ];

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands }),
      });
      const data = await response.json() as any;
      if (data.ok) {
        return c.json({ success: true, message: 'Bot commands menu set', commands });
      } else {
        return c.json({ success: false, error: data.description }, 400);
      }
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  // Setup webhook
  tApp.post('/setup', async (c) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const webhookUrl = body.url || `https://lp-agent-api-production.up.railway.app/telegram/webhook`;

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message', 'callback_query'] }),
      });
      const data = await response.json() as any;
      if (data.ok) {
        return c.json({ success: true, message: 'Telegram webhook configured', webhookUrl });
      } else {
        return c.json({ success: false, error: data.description }, 400);
      }
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  // Send message
  tApp.post('/send', async (c) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
    }

    try {
      const body = await c.req.json();
      const { chatId, message, buttons, parseMode = 'Markdown' } = body;

      if (!chatId || !message) {
        return c.json({ error: 'Missing chatId or message' }, 400);
      }

      const payload: any = { chat_id: chatId, text: message, parse_mode: parseMode };
      if (buttons && Array.isArray(buttons)) {
        payload.reply_markup = { inline_keyboard: buttons };
      }

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as any;

      return c.json({
        success: data.ok,
        messageId: data.result?.message_id,
        error: data.ok ? undefined : data.description,
      });
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500);
    }
  });

  return tApp;
}
