/**
 * Structured Logging Utility for AEGIS BOT SHIELD
 * 
 * Features:
 * - Log levels: DEBUG, INFO, WARN, ERROR, FATAL
 * - Structured JSON output for production
 * - Pretty console output for development
 * - Correlation IDs for request tracing
 * - Performance timing utilities
 * - Context-aware (module name prefix)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',  // Cyan
  info: '\x1b[32m',   // Green
  warn: '\x1b[33m',   // Yellow
  error: '\x1b[31m',  // Red
  fatal: '\x1b[35m',  // Magenta
};

const RESET = '\x1b[0m';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  error?: { message: string; stack?: string; name: string };
  correlationId?: string;
}

export class Logger {
  private module: string;
  private static globalLevel: LogLevel = 'info';
  private static structured: boolean = false;
  private static handlers: Array<(entry: LogEntry) => void> = [];

  constructor(module: string) {
    this.module = module;
  }

  // Static configuration
  public static setLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  public static setStructured(structured: boolean): void {
    Logger.structured = structured;
  }

  public static addHandler(handler: (entry: LogEntry) => void): void {
    Logger.handlers.push(handler);
  }

  // Log methods
  public debug(message: string, data?: Record<string, unknown>): void { this.log('debug', message, data); }
  public info(message: string, data?: Record<string, unknown>): void { this.log('info', message, data); }
  public warn(message: string, data?: Record<string, unknown>): void { this.log('warn', message, data); }
  
  public error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    let errorObj;
    if (error instanceof Error) {
      errorObj = { message: error.message, stack: error.stack, name: error.name };
    } else if (error !== undefined) {
      errorObj = { message: String(error), name: 'UnknownError' };
    }
    this.log('error', message, data, errorObj);
  }
  
  public fatal(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    let errorObj;
    if (error instanceof Error) {
      errorObj = { message: error.message, stack: error.stack, name: error.name };
    } else if (error !== undefined) {
      errorObj = { message: String(error), name: 'UnknownError' };
    }
    this.log('fatal', message, data, errorObj);
  }

  /**
   * Time a function execution and log the result.
   * @example
   * const result = await logger.time('analyzeIP', async () => { ... });
   */
  public async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const elapsed = performance.now() - start;
      this.debug(`${label} completed`, { elapsedMs: Math.round(elapsed * 100) / 100 });
      return result;
    } catch (err) {
      const elapsed = performance.now() - start;
      this.error(`${label} failed after ${elapsed.toFixed(2)}ms`, err as Error);
      throw err;
    }
  }

  /**
   * Create a child logger with additional context.
   */
  public child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>, error?: { message: string; stack?: string; name: string }): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[Logger.globalLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      ...(data && { data }),
      ...(error && { error })
    };

    // Call custom handlers
    for (const handler of Logger.handlers) {
      try { handler(entry); } catch (_) { /* ignore handler errors */ }
    }

    if (Logger.structured) {
      // JSON structured output for production
      console.log(JSON.stringify(entry));
    } else {
      // Pretty console output for development
      const color = LOG_COLORS[level];
      const prefix = `${color}[${level.toUpperCase()}]${RESET}`;
      const moduleStr = `\x1b[90m[${this.module}]${RESET}`;
      
      let extra = '';
      if (data) extra += ` ${JSON.stringify(data)}`;
      if (error) {
        extra += `\n${color}  ${error.name}: ${error.message}${RESET}`;
        if (error.stack) extra += `\n\x1b[90m${error.stack}${RESET}`;
      }

      console.log(`${prefix} ${moduleStr} ${message}${extra}`);
    }
  }
}
