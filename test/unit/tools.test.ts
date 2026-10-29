import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInMemoryCustomerRepository,
  type Customer,
  type CustomerRepository,
} from '../../src/data/customerRepository.js';
import {
  customerRecordSchema,
  refundResultSchema,
  triggerRefundInputSchema,
} from '../../src/schemas.js';
import { createGetCustomerRecordTool } from '../../src/tools/getCustomerRecord.js';
import { createTriggerRefundTool } from '../../src/tools/triggerRefund.js';

const REASON = 'Customer reported a duplicate charge';

function textOf(result: CallToolResult): string {
  const [block] = result.content;
  if (block?.type !== 'text') {
    throw new Error('Expected a text content block');
  }
  return block.text;
}

describe('get_customer_record', () => {
  let repository: CustomerRepository;

  beforeEach(() => {
    repository = createInMemoryCustomerRepository();
  });

  it('returns the seeded record for CUST-00001', async () => {
    const result = await createGetCustomerRecordTool(repository).execute({
      customer_id: 'CUST-00001',
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      customerId: 'CUST-00001',
      name: 'Alice Johnson',
      email: 'alice.johnson@example.com',
      status: 'active',
      currency: 'USD',
      refundableBalance: 500,
      createdAt: '2024-01-15T09:30:00.000Z',
    });
    expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  });

  it.each([
    ['CUST-00002', 'suspended', 200],
    ['CUST-00003', 'active', 0],
  ])('returns %s with status %s and balance %d', async (customerId, status, balance) => {
    const result = await createGetCustomerRecordTool(repository).execute({
      customer_id: customerId,
    });

    expect(result.structuredContent).toMatchObject({
      customerId,
      status,
      refundableBalance: balance,
    });
  });

  it('returns structured content that satisfies the output schema', async () => {
    const result = await createGetCustomerRecordTool(repository).execute({
      customer_id: 'CUST-00002',
    });

    expect(customerRecordSchema.safeParse(result.structuredContent).success).toBe(true);
  });

  it('returns an execution error when the customer does not exist', async () => {
    const result = await createGetCustomerRecordTool(repository).execute({
      customer_id: 'CUST-99999',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(textOf(result)).toBe('Customer CUST-99999 was not found.');
  });
});

describe('trigger_refund', () => {
  let repository: CustomerRepository;

  beforeEach(() => {
    repository = createInMemoryCustomerRepository();
  });

  async function refund(customerId: string, amount: number): Promise<CallToolResult> {
    return createTriggerRefundTool(repository).execute({
      customer_id: customerId,
      amount,
      reason: REASON,
    });
  }

  async function balanceOf(customerId: string): Promise<number | undefined> {
    return (await repository.findById(customerId))?.refundableBalanceCents;
  }

  it('processes a refund and reduces the refundable balance', async () => {
    const result = await refund('CUST-00001', 120.25);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      customerId: 'CUST-00001',
      amount: 120.25,
      currency: 'USD',
      reason: REASON,
      status: 'processed',
      remainingRefundableBalance: 379.75,
    });
    expect(refundResultSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
    expect(await balanceOf('CUST-00001')).toBe(37_975);
  });

  it('returns a unique refund ID and a current timestamp', async () => {
    const before = Date.now();
    const first = refundResultSchema.parse((await refund('CUST-00001', 1)).structuredContent);
    const second = refundResultSchema.parse((await refund('CUST-00001', 1)).structuredContent);

    expect(first.refundId).not.toBe(second.refundId);
    expect(Date.parse(first.processedAt)).toBeGreaterThanOrEqual(before);
  });

  it('stores the trimmed reason', async () => {
    const input = triggerRefundInputSchema.parse({
      customer_id: 'CUST-00001',
      amount: 5,
      reason: `   ${REASON}   `,
    });
    const result = await createTriggerRefundTool(repository).execute(input);

    expect(result.structuredContent).toMatchObject({ reason: REASON });
  });

  it('allows refunding the entire refundable balance', async () => {
    const result = await refund('CUST-00001', 500);

    expect(result.structuredContent).toMatchObject({ remainingRefundableBalance: 0 });
    expect(await balanceOf('CUST-00001')).toBe(0);
  });

  it('uses integer cents so repeated small refunds do not drift', async () => {
    await refund('CUST-00001', 0.1);
    await refund('CUST-00001', 0.2);
    const result = await refund('CUST-00001', 0.07);

    expect(result.structuredContent).toMatchObject({ remainingRefundableBalance: 499.63 });
    expect(await balanceOf('CUST-00001')).toBe(49_963);
  });

  it('rejects a refund that exceeds the remaining balance after earlier refunds', async () => {
    await refund('CUST-00001', 400);
    const result = await refund('CUST-00001', 100.01);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Refund amount 100.01 USD exceeds the refundable balance of 100.00 USD for customer CUST-00001.',
    );
    expect(await balanceOf('CUST-00001')).toBe(10_000);
  });

  it('returns an execution error when the customer does not exist', async () => {
    const result = await refund('CUST-99999', 10);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Customer CUST-99999 was not found.');
  });

  it('returns an execution error when the account is not active', async () => {
    const result = await refund('CUST-00002', 10);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Customer CUST-00002 is suspended. Refunds can only be issued to active accounts.',
    );
    expect(await balanceOf('CUST-00002')).toBe(20_000);
  });

  it('returns an execution error when the amount exceeds the refundable balance', async () => {
    const result = await refund('CUST-00001', 500.01);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(textOf(result)).toBe(
      'Refund amount 500.01 USD exceeds the refundable balance of 500.00 USD for customer CUST-00001.',
    );
    expect(await balanceOf('CUST-00001')).toBe(50_000);
  });

  it('returns an execution error when the refundable balance is zero', async () => {
    const result = await refund('CUST-00003', 0.01);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Refund amount 0.01 USD exceeds the refundable balance of 0.00 USD for customer CUST-00003.',
    );
  });

  it('never overdraws the balance when refunds run concurrently', async () => {
    const results = await Promise.all([
      refund('CUST-00001', 300),
      refund('CUST-00001', 300),
      refund('CUST-00001', 300),
    ]);

    expect(results.filter((result) => result.isError !== true)).toHaveLength(1);
    expect(await balanceOf('CUST-00001')).toBe(20_000);
  });

  it('re-reads the customer when the balance changed before it could be updated', async () => {
    const customer: Customer = {
      customerId: 'CUST-00001',
      name: 'Alice Johnson',
      email: 'alice.johnson@example.com',
      status: 'active',
      currency: 'USD',
      refundableBalanceCents: 50_000,
      createdAt: '2024-01-15T09:30:00.000Z',
    };
    const updateAttempts: number[] = [];
    const contendedRepository: CustomerRepository = {
      findById: () =>
        Promise.resolve({
          ...customer,
          refundableBalanceCents: updateAttempts.length === 0 ? 50_000 : 30_000,
        }),
      updateRefundableBalance: (_customerId, expectedBalanceCents) => {
        updateAttempts.push(expectedBalanceCents);
        return Promise.resolve(updateAttempts.length > 1);
      },
    };

    const result = await createTriggerRefundTool(contendedRepository).execute({
      customer_id: 'CUST-00001',
      amount: 100,
      reason: REASON,
    });

    expect(updateAttempts).toEqual([50_000, 30_000]);
    expect(result.structuredContent).toMatchObject({ remainingRefundableBalance: 200 });
  });
});
