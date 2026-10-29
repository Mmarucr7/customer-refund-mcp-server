import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { z } from 'zod';

export const SERVER_ENTRY = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

export const jsonRpcMessageSchema = z.looseObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  result: z.looseObject({}).optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .strict()
    .optional(),
});

export type JsonRpcMessage = z.infer<typeof jsonRpcMessageSchema>;

export interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ServerProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdoutLines: string[];
  readonly stderrLines: string[];
  send(line: string): void;
  request(id: number, method: string, params?: Record<string, unknown>): Promise<JsonRpcMessage>;
  initialize(): Promise<void>;
  waitForStderr(fragment: string): Promise<string>;
  waitForExit(): Promise<ExitResult>;
}

const WAIT_OPTIONS = { timeout: 10_000, interval: 20 };

function collectLines(stream: NodeJS.ReadableStream, lines: string[]): void {
  createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) => {
    lines.push(line);
  });
}

function findResponse(lines: readonly string[], id: number): JsonRpcMessage | undefined {
  return lines
    .map((line) => jsonRpcMessageSchema.safeParse(JSON.parse(line)))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .find((message) => message.id === id);
}

export function startServerProcess(
  args: readonly string[] = [SERVER_ENTRY],
  env: Readonly<Record<string, string>> = {},
): ServerProcess {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, LOG_LEVEL: 'debug', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  collectLines(child.stdout, stdoutLines);
  collectLines(child.stderr, stderrLines);
  const exit = new Promise<ExitResult>((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  const send = (line: string): void => {
    child.stdin.write(`${line}\n`);
  };

  const request = async (
    id: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcMessage> => {
    send(
      JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }),
    );
    return vi.waitFor(() => {
      const response = findResponse(stdoutLines, id);
      if (response === undefined) {
        throw new Error(`No response for request ${String(id)} yet`);
      }
      return response;
    }, WAIT_OPTIONS);
  };

  return {
    child,
    stdoutLines,
    stderrLines,
    send,
    request,
    initialize: async () => {
      await request(0, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'integration-test', version: '1.0.0' },
      });
      send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    },
    waitForStderr: (fragment) =>
      vi.waitFor(() => {
        const line = stderrLines.find((candidate) => candidate.includes(fragment));
        if (line === undefined) {
          throw new Error(`stderr does not contain ${fragment} yet`);
        }
        return line;
      }, WAIT_OPTIONS),
    waitForExit: () => exit,
  };
}
