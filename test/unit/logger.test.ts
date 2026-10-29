import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger, parseLogLevel, type LogLevel } from '../../src/logger.js';

const logEntrySchema = z.looseObject({
  timestamp: z.iso.datetime(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
});

function captureLogs(level: LogLevel): {
  lines: string[];
  logger: ReturnType<typeof createLogger>;
} {
  const lines: string[] = [];
  const logger = createLogger(level, { write: (line) => lines.push(line) });
  return { lines, logger };
}

function parseEntries(lines: string[]): z.infer<typeof logEntrySchema>[] {
  return lines.map((line) => logEntrySchema.parse(JSON.parse(line)));
}

describe('parseLogLevel', () => {
  it.each([
    ['debug', 'debug'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
    [' WARN ', 'warn'],
    ['Debug', 'debug'],
  ])('parses %j as %s', (value, expected) => {
    expect(parseLogLevel(value)).toBe(expected);
  });

  it.each([undefined, '', 'verbose', 'trace', 'constructor'])('defaults %j to info', (value) => {
    expect(parseLogLevel(value)).toBe('info');
  });
});

describe('createLogger', () => {
  it('writes one JSON object per line', () => {
    const { lines, logger } = captureLogs('debug');
    logger.debug('first');
    logger.info('second', { requestId: 7 });
    logger.warn('third');
    logger.error('fourth');

    expect(lines.every((line) => line.endsWith('\n') && !line.slice(0, -1).includes('\n'))).toBe(
      true,
    );
    expect(parseEntries(lines).map((entry) => [entry.level, entry.message])).toEqual([
      ['debug', 'first'],
      ['info', 'second'],
      ['warn', 'third'],
      ['error', 'fourth'],
    ]);
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({ requestId: 7 });
  });

  it.each([
    ['debug', ['debug', 'info', 'warn', 'error']],
    ['info', ['info', 'warn', 'error']],
    ['warn', ['warn', 'error']],
    ['error', ['error']],
  ] as const)('at level %s emits %j', (level, expected) => {
    const { lines, logger } = captureLogs(level);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(parseEntries(lines).map((entry) => entry.level)).toEqual(expected);
  });

  it('serializes errors with name, message and stack', () => {
    const { lines, logger } = captureLogs('info');
    logger.error('failed', { error: new TypeError('bad value') });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      error: {
        name: 'TypeError',
        message: 'bad value',
        stack: expect.stringContaining('bad value') as unknown,
      },
    });
  });

  it('does not let context override the reserved fields', () => {
    const { lines, logger } = captureLogs('info');
    logger.info('real message', { level: 'error', message: 'spoofed', timestamp: 'never' });

    const [entry] = parseEntries(lines);
    expect(entry?.level).toBe('info');
    expect(entry?.message).toBe('real message');
  });
});
