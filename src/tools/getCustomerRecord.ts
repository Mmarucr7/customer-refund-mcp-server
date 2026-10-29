import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Customer, CustomerRepository } from '../data/customerRepository.js';
import { fromCents } from '../money.js';
import {
  customerRecordSchema,
  getCustomerRecordInputSchema,
  type CustomerRecord,
  type GetCustomerRecordInput,
} from '../schemas.js';
import { businessErrorResult, structuredResult, type ToolSpec } from './tool.js';

function toCustomerRecord(customer: Customer): CustomerRecord {
  return {
    customerId: customer.customerId,
    name: customer.name,
    email: customer.email,
    status: customer.status,
    currency: customer.currency,
    refundableBalance: fromCents(customer.refundableBalanceCents),
    createdAt: customer.createdAt,
  };
}

export function customerNotFoundMessage(customerId: string): string {
  return `Customer ${customerId} was not found.`;
}

export function createGetCustomerRecordTool(
  repository: CustomerRepository,
): ToolSpec<GetCustomerRecordInput> {
  return {
    name: 'get_customer_record',
    description:
      'Returns the customer record for a customer ID in the format CUST-NNNNN, including account status and refundable balance.',
    inputSchema: getCustomerRecordInputSchema,
    outputSchema: customerRecordSchema,
    execute: async ({ customer_id }): Promise<CallToolResult> => {
      const customer = await repository.findById(customer_id);
      if (customer === undefined) {
        return businessErrorResult(customerNotFoundMessage(customer_id));
      }
      return structuredResult(toCustomerRecord(customer));
    },
  };
}
