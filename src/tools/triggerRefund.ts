import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Customer, CustomerRepository } from '../data/customerRepository.js';
import { formatCents, fromCents, toCents } from '../money.js';
import {
  refundResultSchema,
  triggerRefundInputSchema,
  type RefundResult,
  type TriggerRefundInput,
} from '../schemas.js';
import { customerNotFoundMessage } from './getCustomerRecord.js';
import { businessErrorResult, structuredResult, type ToolSpec } from './tool.js';

function findRefundRuleViolation(customer: Customer, amountCents: number): string | undefined {
  if (customer.status !== 'active') {
    return `Customer ${customer.customerId} is ${customer.status}. Refunds can only be issued to active accounts.`;
  }
  if (amountCents > customer.refundableBalanceCents) {
    return `Refund amount ${formatCents(amountCents, customer.currency)} exceeds the refundable balance of ${formatCents(customer.refundableBalanceCents, customer.currency)} for customer ${customer.customerId}.`;
  }
  return undefined;
}

function buildRefundResult(
  customer: Customer,
  input: TriggerRefundInput,
  amountCents: number,
  remainingCents: number,
): RefundResult {
  return {
    refundId: randomUUID(),
    customerId: customer.customerId,
    amount: fromCents(amountCents),
    currency: customer.currency,
    reason: input.reason,
    status: 'processed',
    processedAt: new Date().toISOString(),
    remainingRefundableBalance: fromCents(remainingCents),
  };
}

async function processRefund(
  repository: CustomerRepository,
  input: TriggerRefundInput,
  amountCents: number,
): Promise<CallToolResult> {
  const customer = await repository.findById(input.customer_id);
  if (customer === undefined) {
    return businessErrorResult(customerNotFoundMessage(input.customer_id));
  }
  const violation = findRefundRuleViolation(customer, amountCents);
  if (violation !== undefined) {
    return businessErrorResult(violation);
  }
  const remainingCents = customer.refundableBalanceCents - amountCents;
  const updated = await repository.updateRefundableBalance(
    customer.customerId,
    customer.refundableBalanceCents,
    remainingCents,
  );
  if (!updated) {
    return processRefund(repository, input, amountCents);
  }
  return structuredResult(buildRefundResult(customer, input, amountCents, remainingCents));
}

export function createTriggerRefundTool(
  repository: CustomerRepository,
): ToolSpec<TriggerRefundInput> {
  return {
    name: 'trigger_refund',
    description:
      'Issues a refund to an active customer and reduces their refundable balance. The amount must be greater than 0, at most 1,000,000, have at most 2 decimal places, and not exceed the refundable balance. The reason must be 10 to 500 characters after trimming.',
    inputSchema: triggerRefundInputSchema,
    outputSchema: refundResultSchema,
    execute: (input) => processRefund(repository, input, toCents(input.amount)),
  };
}
