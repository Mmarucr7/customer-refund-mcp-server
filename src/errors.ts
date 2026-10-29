import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

interface ValidationIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

function isJsonPathSegment(segment: PropertyKey): segment is string | number {
  return typeof segment !== 'symbol';
}

function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.filter(isJsonPathSegment),
    code: issue.code,
    message: issue.message,
  }));
}

function invalidArgumentsError(toolName: string, error: z.ZodError): McpError {
  return new McpError(ErrorCode.InvalidParams, `Invalid arguments for tool ${toolName}`, {
    issues: toValidationIssues(error),
  });
}

export function unknownToolError(toolName: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
}

export function internalError(): McpError {
  return new McpError(ErrorCode.InternalError, 'Internal error');
}

export function parseToolArguments<Output>(
  toolName: string,
  schema: z.ZodType<Output>,
  rawArguments: unknown,
): Output {
  const result = schema.safeParse(rawArguments);
  if (!result.success) {
    throw invalidArgumentsError(toolName, result.error);
  }
  return result.data;
}
