/**
 * Operation Lock - Prevents duplicate concurrent operations
 *
 * Simple in-memory lock to prevent double-tap issues where a user
 * might trigger the same LP/withdraw/rebalance operation twice.
 */

interface LockEntry {
  operation: string;
  acquiredAt: number;
}

const locks = new Map<string, LockEntry>();

// Auto-release locks after 5 minutes to prevent permanent deadlocks
const LOCK_TTL_MS = 5 * 60 * 1000;

function lockKey(userId: string, operation: string): string {
  return `${userId}:${operation}`;
}

export class OperationLock {
  /**
   * Try to acquire a lock for a user+operation.
   * Returns true if acquired, false if already locked.
   */
  tryAcquire(userId: string, operation: string): boolean {
    const key = lockKey(userId, operation);
    const existing = locks.get(key);

    // If there's an existing lock, check if it's expired
    if (existing) {
      if (Date.now() - existing.acquiredAt > LOCK_TTL_MS) {
        // Expired, allow re-acquisition
        console.warn(`[OperationLock] Auto-releasing expired lock: ${key}`);
      } else {
        return false;
      }
    }

    locks.set(key, { operation, acquiredAt: Date.now() });
    return true;
  }

  /**
   * Release a lock for a user+operation.
   */
  release(userId: string, operation: string): void {
    locks.delete(lockKey(userId, operation));
  }

  /**
   * Check if a lock is held (without acquiring).
   */
  isLocked(userId: string, operation: string): boolean {
    const key = lockKey(userId, operation);
    const existing = locks.get(key);
    if (!existing) return false;
    if (Date.now() - existing.acquiredAt > LOCK_TTL_MS) {
      locks.delete(key);
      return false;
    }
    return true;
  }
}

// Singleton instance
export const operationLock = new OperationLock();
