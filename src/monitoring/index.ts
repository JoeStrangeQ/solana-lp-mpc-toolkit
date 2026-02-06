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

// Persistence
export {
  loadData,
  saveData,
  addPosition,
  removePosition,
  getPositions,
  setWebhook,
  getWebhook,
  setLastCheck,
  getLastCheck,
  getDataFilePath,
  clearAll,
} from './persistence.js';
export type { PersistedData } from './persistence.js';
