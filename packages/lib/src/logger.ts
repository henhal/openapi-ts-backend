import {getLogger} from 'loglevel';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogMethod = (...args: any[]) => any;
export type Logger = Record<LogLevel, LogMethod>;

export function createLogger(level: LogLevel | 'silent'): Logger {
  const logger = getLogger('main');
  logger.setDefaultLevel(level);

  return logger;
}
