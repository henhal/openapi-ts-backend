export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogMethod = (...args: any[]) => any;

export type Logger = Record<LogLevel, LogMethod>;

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export function getLogLevels(level: string): LogLevel[] {
  const pos = LOG_LEVELS.indexOf(level as LogLevel);

  return pos < 0 ? [] : LOG_LEVELS.filter((v, i) => i >= pos);
}

export function createLogger(f: (level: LogLevel) => LogMethod): Logger {
  return Object.assign({}, ...LOG_LEVELS.map(level => ({[level]: f(level)})));
}
