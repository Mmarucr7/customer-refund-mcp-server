#!/usr/bin/env node
import { format } from 'node:util';

const writeToStderr = (...values: unknown[]): void => {
  process.stderr.write(`${format(...values)}\n`);
};
console.log = writeToStderr;
console.info = writeToStderr;
console.debug = writeToStderr;

const { createLogger, parseLogLevel } = await import('./logger.js');
const logger = createLogger(parseLogLevel(process.env['LOG_LEVEL']), process.stderr);

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason });
  process.exit(1);
});

const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { createServer } = await import('./server.js');
const { createInMemoryCustomerRepository } = await import('./data/customerRepository.js');

const server = createServer({ repository: createInMemoryCustomerRepository(), logger });
let shutdownStarted = false;

async function shutdown(trigger: string, exitImmediately: boolean): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  logger.info('Shutting down', { trigger });
  await server.close();
  logger.info('Server stopped', { trigger });
  process.exitCode = 0;
  if (exitImmediately) {
    process.exit(0);
  }
}

function handleShutdown(trigger: string, exitImmediately: boolean): void {
  shutdown(trigger, exitImmediately).catch((error: unknown) => {
    logger.error('Shutdown failed', { trigger, error });
    process.exit(1);
  });
}

process.on('SIGINT', () => {
  handleShutdown('SIGINT', true);
});
process.on('SIGTERM', () => {
  handleShutdown('SIGTERM', true);
});
process.stdin.on('end', () => {
  handleShutdown('stdin end', false);
});
process.stdin.on('close', () => {
  handleShutdown('stdin close', false);
});

await server.connect(new StdioServerTransport());
logger.info('Server started', { transport: 'stdio' });
