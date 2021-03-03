export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogMethod = (...args: any[]) => any;

export type Logger = Record<LogLevel, LogMethod>;

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export function createLogger(f: (level: LogLevel) => LogMethod): Logger {
  return Object.assign({}, ...LOG_LEVELS.map(level => ({[level]: f(level)})));
}
