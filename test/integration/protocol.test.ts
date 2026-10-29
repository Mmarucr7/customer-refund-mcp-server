import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_ENTRY } from './serverProcess.js';

const REASON = 'Customer was charged twice for one order';

let client: Client;
let transport: StdioClientTransport;
let stderrOutput: string;

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

function textOf(result: CallToolResult): string {
  const [block] = result.content;
  if (block?.type !== 'text') {
    throw new Error('Expected a text content block');
  }
  return block.text;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
}

beforeEach(async () => {
  stderrOutput = '';
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: { LOG_LEVEL: 'debug' },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString('utf8');
  });
  client = new Client({ name: 'protocol-test', version: '1.0.0' });
  await client.connect(transport);
});

afterEach(async () => {
  await client.close();
});

describe('initialization', () => {
  it('negotiates the session and advertises the tools capability', () => {
    expect(client.getServerVersion()).toEqual({
      name: 'customer-refund-mcp-server',
      version: '1.0.0',
    });
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
  });

  it('writes logs to stderr', async () => {
    await client.ping();
    expect(stderrOutput).toContain('"message":"Server started"');
  });
});

describe('tools/list', () => {
  it('lists both tools with input and output schemas', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['get_customer_record', 'trigger_refund']);
    expect(tools[1]?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        customer_id: { type: 'string', pattern: '^CUST-\\d{5}$' },
        amount: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
        reason: { type: 'string', minLength: 10, maxLength: 500 },
      },
      required: ['customer_id', 'amount', 'reason'],
      additionalProperties: false,
    });
    for (const tool of tools) {
      expect(tool.outputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });
});

describe('get_customer_record', () => {
  it('returns a customer record', async () => {
    const result = await callTool('get_customer_record', { customer_id: 'CUST-00002' });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      customerId: 'CUST-00002',
      name: 'Bob Martinez',
      email: 'bob.martinez@example.com',
      status: 'suspended',
      currency: 'USD',
      refundableBalance: 200,
      createdAt: '2024-03-02T14:05:00.000Z',
    });
    expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  });

  it('returns isError for an unknown customer', async () => {
    const result = await callTool('get_customer_record', { customer_id: 'CUST-99999' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Customer CUST-99999 was not found.');
  });

  it.each([
    ['a lowercase ID', { customer_id: 'cust-00001' }],
    ['an ID with four digits', { customer_id: 'CUST-0001' }],
    ['an ID with whitespace', { customer_id: ' CUST-00001' }],
    ['an empty ID', { customer_id: '' }],
    ['a numeric ID', { customer_id: 1 }],
    ['an extra property', { customer_id: 'CUST-00001', verbose: true }],
    ['no properties', {}],
  ])('rejects %s with -32602', async (_label, args) => {
    const error = await captureMcpError(() => callTool('get_customer_record', args));

    expect(error.code).toBe(-32602);
    expect(error.data).toMatchObject({ issues: [{ path: expect.any(Array) as unknown }] });
  });
});

describe('trigger_refund', () => {
  it('processes a refund and reduces the balance', async () => {
    const result = await callTool('trigger_refund', {
      customer_id: 'CUST-00001',
      amount: 75.5,
      reason: `  ${REASON}  `,
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      customerId: 'CUST-00001',
      amount: 75.5,
      currency: 'USD',
      reason: REASON,
      status: 'processed',
      remainingRefundableBalance: 424.5,
    });

    const record = await callTool('get_customer_record', { customer_id: 'CUST-00001' });
    expect(record.structuredContent).toMatchObject({ refundableBalance: 424.5 });
  });

  it.each([
    [
      'a suspended account',
      { customer_id: 'CUST-00002', amount: 10, reason: REASON },
      'Customer CUST-00002 is suspended. Refunds can only be issued to active accounts.',
    ],
    [
      'a zero balance',
      { customer_id: 'CUST-00003', amount: 10, reason: REASON },
      'Refund amount 10.00 USD exceeds the refundable balance of 0.00 USD for customer CUST-00003.',
    ],
    [
      'an amount above the balance',
      { customer_id: 'CUST-00001', amount: 500.01, reason: REASON },
      'Refund amount 500.01 USD exceeds the refundable balance of 500.00 USD for customer CUST-00001.',
    ],
    [
      'an unknown customer',
      { customer_id: 'CUST-12345', amount: 10, reason: REASON },
      'Customer CUST-12345 was not found.',
    ],
  ])('returns isError for %s', async (_label, args, message) => {
    const result = await callTool('trigger_refund', args);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(message);
  });

  it.each([
    ['a zero amount', { amount: 0 }],
    ['a negative amount', { amount: -1 }],
    ['three decimal places', { amount: 10.001 }],
    ['an amount above 1,000,000', { amount: 1_000_000.01 }],
    ['a numeric string amount', { amount: '10.00' }],
    ['a short reason', { reason: 'too short' }],
    ['a whitespace-only reason', { reason: '              ' }],
    ['a reason over 500 characters', { reason: 'x'.repeat(501) }],
    ['an extra property', { currency: 'USD' }],
  ])('rejects %s with -32602', async (_label, override) => {
    const error = await captureMcpError(() =>
      callTool('trigger_refund', {
        customer_id: 'CUST-00001',
        amount: 10,
        reason: REASON,
        ...override,
      }),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('Invalid arguments for tool trigger_refund');
  });
});

describe('protocol errors', () => {
  it('rejects an unknown tool with -32602', async () => {
    const error = await captureMcpError(() => callTool('delete_customer', {}));

    expect(error.code).toBe(-32602);
    expect(error.message).toContain('Unknown tool: delete_customer');
  });

  it('rejects a missing arguments object with -32602', async () => {
    const error = await captureMcpError(() => client.callTool({ name: 'get_customer_record' }));

    expect(error.code).toBe(-32602);
  });

  it.each([
    ['null', null],
    ['an array', []],
  ])('rejects %s arguments with -32602', async (_label, args) => {
    const error = await captureMcpError(() =>
      client.request(
        { method: 'tools/call', params: { name: 'get_customer_record', arguments: args } },
        CallToolResultSchema,
      ),
    );

    expect(error.code).toBe(-32602);
  });

  it('rejects an unknown method with -32601', async () => {
    const error = await captureMcpError(() =>
      client.request({ method: 'customers/delete' }, CallToolResultSchema),
    );

    expect(error.code).toBe(ErrorCode.MethodNotFound);
  });
});
