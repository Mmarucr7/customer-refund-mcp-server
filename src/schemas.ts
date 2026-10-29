import { ToolSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const CUSTOMER_ID_PATTERN = /^CUST-\d{5}$/;

const MAX_REFUND_AMOUNT = 1_000_000;
const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;
const CENTS_PER_UNIT = 100;
const DECIMAL_TOLERANCE_FACTOR = 4;

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaled = value * CENTS_PER_UNIT;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * DECIMAL_TOLERANCE_FACTOR;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

const customerIdSchema = z
  .string()
  .regex(CUSTOMER_ID_PATTERN, 'customer_id must match the format CUST-NNNNN (five digits)');

const refundAmountSchema = z
  .number()
  .positive('amount must be greater than 0')
  .max(MAX_REFUND_AMOUNT, `amount must not exceed ${String(MAX_REFUND_AMOUNT)}`)
  .refine(hasAtMostTwoDecimalPlaces, 'amount must have at most 2 decimal places');

const refundReasonSchema = z
  .string()
  .trim()
  .min(
    MIN_REASON_LENGTH,
    `reason must be at least ${String(MIN_REASON_LENGTH)} characters after trimming whitespace`,
  )
  .max(
    MAX_REASON_LENGTH,
    `reason must be at most ${String(MAX_REASON_LENGTH)} characters after trimming whitespace`,
  );

export const getCustomerRecordInputSchema = z
  .object({
    customer_id: customerIdSchema,
  })
  .strict();

export const triggerRefundInputSchema = z
  .object({
    customer_id: customerIdSchema,
    amount: refundAmountSchema,
    reason: refundReasonSchema,
  })
  .strict();

const customerStatusSchema = z.enum(['active', 'suspended']);

export const customerRecordSchema = z
  .object({
    customerId: z.string(),
    name: z.string(),
    email: z.email(),
    status: customerStatusSchema,
    currency: z.string().length(3),
    refundableBalance: z.number().nonnegative(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const refundResultSchema = z
  .object({
    refundId: z.uuid(),
    customerId: z.string(),
    amount: z.number().positive(),
    currency: z.string().length(3),
    reason: z.string(),
    status: z.literal('processed'),
    processedAt: z.iso.datetime(),
    remainingRefundableBalance: z.number().nonnegative(),
  })
  .strict();

export type GetCustomerRecordInput = z.output<typeof getCustomerRecordInputSchema>;
export type TriggerRefundInput = z.output<typeof triggerRefundInputSchema>;
export type CustomerStatus = z.output<typeof customerStatusSchema>;
export type CustomerRecord = z.output<typeof customerRecordSchema>;
export type RefundResult = z.output<typeof refundResultSchema>;

type ToolJsonSchema = Tool['inputSchema'];

export function toToolJsonSchema(schema: z.ZodType, io: 'input' | 'output'): ToolJsonSchema {
  return ToolSchema.shape.inputSchema.parse(z.toJSONSchema(schema, { io }));
}
