import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInMemoryCustomerRepository,
  type CustomerRepository,
} from '../../src/data/customerRepository.js';
import { createLogger, type LogSink } from '../../src/logger.js';
import { CUSTOMER_ID_PATTERN } from '../../src/schemas.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from '../../src/server.js';

const REASON = 'Refund for a damaged shipment';

interface Harness {
  client: Client;
  clientTransport: InMemoryTransport;
  logLines: string[];
}

const openClients: Client[] = [];

async function connect(
  repository: CustomerRepository = createInMemoryCustomerRepository(),
): Promise<Harness> {
  const logLines: string[] = [];
  const sink: LogSink = { write: (line) => logLines.push(line) };
  const server = createServer({ repository, logger: createLogger('debug', sink) });
  const client = new Client({ name: 'server-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  openClients.push(client);
  return { client, clientTransport, logLines };
}

async function captureMcpError(action: () => Promise<unknown>): Promise<McpError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof McpError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an McpError to be thrown');
}

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

describe('createServer', () => {
  it('reports its name, version and tools capability', async () => {
    const { client } = await connect();

    expect(client.getServerVersion()).toEqual({ name: SERVER_NAME, version: SERVER_VERSION });
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
  });

  it('lists both tools with closed input and output schemas', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['get_customer_record', 'trigger_refund']);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(tool.outputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(tools[0]?.inputSchema).toMatchObject({
      properties: { customer_id: { type: 'string', pattern: CUSTOMER_ID_PATTERN.source } },
      required: ['customer_id'],
    });
  });

  it('returns structured content and matching text for a successful call', async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: 'trigger_refund',
      arguments: { customer_id: 'CUST-00001', amount: 49.99, reason: REASON },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      customerId: 'CUST-00001',
      amount: 49.99,
      remainingRefundableBalance: 450.01,
      status: 'processed',
    });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent) },
    ]);
  });

  it('returns isError results for business-rule failures', async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: 'trigger_refund',
      arguments: { customer_id: 'CUST-00003', amount: 1, reason: REASON },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Refund amount 1.00 USD exceeds the refundable balance of 0.00 USD for customer CUST-00003.',
      },
    ]);
  });

  it('rejects invalid arguments with InvalidParams and Zod issues', async () => {
    const { client, logLines } = await connect();
    const error = await captureMcpError(() =>
      client.callTool({
        name: 'trigger_refund',
        arguments: { customer_id: 'CUST-00001', amount: 10.001, reason: REASON },
      }),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('Invalid arguments for tool trigger_refund');
    expect(error.data).toEqual({
      issues: [
        {
          path: ['amount'],
          code: 'custom',
          message: 'amount must have at most 2 decimal places',
        },
      ],
    });
    expect(logLines.some((line) => line.includes('Tool call rejected'))).toBe(true);
  });

  it('rejects a call without arguments with InvalidParams', async () => {
    const { client } = await connect();
    const error = await captureMcpError(() => client.callTool({ name: 'get_customer_record' }));

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.data).toEqual({
      issues: [
        {
          path: [],
          code: 'invalid_type',
          message: 'Invalid input: expected object, received undefined',
        },
      ],
    });
  });

  it.each([
    ['null', null],
    ['an array', [{ customer_id: 'CUST-00001' }]],
    ['a string', 'CUST-00001'],
  ])('rejects %s as the arguments object with InvalidParams', async (_label, rawArguments) => {
    const { client } = await connect();
    const error = await captureMcpError(() =>
      client.request(
        {
          method: 'tools/call',
          params: { name: 'get_customer_record', arguments: rawArguments },
        },
        CallToolResultSchema,
      ),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
  });

  it('rejects an unknown tool with InvalidParams', async () => {
    const { client } = await connect();
    const error = await captureMcpError(() =>
      client.callTool({ name: 'delete_customer', arguments: {} }),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('Unknown tool: delete_customer');
  });

  it('maps unexpected failures to a generic InternalError and logs the cause', async () => {
    const failingRepository: CustomerRepository = {
      findById: () => Promise.reject(new Error('connection refused by db-primary:5432')),
      updateRefundableBalance: () => Promise.resolve(false),
    };
    const { client, logLines } = await connect(failingRepository);
    const error = await captureMcpError(() =>
      client.callTool({ name: 'get_customer_record', arguments: { customer_id: 'CUST-00001' } }),
    );

    expect(error.code).toBe(ErrorCode.InternalError);
    expect(error.message).toContain('Internal error');
    expect(error.message).not.toContain('db-primary');
    expect(error.data).toBeUndefined();
    const failureLog = logLines.find((line) => line.includes('Tool call failed'));
    expect(failureLog).toContain('db-primary');
    expect(failureLog).toContain('"level":"error"');
  });

  it('logs protocol errors to the logger instead of responding', async () => {
    const { clientTransport, logLines } = await connect();
    await clientTransport.send({ jsonrpc: '2.0', id: 9999, result: {} });

    await expect.poll(() => logLines.some((line) => line.includes('Protocol error'))).toBe(true);
  });
});
