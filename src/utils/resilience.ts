/**
 * Resilience utilities - retry, circuit breaker, debounce, validation
 *
 * Reusable patterns applied as wrappers around service calls.
 * Does NOT modify underlying modules (dex, jito, mpc, swap).
 */

// ---- Timeout wrapper ----

export interface TimeoutOptions {
  timeoutMs: number;
  errorMessage?: string;
}

/**
 * Wrap a promise with a timeout. Rejects with TimeoutError if exceeded.
 * Useful for Privy signing operations that can hang indefinitely.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const { timeoutMs, errorMessage } = options;
  
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    fn()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Default timeout for Privy signing operations (30 seconds)
 */
export const PRIVY_SIGN_TIMEOUT_MS = 30_000;

/**
 * Wrap a Privy signing function with timeout handling
 */
export function wrapSigningWithTimeout(
  signFn: (tx: string) => Promise<string>,
  timeoutMs: number = PRIVY_SIGN_TIMEOUT_MS,
): (tx: string) => Promise<string> {
  return async (tx: string) => {
    return withTimeout(
      () => signFn(tx),
      { timeoutMs, errorMessage: `Wallet signing timed out after ${timeoutMs / 1000}s. Please try again.` }
    );
  };
}

// ---- Retry with exponential backoff ----

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: any) => boolean;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryOn: () => true,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxRetries || !opts.retryOn(error)) {
        throw error;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs,
      );
      // Add jitter: +/- 25%
      const jitter = delay * (0.75 + Math.random() * 0.5);
      console.warn(
        `[Retry] Attempt ${attempt + 1}/${opts.maxRetries} failed, retrying in ${Math.round(jitter)}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }

  throw lastError;
}

// ---- Circuit Breaker ----

type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeMs: number;
  name: string;
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private _state: CircuitState = 'closed';
  private readonly options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> & { name: string }) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      resetTimeMs: options.resetTimeMs ?? 30000,
      name: options.name,
    };
  }

  get state(): CircuitState {
    if (
      this._state === 'open' &&
      Date.now() - this.lastFailure >= this.options.resetTimeMs
    ) {
      this._state = 'half-open';
    }
    return this._state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new Error(
        `[CircuitBreaker:${this.options.name}] Circuit is open. Service temporarily unavailable.`,
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this._state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.options.failureThreshold) {
      this._state = 'open';
      console.error(
        `[CircuitBreaker:${this.options.name}] Circuit opened after ${this.failures} failures`,
      );
    }
  }
}

// ---- Alert Debouncing ----

const alertTimestamps = new Map<string, number>();

/**
 * Returns true if the alert should be sent (not debounced).
 * Returns false if it was sent too recently.
 */
export function debounceAlert(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const lastSent = alertTimestamps.get(key);
  if (lastSent && now - lastSent < cooldownMs) {
    return false;
  }
  alertTimestamps.set(key, now);
  return true;
}

// ---- Input Validation ----

export function validateSolAmount(amount: number): { valid: boolean; error?: string } {
  if (!Number.isFinite(amount)) {
    return { valid: false, error: 'Amount must be a valid number.' };
  }
  if (amount <= 0) {
    return { valid: false, error: 'Amount must be greater than 0.' };
  }
  if (amount < 0.001) {
    return { valid: false, error: 'Minimum amount is 0.001 SOL.' };
  }
  if (amount > 10000) {
    return { valid: false, error: 'Maximum amount is 10,000 SOL per transaction.' };
  }
  return { valid: true };
}

export function validateSolanaAddress(address: string): boolean {
  // Base58 character set, 32-44 chars
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export function validateCallbackData(data: string): boolean {
  // Telegram callback data must be <= 64 bytes
  return Buffer.byteLength(data, 'utf8') <= 64;
}

// ---- Transient error detection ----

export function isTransientError(error: any): boolean {
  if (!error) return false;
  const message = (error.message || error.toString()).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504') ||
    message.includes('temporarily unavailable')
  );
}

/**
 * Classify an error into a user-friendly message.
 * 
 * NOTE: For API responses, prefer using formatErrorResponse from './errors.js'
 * which returns structured error codes (E1000-E8xxx) for programmatic handling.
 * This function is for human-readable messages in UIs and notifications.
 */
export function friendlyErrorMessage(error: any): string {
  if (!error) return 'An unexpected error occurred. Please try again.';
  const msg = (error.message || error.toString()).toLowerCase();

  if (msg.includes('insufficient') || msg.includes('not enough') || msg.includes('balance')) {
    return 'Insufficient SOL balance. Please deposit more SOL and try again.';
  }
  if (msg.includes('pool not found') || msg.includes('not found')) {
    return 'Pool not found. Please check the address and try again.';
  }
  if (msg.includes('circuit is open') || msg.includes('temporarily unavailable')) {
    return 'Service temporarily unavailable. Please try again later.';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'Request timed out. Please try again in a moment.';
  }
  if (msg.includes('rate limit') || msg.includes('429')) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (msg.includes('transaction failed') || msg.includes('bundle')) {
    return 'Transaction failed. Please try again in a moment.';
  }
  if (msg.includes('privy') || msg.includes('wallet')) {
    return 'Wallet service error. Please try again or contact support.';
  }

  return 'Something went wrong. Please try again.';
}
