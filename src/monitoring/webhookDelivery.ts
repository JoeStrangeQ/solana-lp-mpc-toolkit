/**
 * Webhook Delivery System
 * 
 * Delivers alerts to configured webhooks with:
 * - HMAC signature for authentication
 * - Exponential backoff retry logic
 * - Event filtering
 */

import * as crypto from 'crypto';
import type { AlertResult } from './positionMonitor.js';

export interface WebhookConfig {
  url: string;
  secret?: string;
  events: ('out_of_range' | 'value_change' | 'all')[];
  createdAt: string;
  lastDelivery?: string;
  deliveryStats: {
    successful: number;
    failed: number;
  };
}

export interface WebhookPayload {
  event: string;
  position: string;
  pool?: string;
  message: string;
  data: Record<string, any>;
  timestamp: string;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
  duration: number;
}

// Global webhook config (singleton)
let webhookConfig: WebhookConfig | null = null;

/**
 * Set the global webhook configuration
 */
export function setWebhookConfig(config: WebhookConfig | null): void {
  webhookConfig = config;
  console.log(`[Webhook] Config ${config ? 'set' : 'cleared'}: ${config?.url || 'none'}`);
}

/**
 * Get the current webhook configuration
 */
export function getWebhookConfig(): WebhookConfig | null {
  return webhookConfig;
}

/**
 * Generate HMAC signature for payload
 */
function generateSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Check if an event should be delivered based on webhook filter
 */
function shouldDeliverEvent(eventType: string, events: WebhookConfig['events']): boolean {
  if (events.includes('all')) return true;
  return events.includes(eventType as any);
}

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deliver an alert to the configured webhook
 * 
 * @param alert - The alert to deliver
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Delivery result
 */
export async function deliverAlert(
  alert: AlertResult,
  maxRetries: number = 3
): Promise<DeliveryResult> {
  const startTime = Date.now();
  
  if (!webhookConfig) {
    return {
      success: false,
      error: 'No webhook configured',
      attempts: 0,
      duration: 0,
    };
  }
  
  // Check event filter
  if (!shouldDeliverEvent(alert.type, webhookConfig.events)) {
    console.log(`[Webhook] Skipping ${alert.type} - not in event filter`);
    return {
      success: true,
      attempts: 0,
      duration: 0,
    };
  }
  
  // Build payload
  const payload: WebhookPayload = {
    event: alert.type,
    position: alert.positionAddress,
    pool: alert.data.pool,
    message: alert.message,
    data: alert.data,
    timestamp: alert.timestamp,
  };
  
  const payloadJson = JSON.stringify(payload);
  
  // Prepare headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'LP-Toolkit-Webhook/1.0',
  };
  
  // Add HMAC signature if secret is configured
  if (webhookConfig.secret) {
    headers['X-Signature'] = generateSignature(payloadJson, webhookConfig.secret);
  }
  
  // Retry loop with exponential backoff
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Webhook] Attempt ${attempt}/${maxRetries} to ${webhookConfig.url}`);
      
      const response = await fetch(webhookConfig.url, {
        method: 'POST',
        headers,
        body: payloadJson,
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      
      lastStatusCode = response.status;
      
      if (response.ok) {
        // Success!
        webhookConfig.lastDelivery = new Date().toISOString();
        webhookConfig.deliveryStats.successful++;
        
        console.log(`[Webhook] ✅ Delivered ${alert.type} alert (status ${response.status})`);
        
        return {
          success: true,
          statusCode: response.status,
          attempts: attempt,
          duration: Date.now() - startTime,
        };
      }
      
      // Non-2xx response
      lastError = `HTTP ${response.status}: ${await response.text().catch(() => 'No body')}`;
      console.warn(`[Webhook] ⚠️ Attempt ${attempt} failed: ${lastError}`);
      
    } catch (error: any) {
      lastError = error.message || 'Unknown error';
      console.warn(`[Webhook] ⚠️ Attempt ${attempt} error: ${lastError}`);
    }
    
    // Exponential backoff: 1s, 2s, 4s...
    if (attempt < maxRetries) {
      const backoffMs = Math.pow(2, attempt - 1) * 1000;
      console.log(`[Webhook] Waiting ${backoffMs}ms before retry...`);
      await sleep(backoffMs);
    }
  }
  
  // All retries failed
  webhookConfig.deliveryStats.failed++;
  
  console.error(`[Webhook] ❌ Failed to deliver after ${maxRetries} attempts: ${lastError}`);
  
  return {
    success: false,
    statusCode: lastStatusCode,
    error: lastError,
    attempts: maxRetries,
    duration: Date.now() - startTime,
  };
}

/**
 * Deliver multiple alerts
 */
export async function deliverAlerts(alerts: AlertResult[]): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  
  for (const alert of alerts) {
    const result = await deliverAlert(alert);
    results.push(result);
  }
  
  return results;
}

/**
 * Test webhook connectivity (sends a test ping)
 */
export async function testWebhook(): Promise<DeliveryResult> {
  if (!webhookConfig) {
    return {
      success: false,
      error: 'No webhook configured',
      attempts: 0,
      duration: 0,
    };
  }
  
  const testAlert: AlertResult = {
    type: 'out_of_range',
    positionAddress: 'test-position-address',
    message: '🧪 This is a test alert from LP Toolkit',
    data: { test: true },
    timestamp: new Date().toISOString(),
  };
  
  return deliverAlert(testAlert, 1); // Only 1 attempt for test
}

export default {
  setWebhookConfig,
  getWebhookConfig,
  deliverAlert,
  deliverAlerts,
  testWebhook,
};
