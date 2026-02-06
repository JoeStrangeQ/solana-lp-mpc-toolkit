/**
 * Persistence Module
 * 
 * File-based storage for monitored positions and webhook config.
 * Stores data in ~/.lp-toolkit/monitored-positions.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MonitoredPosition } from './positionMonitor.js';
import type { WebhookConfig } from './webhookDelivery.js';

export interface PersistedData {
  version: number;
  lastUpdated: string;
  positions: MonitoredPosition[];
  webhook: WebhookConfig | null;
  lastCheck?: string;
}

const DATA_DIR = path.join(os.homedir(), '.lp-toolkit');
const DATA_FILE = path.join(DATA_DIR, 'monitored-positions.json');
const CURRENT_VERSION = 1;

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[Persistence] Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Load persisted data from disk
 */
export function loadData(): PersistedData {
  ensureDataDir();
  
  if (!fs.existsSync(DATA_FILE)) {
    console.log('[Persistence] No data file found, starting fresh');
    return {
      version: CURRENT_VERSION,
      lastUpdated: new Date().toISOString(),
      positions: [],
      webhook: null,
    };
  }
  
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw) as PersistedData;
    
    // Migrate if needed
    if (!data.version || data.version < CURRENT_VERSION) {
      console.log(`[Persistence] Migrating from v${data.version || 0} to v${CURRENT_VERSION}`);
      data.version = CURRENT_VERSION;
    }
    
    console.log(`[Persistence] Loaded ${data.positions.length} positions, webhook: ${data.webhook ? 'configured' : 'none'}`);
    return data;
  } catch (error: any) {
    console.error(`[Persistence] Failed to load data: ${error.message}`);
    return {
      version: CURRENT_VERSION,
      lastUpdated: new Date().toISOString(),
      positions: [],
      webhook: null,
    };
  }
}

/**
 * Save data to disk
 */
export function saveData(data: PersistedData): void {
  ensureDataDir();
  
  data.lastUpdated = new Date().toISOString();
  
  try {
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(DATA_FILE, json, 'utf-8');
    console.log(`[Persistence] Saved ${data.positions.length} positions`);
  } catch (error: any) {
    console.error(`[Persistence] Failed to save data: ${error.message}`);
    throw error;
  }
}

/**
 * Add a position to persistent storage
 */
export function addPosition(position: MonitoredPosition): PersistedData {
  const data = loadData();
  
  // Check if position already exists
  const existingIndex = data.positions.findIndex(p => p.positionAddress === position.positionAddress);
  
  if (existingIndex >= 0) {
    // Update existing
    data.positions[existingIndex] = position;
    console.log(`[Persistence] Updated position ${position.positionAddress}`);
  } else {
    // Add new
    data.positions.push(position);
    console.log(`[Persistence] Added position ${position.positionAddress}`);
  }
  
  saveData(data);
  return data;
}

/**
 * Remove a position from persistent storage
 */
export function removePosition(positionAddress: string): PersistedData {
  const data = loadData();
  
  const initialLength = data.positions.length;
  data.positions = data.positions.filter(p => p.positionAddress !== positionAddress);
  
  if (data.positions.length < initialLength) {
    console.log(`[Persistence] Removed position ${positionAddress}`);
    saveData(data);
  } else {
    console.log(`[Persistence] Position ${positionAddress} not found`);
  }
  
  return data;
}

/**
 * Get all positions from persistent storage
 */
export function getPositions(): MonitoredPosition[] {
  return loadData().positions;
}

/**
 * Update webhook configuration
 */
export function setWebhook(webhook: WebhookConfig | null): PersistedData {
  const data = loadData();
  data.webhook = webhook;
  saveData(data);
  console.log(`[Persistence] Webhook ${webhook ? 'configured' : 'removed'}`);
  return data;
}

/**
 * Get webhook configuration
 */
export function getWebhook(): WebhookConfig | null {
  return loadData().webhook;
}

/**
 * Update last check timestamp
 */
export function setLastCheck(timestamp: string): void {
  const data = loadData();
  data.lastCheck = timestamp;
  saveData(data);
}

/**
 * Get last check timestamp
 */
export function getLastCheck(): string | undefined {
  return loadData().lastCheck;
}

/**
 * Get the data file path (for debugging)
 */
export function getDataFilePath(): string {
  return DATA_FILE;
}

/**
 * Clear all data (for testing)
 */
export function clearAll(): void {
  if (fs.existsSync(DATA_FILE)) {
    fs.unlinkSync(DATA_FILE);
    console.log('[Persistence] All data cleared');
  }
}

export default {
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
};
