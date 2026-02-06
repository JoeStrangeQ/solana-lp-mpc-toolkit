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

// User rules and settings
export {
  getUserSettings,
  setUserSettings,
  createDefaultSettings,
  getAllUsers,
  getUserRules,
  addUserRule,
  removeUserRule,
  getTrackedPositions,
  getAllTrackedPositions,
  trackPosition,
  untrackPosition,
  updatePositionStatus,
  parseNaturalRule,
} from './userRules.js';
export type { UserSettings, UserRule, TrackedPosition } from './userRules.js';

// Alert queue
export {
  queueAlert,
  getReadyAlerts,
  markProcessing,
  markDelivered,
  markRetry,
  getStats as getAlertStats,
  getFailedAlerts,
  retryFailedAlert,
  queueOutOfRangeAlert,
  queueRebalancePrompt,
  queueDailySummary,
} from './alertQueue.js';
export type { QueuedAlert, AlertAction, AlertStats } from './alertQueue.js';

// Telegram delivery
export {
  sendMessage as sendTelegramMessage,
  sendAlert as sendTelegramAlert,
  sendOutOfRangeAlert,
  sendRebalancePrompt,
  sendDailySummary,
  sendRebalanceComplete,
  sendPositionUpdate,
  verifyBot as verifyTelegramBot,
} from './telegram.js';

// Background worker
export {
  startWorker,
  stopWorker,
  isWorkerRunning,
  getWorkerStatus,
  triggerPositionCheck,
  triggerAlertProcessing,
} from './worker.js';
export type { WorkerState, WorkerLog } from './worker.js';
