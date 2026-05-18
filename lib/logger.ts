import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

const transport = isDev
  ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize:      true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore:        'pid,hostname',
          messageFormat: '{module} | {msg}',
        },
      },
    }
  : {};

const baseLogger = pino({
  level,
  ...transport,
  base: {
    env: process.env.NODE_ENV ?? 'development',
  },
  // Redact sensitive fields from structured logs
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.apiKey'],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = pino.Logger;

export function createLogger(module: string): pino.Logger {
  return baseLogger.child({ module });
}

export { baseLogger as logger };
