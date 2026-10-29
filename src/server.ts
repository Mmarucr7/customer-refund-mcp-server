import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { CustomerRepository } from './data/customerRepository.js';
import { internalError, parseToolArguments, unknownToolError } from './errors.js';
import type { Logger } from './logger.js';
import { toToolJsonSchema } from './schemas.js';
import { createGetCustomerRecordTool } from './tools/getCustomerRecord.js';
import type { ToolSpec } from './tools/tool.js';
import { createTriggerRefundTool } from './tools/triggerRefund.js';

export const SERVER_NAME = 'customer-refund-mcp-server';
export const SERVER_VERSION = '1.0.0';

export interface ServerDependencies {
  repository: CustomerRepository;
  logger: Logger;
}

const ToolCallRequestSchema = CallToolRequestSchema.extend({
  params: CallToolRequestSchema.shape.params.extend({ arguments: z.unknown().optional() }),
});

interface RegisteredTool {
  readonly definition: Tool;
  call(rawArguments: unknown): Promise<CallToolResult>;
}

function registerTool<Input>(spec: ToolSpec<Input>): RegisteredTool {
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      inputSchema: toToolJsonSchema(spec.inputSchema, 'input'),
      outputSchema: toToolJsonSchema(spec.outputSchema, 'output'),
    },
    call: (rawArguments) =>
      spec.execute(parseToolArguments(spec.name, spec.inputSchema, rawArguments)),
  };
}

async function executeTool(
  tool: RegisteredTool,
  rawArguments: unknown,
  logger: Logger,
): Promise<CallToolResult> {
  try {
    const result = await tool.call(rawArguments);
    logger.info('Tool call completed', {
      tool: tool.definition.name,
      isError: result.isError === true,
    });
    return result;
  } catch (error) {
    if (error instanceof McpError) {
      logger.info('Tool call rejected', { tool: tool.definition.name, code: error.code });
      throw error;
    }
    logger.error('Tool call failed', { tool: tool.definition.name, error });
    throw internalError();
  }
}

export function createServer({ repository, logger }: ServerDependencies): Server {
  const tools = new Map(
    [
      registerTool(createGetCustomerRecordTool(repository)),
      registerTool(createTriggerRefundTool(repository)),
    ].map((tool) => [tool.definition.name, tool]),
  );
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools.values()].map((tool) => tool.definition),
  }));

  server.setRequestHandler(ToolCallRequestSchema, async ({ params }) => {
    logger.debug('Tool call received', { tool: params.name });
    const tool = tools.get(params.name);
    if (tool === undefined) {
      logger.info('Unknown tool requested', { tool: params.name });
      throw unknownToolError(params.name);
    }
    return executeTool(tool, params.arguments, logger);
  });

  server.onerror = (error) => {
    logger.warn('Protocol error', { error });
  };

  return server;
}
