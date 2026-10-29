const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type LogLevel = keyof typeof LOG_LEVEL_PRIORITY;

export type LogContext = Readonly<Record<string, unknown>>;

export interface LogSink {
  write(line: string): unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const DEFAULT_LOG_LEVEL: LogLevel = 'info';

function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(LOG_LEVEL_PRIORITY, value);
}

export function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase() ?? '';
  return isLogLevel(normalized) ? normalized : DEFAULT_LOG_LEVEL;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function serializeContext(context: LogContext): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, serializeValue(value)]),
  );
}

export function createLogger(minimumLevel: LogLevel, sink: LogSink): Logger {
  const log = (level: LogLevel, message: string, context: LogContext = {}): void => {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minimumLevel]) {
      return;
    }
    const entry = {
      ...serializeContext(context),
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    sink.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    debug: (message, context) => {
      log('debug', message, context);
    },
    info: (message, context) => {
      log('info', message, context);
    },
    warn: (message, context) => {
      log('warn', message, context);
    },
    error: (message, context) => {
      log('error', message, context);
    },
  };
}
