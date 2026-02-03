/**
 * Structured Logger for API
 * Provides consistent logging format with levels
 */

// ============ Types ============

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
}

// ============ Configuration ============

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const shouldLog = (level: LogLevel): boolean => {
  return LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL as LogLevel];
};

// ============ Formatters ============

const formatMessage = (entry: LogEntry): string => {
  const levelEmoji: Record<LogLevel, string> = {
    debug: '🔍',
    info: 'ℹ️',
    warn: '⚠️',
    error: '❌',
  };

  const emoji = levelEmoji[entry.level];
  const contextStr = entry.context 
    ? ` ${JSON.stringify(entry.context)}` 
    : '';

  return `${entry.timestamp} ${emoji} [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;
};

// ============ Logger Functions ============

/**
 * Log a debug message
 */
export function debug(message: string, context?: Record<string, any>): void {
  if (!shouldLog('debug')) return;
  
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'debug',
    message,
    context,
  };
  
  console.log(formatMessage(entry));
}

/**
 * Log an info message
 */
export function info(message: string, context?: Record<string, any>): void {
  if (!shouldLog('info')) return;
  
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    message,
    context,
  };
  
  console.log(formatMessage(entry));
}

/**
 * Log a warning message
 */
export function warn(message: string, context?: Record<string, any>): void {
  if (!shouldLog('warn')) return;
  
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    message,
    context,
  };
  
  console.warn(formatMessage(entry));
}

/**
 * Log an error message
 */
export function error(message: string, context?: Record<string, any>): void {
  if (!shouldLog('error')) return;
  
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    message,
    context,
  };
  
  console.error(formatMessage(entry));
}

/**
 * Log an HTTP request (for middleware)
 */
export function request(method: string, path: string, status: number, durationMs: number): void {
  const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  
  if (!shouldLog(level)) return;
  
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: `${method} ${path}`,
    context: { status, durationMs },
  };
  
  console.log(formatMessage(entry));
}

/**
 * Create a child logger with preset context
 */
export function child(defaultContext: Record<string, any>) {
  return {
    debug: (msg: string, ctx?: Record<string, any>) => debug(msg, { ...defaultContext, ...ctx }),
    info: (msg: string, ctx?: Record<string, any>) => info(msg, { ...defaultContext, ...ctx }),
    warn: (msg: string, ctx?: Record<string, any>) => warn(msg, { ...defaultContext, ...ctx }),
    error: (msg: string, ctx?: Record<string, any>) => error(msg, { ...defaultContext, ...ctx }),
  };
}

export default {
  debug,
  info,
  warn,
  error,
  request,
  child,
};
