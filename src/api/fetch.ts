/**
 * Safe Fetch Utilities
 * Adds timeout, retry, and error handling to all external API calls
 */

// ============ Types ============

export interface FetchOptions {
  timeout?: number; // Timeout in ms (default: 10000)
  retries?: number; // Number of retries (default: 2)
  retryDelay?: number; // Delay between retries in ms (default: 1000)
  headers?: Record<string, string>;
}

export interface FetchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
  retryCount?: number;
  durationMs?: number;
}

// ============ Safe Fetch ============

/**
 * Fetch with timeout, retry, and error handling
 */
export async function safeFetch<T = any>(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  const {
    timeout = 10000,
    retries = 2,
    retryDelay = 1000,
    headers = {},
  } = options;

  const startTime = Date.now();
  let lastError: string = "";
  let retryCount = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "LP-Toolkit/1.0",
          ...headers,
        },
      });

      clearTimeout(timeoutId);

      // Check response status
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return {
            success: false,
            error: lastError,
            status: response.status,
            durationMs: Date.now() - startTime,
          };
        }

        // Retry on server errors (5xx)
        if (attempt < retries) {
          retryCount++;
          await sleep(retryDelay);
          continue;
        }
      }

      // Parse JSON
      const data = await response.json();

      return {
        success: true,
        data,
        status: response.status,
        retryCount,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      if (error.name === "AbortError") {
        lastError = `Request timeout after ${timeout}ms`;
      } else if (error.message?.includes("fetch failed")) {
        lastError = "Network error: Unable to reach server";
      } else {
        lastError = error.message || "Unknown error";
      }

      // Retry
      if (attempt < retries) {
        retryCount++;
        await sleep(retryDelay);
        continue;
      }
    }
  }

  return {
    success: false,
    error: lastError,
    retryCount,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Fetch with POST method
 */
export async function safePost<T = any>(
  url: string,
  body: any,
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  const {
    timeout = 10000,
    retries = 2,
    retryDelay = 1000,
    headers = {},
  } = options;

  const startTime = Date.now();
  let lastError: string = "";
  let retryCount = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "LP-Toolkit/1.0",
          ...headers,
        },
        body: JSON.stringify(body),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;

        if (response.status >= 400 && response.status < 500) {
          return {
            success: false,
            error: lastError,
            status: response.status,
            durationMs: Date.now() - startTime,
          };
        }

        if (attempt < retries) {
          retryCount++;
          await sleep(retryDelay);
          continue;
        }
      }

      const data = await response.json();

      return {
        success: true,
        data,
        status: response.status,
        retryCount,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      if (error.name === "AbortError") {
        lastError = `Request timeout after ${timeout}ms`;
      } else {
        lastError = error.message || "Unknown error";
      }

      if (attempt < retries) {
        retryCount++;
        await sleep(retryDelay);
        continue;
      }
    }
  }

  return {
    success: false,
    error: lastError,
    retryCount,
    durationMs: Date.now() - startTime,
  };
}

// ============ Batch Fetch ============

/**
 * Fetch from multiple URLs, return first successful result
 */
export async function fetchFirst<T = any>(
  urls: string[],
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  const startTime = Date.now();
  const errors: string[] = [];

  for (const url of urls) {
    const result = await safeFetch<T>(url, { ...options, retries: 0 });

    if (result.success) {
      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    }

    errors.push(`${url}: ${result.error}`);
  }

  return {
    success: false,
    error: `All endpoints failed: ${errors.join("; ")}`,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Fetch from multiple URLs in parallel, return all results
 */
export async function fetchAll<T = any>(
  urls: string[],
  options: FetchOptions = {},
): Promise<FetchResult<T>[]> {
  return Promise.all(urls.map((url) => safeFetch<T>(url, options)));
}

// ============ Helpers ============

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ RPC Specific ============

/**
 * Make a Solana RPC call with timeout and retry
 */
export async function safeRpcCall<T = any>(
  rpcUrl: string,
  method: string,
  params: any[],
): Promise<FetchResult<T>> {
  const response = await safePost<{ result?: T; error?: { message: string } }>(
    rpcUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    },
  );

  if (response.success && response.data?.result !== undefined) {
    return {
      success: true,
      data: response.data.result,
      status: response.status,
      retryCount: response.retryCount,
      durationMs: response.durationMs,
    };
  }

  return {
    success: false,
    error: response.data?.error?.message || response.error || "RPC call failed",
    status: response.status,
    retryCount: response.retryCount,
    durationMs: response.durationMs,
  };
}

export default {
  safeFetch,
  safePost,
  fetchFirst,
  fetchAll,
  safeRpcCall,
};
