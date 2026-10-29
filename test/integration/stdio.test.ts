import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  jsonRpcMessageSchema,
  SERVER_ENTRY,
  startServerProcess,
  type ServerProcess,
} from './serverProcess.js';

const REASON = 'Refund for a cancelled subscription';
const running: ServerProcess[] = [];

function start(args?: readonly string[]): ServerProcess {
  const server = startServerProcess(args);
  running.push(server);
  return server;
}

function expectOnlyJsonRpcOnStdout(server: ServerProcess): void {
  expect(server.stdoutLines.length).toBeGreaterThan(0);
  for (const line of server.stdoutLines) {
    const parsed: unknown = JSON.parse(line);
    expect(jsonRpcMessageSchema.safeParse(parsed).success, line).toBe(true);
  }
}

function importServerThen(statement: string): string[] {
  return [
    '--input-type=module',
    '--eval',
    `await import(${JSON.stringify(SERVER_ENTRY)}); ${statement}`,
  ];
}

afterEach(() => {
  for (const server of running.splice(0)) {
    if (server.child.exitCode === null && server.child.signalCode === null) {
      server.child.kill('SIGKILL');
    }
  }
});

describe('stdout isolation', () => {
  it('writes nothing to stdout before a request arrives and logs startup to stderr', async () => {
    const server = start();
    const startupLine = await server.waitForStderr('Server started');
    await delay(200);

    expect(server.stdoutLines).toEqual([]);
    expect(JSON.parse(startupLine)).toMatchObject({ level: 'info', message: 'Server started' });
  });

  it('emits only JSON-RPC messages on stdout across a full session', async () => {
    const server = start();
    await server.initialize();

    const list = await server.request(1, 'tools/list');
    const lookup = await server.request(2, 'tools/call', {
      name: 'get_customer_record',
      arguments: { customer_id: 'CUST-00001' },
    });
    const refund = await server.request(3, 'tools/call', {
      name: 'trigger_refund',
      arguments: { customer_id: 'CUST-00001', amount: 20, reason: REASON },
    });
    const businessFailure = await server.request(4, 'tools/call', {
      name: 'trigger_refund',
      arguments: { customer_id: 'CUST-00002', amount: 20, reason: REASON },
    });
    const invalid = await server.request(5, 'tools/call', {
      name: 'trigger_refund',
      arguments: { customer_id: 'CUST-00001', amount: '20', reason: REASON },
    });
    const unknownTool = await server.request(6, 'tools/call', {
      name: 'refund_everything',
      arguments: {},
    });
    const unknownMethod = await server.request(7, 'customers/delete');

    expect(list.result).toHaveProperty('tools');
    expect(lookup.result).toHaveProperty('structuredContent.customerId', 'CUST-00001');
    expect(refund.result).toHaveProperty('structuredContent.remainingRefundableBalance', 480);
    expect(businessFailure.result).toHaveProperty('isError', true);
    expect(invalid.error?.code).toBe(-32602);
    expect(invalid.error?.data).toMatchObject({ issues: [{ path: ['amount'] }] });
    expect(unknownTool.error?.code).toBe(-32602);
    expect(unknownTool.error?.message).toContain('Unknown tool: refund_everything');
    expect(unknownMethod.error?.code).toBe(-32601);

    expectOnlyJsonRpcOnStdout(server);
    expect(server.stderrLines.some((line) => line.includes('"message":"Tool call received"'))).toBe(
      true,
    );
    expect(
      server.stderrLines.some((line) => line.includes('"message":"Tool call completed"')),
    ).toBe(true);
  });

  it('redirects console output to stderr', async () => {
    const server = start(importServerThen("console.log('stray console output');"));
    await server.waitForStderr('stray console output');
    await server.initialize();

    expect(server.stdoutLines.join('\n')).not.toContain('stray console output');
    expectOnlyJsonRpcOnStdout(server);
  });
});

describe('malformed input', () => {
  it('logs invalid JSON to stderr without responding and keeps serving', async () => {
    const server = start();
    await server.initialize();
    const linesBefore = server.stdoutLines.length;

    server.send('{"jsonrpc": "2.0", "id": 50, "method": ');
    server.send('this is not json');
    await server.waitForStderr('Protocol error');
    const ping = await server.request(51, 'ping');

    expect(ping.result).toEqual({});
    expect(server.stdoutLines).toHaveLength(linesBefore + 1);
    expect(server.child.exitCode).toBeNull();
    expectOnlyJsonRpcOnStdout(server);
  });

  it('ignores JSON that is not a JSON-RPC message and keeps serving', async () => {
    const server = start();
    await server.initialize();
    const linesBefore = server.stdoutLines.length;

    server.send('{"hello": "world"}');
    server.send('[1, 2, 3]');
    await server.waitForStderr('Protocol error');
    const ping = await server.request(60, 'ping');

    expect(ping.result).toEqual({});
    expect(server.stdoutLines).toHaveLength(linesBefore + 1);
    expectOnlyJsonRpcOnStdout(server);
  });

  it('answers an unknown method with -32601 and keeps serving', async () => {
    const server = start();
    await server.initialize();

    const unknown = await server.request(70, 'resources/list');
    const ping = await server.request(71, 'ping');

    expect(unknown.error).toEqual({ code: -32601, message: 'Method not found' });
    expect(ping.result).toEqual({});
    expectOnlyJsonRpcOnStdout(server);
  });
});

describe('lifecycle', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('exits with code 0 on %s', async (signal) => {
    const server = start();
    await server.initialize();

    server.child.kill(signal);
    const exit = await server.waitForExit();

    expect(exit).toEqual({ code: 0, signal: null });
    expect(server.stderrLines.join('\n')).toContain(`"trigger":"${signal}"`);
  });

  it('exits with code 0 when stdin closes', async () => {
    const server = start();
    await server.initialize();

    server.child.stdin.end();
    const exit = await server.waitForExit();

    expect(exit).toEqual({ code: 0, signal: null });
    expect(server.stderrLines.join('\n')).toContain('"message":"Server stopped"');
  });

  it('answers a request that arrives just before stdin closes', async () => {
    const server = start();
    await server.initialize();

    server.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 80,
        method: 'tools/call',
        params: { name: 'get_customer_record', arguments: { customer_id: 'CUST-00003' } },
      }),
    );
    server.child.stdin.end();
    await server.waitForExit();

    expect(server.stdoutLines.some((line) => line.includes('"id":80'))).toBe(true);
  });

  it('logs an uncaught exception and exits with a non-zero code', async () => {
    const server = start(importServerThen("setTimeout(() => { throw new Error('boom'); });"));

    const exit = await server.waitForExit();

    expect(exit.code).toBe(1);
    expect(server.stderrLines.join('\n')).toContain('"message":"Uncaught exception"');
    expect(server.stdoutLines).toEqual([]);
  });

  it('logs an unhandled rejection and exits with a non-zero code', async () => {
    const server = start(importServerThen("Promise.reject(new Error('rejected'));"));

    const exit = await server.waitForExit();

    expect(exit.code).toBe(1);
    expect(server.stderrLines.join('\n')).toContain('"message":"Unhandled promise rejection"');
    expect(server.stdoutLines).toEqual([]);
  });
});
