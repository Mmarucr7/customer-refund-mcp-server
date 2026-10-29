import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { internalError, parseToolArguments, unknownToolError } from '../../src/errors.js';
import {
  CUSTOMER_ID_PATTERN,
  customerRecordSchema,
  getCustomerRecordInputSchema,
  refundResultSchema,
  toToolJsonSchema,
  triggerRefundInputSchema,
} from '../../src/schemas.js';

const VALID_REASON = 'Duplicate charge on invoice';
const validRefund = { customer_id: 'CUST-00001', amount: 25.5, reason: VALID_REASON };

const errorDataSchema = z
  .object({
    issues: z.array(
      z
        .object({
          path: z.array(z.union([z.string(), z.number()])),
          code: z.string(),
          message: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

function summarizeIssues(error: McpError): string[] {
  return errorDataSchema
    .parse(error.data)
    .issues.map((issue) => `${issue.path.join('.')}:${issue.code}`)
    .sort();
}

function captureMcpError(action: () => unknown): McpError {
  try {
    action();
  } catch (error) {
    if (error instanceof McpError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an McpError to be thrown');
}

describe('CUSTOMER_ID_PATTERN', () => {
  it.each(['CUST-00001', 'CUST-99999', 'CUST-12345'])('accepts %s', (value) => {
    expect(CUSTOMER_ID_PATTERN.test(value)).toBe(true);
  });

  it.each(['cust-00001', 'CUST-0001', 'CUST-000001', ' CUST-00001', 'CUST-00001 ', 'CUST-0000a'])(
    'rejects %j',
    (value) => {
      expect(CUSTOMER_ID_PATTERN.test(value)).toBe(false);
    },
  );
});

describe('getCustomerRecordInputSchema', () => {
  it('accepts a valid customer ID', () => {
    expect(getCustomerRecordInputSchema.parse({ customer_id: 'CUST-00001' })).toEqual({
      customer_id: 'CUST-00001',
    });
  });

  it.each([
    ['missing arguments', undefined],
    ['null', null],
    ['an array', [{ customer_id: 'CUST-00001' }]],
    ['a string', 'CUST-00001'],
    ['an empty object', {}],
    ['extra properties', { customer_id: 'CUST-00001', include_history: true }],
    ['a numeric customer_id', { customer_id: 1 }],
    ['a null customer_id', { customer_id: null }],
    ['an empty customer_id', { customer_id: '' }],
    ['a lowercase prefix', { customer_id: 'cust-00001' }],
    ['four digits', { customer_id: 'CUST-0001' }],
    ['six digits', { customer_id: 'CUST-000001' }],
    ['leading whitespace', { customer_id: ' CUST-00001' }],
    ['trailing whitespace', { customer_id: 'CUST-00001 ' }],
    ['a trailing newline', { customer_id: 'CUST-00001\n' }],
  ])('rejects %s', (_label, input) => {
    expect(getCustomerRecordInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('triggerRefundInputSchema', () => {
  it('accepts a valid refund request', () => {
    expect(triggerRefundInputSchema.parse(validRefund)).toEqual(validRefund);
  });

  it.each([0.01, 0.07, 0.29, 1.15, 19.99, 100, 999999.99, 1_000_000])(
    'accepts the amount %d',
    (amount) => {
      expect(triggerRefundInputSchema.safeParse({ ...validRefund, amount }).success).toBe(true);
    },
  );

  it.each([
    ['zero', 0],
    ['a negative number', -5],
    ['a negative cent', -0.01],
    ['three decimal places', 10.001],
    ['a fraction of a cent', 0.001],
    ['half a cent', 0.015],
    ['a value above the maximum', 1_000_000.01],
    ['a large value', 5_000_000],
    ['a numeric string', '25.50'],
    ['an integer string', '25'],
    ['null', null],
    ['a boolean', true],
    ['an array', [25]],
    ['an object', { value: 25 }],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects an amount that is %s', (_label, amount) => {
    expect(triggerRefundInputSchema.safeParse({ ...validRefund, amount }).success).toBe(false);
  });

  it('accepts a reason of exactly 10 characters after trimming', () => {
    const result = triggerRefundInputSchema.parse({ ...validRefund, reason: '   abcdefghij   ' });
    expect(result.reason).toBe('abcdefghij');
  });

  it('accepts a reason of exactly 500 characters after trimming', () => {
    const reason = 'r'.repeat(500);
    const result = triggerRefundInputSchema.parse({ ...validRefund, reason: `  ${reason}\n` });
    expect(result.reason).toBe(reason);
  });

  it('returns the trimmed reason', () => {
    const result = triggerRefundInputSchema.parse({ ...validRefund, reason: `\t${VALID_REASON} ` });
    expect(result.reason).toBe(VALID_REASON);
  });

  it.each([
    ['9 characters', 'abcdefghi'],
    ['9 characters padded with whitespace', '    abcdefghi    '],
    ['501 characters', 'r'.repeat(501)],
    ['an empty string', ''],
    ['only spaces', '               '],
    ['only mixed whitespace', ' \t\n\r \t\n\r \t\n '],
    ['a number', 1234567890],
    ['null', null],
  ])('rejects a reason that is %s', (_label, reason) => {
    expect(triggerRefundInputSchema.safeParse({ ...validRefund, reason }).success).toBe(false);
  });

  it.each([
    ['missing arguments', undefined],
    ['null', null],
    ['an array', [validRefund]],
    ['an empty object', {}],
    ['a missing customer_id', { amount: 10, reason: VALID_REASON }],
    ['a missing amount', { customer_id: 'CUST-00001', reason: VALID_REASON }],
    ['a missing reason', { customer_id: 'CUST-00001', amount: 10 }],
    ['extra properties', { ...validRefund, currency: 'USD' }],
    ['a lowercase customer_id', { ...validRefund, customer_id: 'cust-00001' }],
    ['a customer_id with the wrong digit count', { ...validRefund, customer_id: 'CUST-123' }],
    ['a customer_id with surrounding whitespace', { ...validRefund, customer_id: ' CUST-00001 ' }],
    ['an empty customer_id', { ...validRefund, customer_id: '' }],
  ])('rejects %s', (_label, input) => {
    expect(triggerRefundInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('parseToolArguments', () => {
  it('returns the parsed value for valid input', () => {
    expect(
      parseToolArguments('get_customer_record', getCustomerRecordInputSchema, {
        customer_id: 'CUST-00002',
      }),
    ).toEqual({ customer_id: 'CUST-00002' });
  });

  it('throws InvalidParams with structured issues for invalid input', () => {
    const error = captureMcpError(() =>
      parseToolArguments('trigger_refund', triggerRefundInputSchema, {
        customer_id: 'cust-00001',
        amount: '10',
        reason: VALID_REASON,
        extra: true,
      }),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.code).toBe(-32602);
    expect(error.message).toContain('Invalid arguments for tool trigger_refund');
    expect(summarizeIssues(error)).toEqual([
      ':unrecognized_keys',
      'amount:invalid_type',
      'customer_id:invalid_format',
    ]);
  });

  it('reports a root-level issue when arguments are missing', () => {
    const error = captureMcpError(() =>
      parseToolArguments('get_customer_record', getCustomerRecordInputSchema, undefined),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(summarizeIssues(error)).toEqual([':invalid_type']);
  });
});

describe('error factories', () => {
  it('creates an InvalidParams error for an unknown tool', () => {
    const error = unknownToolError('delete_customer');
    expect(error.code).toBe(-32602);
    expect(error.message).toContain('Unknown tool: delete_customer');
    expect(error.data).toBeUndefined();
  });

  it('creates a generic InternalError', () => {
    const error = internalError();
    expect(error.code).toBe(-32603);
    expect(error.message).toContain('Internal error');
    expect(error.data).toBeUndefined();
  });
});

describe('toToolJsonSchema', () => {
  it('publishes the get_customer_record input schema', () => {
    expect(toToolJsonSchema(getCustomerRecordInputSchema, 'input')).toMatchObject({
      type: 'object',
      properties: {
        customer_id: { type: 'string', pattern: CUSTOMER_ID_PATTERN.source },
      },
      required: ['customer_id'],
      additionalProperties: false,
    });
  });

  it('publishes the trigger_refund input schema', () => {
    expect(toToolJsonSchema(triggerRefundInputSchema, 'input')).toMatchObject({
      type: 'object',
      properties: {
        customer_id: { type: 'string', pattern: CUSTOMER_ID_PATTERN.source },
        amount: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
        reason: { type: 'string', minLength: 10, maxLength: 500 },
      },
      required: ['customer_id', 'amount', 'reason'],
      additionalProperties: false,
    });
  });

  it.each([
    ['customer record', customerRecordSchema],
    ['refund result', refundResultSchema],
  ])('publishes the %s output schema as a closed object', (_label, schema) => {
    expect(toToolJsonSchema(schema, 'output')).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
  });
});
