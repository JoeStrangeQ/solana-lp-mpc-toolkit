// Position monitoring
export { PositionMonitor, getPositionMonitor } from './positionMonitor.js';
export type { MonitoredPosition, AlertResult } from './positionMonitor.js';

// Webhook delivery
export { 
  setWebhookConfig, 
  getWebhookConfig, 
  deliverAlert, 
  deliverAlerts,
  testWebhook,
} from './webhookDelivery.js';
export type { WebhookConfig, WebhookPayload, DeliveryResult } from './webhookDelivery.js';

// Persistence (Redis with in-memory fallback)
export {
  loadData,
  loadDataSync,
  saveData,
  addPosition,
  removePosition,
  getPositions,
  setWebhook,
  getWebhook,
  setLastCheck,
  getLastCheck,
  getStorageInfo,
  clearAll,
  isRedisAvailable,
} from './redis-persistence.js';
export type { PersistedData } from './redis-persistence.js';
