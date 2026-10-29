# customer-refund-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes two tools over the stdio transport:

- `get_customer_record` returns a customer record by ID.
- `trigger_refund` issues a refund to a customer and reduces their refundable balance.

Every tool argument is validated with a strict schema before any business logic runs. Invalid input is rejected with a JSON-RPC protocol error, business-rule failures are returned as tool execution errors, and stdout carries nothing except JSON-RPC messages.

The server ships with an in-memory customer store and a small set of seed customers. The store sits behind a `CustomerRepository` interface so it can be replaced with a real data store.

## Requirements

- Node.js 20.19 or later (Node.js 22 is recommended; see `.nvmrc`)
- npm

## Install and build

```sh
git clone <repository-url> customer-refund-mcp-server
cd customer-refund-mcp-server
npm ci
npm run build
```

The build writes the server to `dist/index.js`.

## Running the server

```sh
node dist/index.js
```

The server reads JSON-RPC messages from stdin, writes responses to stdout and writes logs to stderr. It does not print anything to stdout until a client sends a request.

Set `LOG_LEVEL` to `debug`, `info`, `warn` or `error` to control log output. The default is `info`, and unrecognized values fall back to `info`.

```sh
LOG_LEVEL=debug node dist/index.js
```

The server shuts down cleanly with exit code 0 on `SIGINT`, `SIGTERM` or when stdin closes. An uncaught exception or unhandled promise rejection is logged to stderr and the process exits with code 1.

## MCP client configuration

Point the client at `node` and the absolute path of the built entry point. Do not use `npm start`, `npx` or `tsx` in a client configuration: npm and other wrappers print their own lines to stdout, which corrupts the JSON-RPC stream.

### Claude Desktop

Add the server to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "customer-refund": {
      "command": "node",
      "args": ["/absolute/path/to/customer-refund-mcp-server/dist/index.js"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

On Windows, use an escaped path such as `"C:\\Users\\you\\customer-refund-mcp-server\\dist\\index.js"`. Restart the client after editing the file. Any other MCP client that launches stdio servers takes the same `command` and `args`.

## Tool reference

### `get_customer_record`

Returns the customer record for a customer ID.

Input:

| Field         | Type   | Rules                     |
| ------------- | ------ | ------------------------- |
| `customer_id` | string | Must match `^CUST-\d{5}$` |

Output (`structuredContent`, also serialized as JSON in a text content block):

| Field               | Type   | Description                       |
| ------------------- | ------ | --------------------------------- |
| `customerId`        | string | Customer ID                       |
| `name`              | string | Customer name                     |
| `email`             | string | Customer email address            |
| `status`            | string | `active` or `suspended`           |
| `currency`          | string | ISO 4217 currency code            |
| `refundableBalance` | number | Amount that can still be refunded |
| `createdAt`         | string | Account creation time (ISO 8601)  |

Example result:

```json
{
  "content": [{ "type": "text", "text": "{\"customerId\":\"CUST-00001\", ...}" }],
  "structuredContent": {
    "customerId": "CUST-00001",
    "name": "Alice Johnson",
    "email": "alice.johnson@example.com",
    "status": "active",
    "currency": "USD",
    "refundableBalance": 500,
    "createdAt": "2024-01-15T09:30:00.000Z"
  }
}
```

### `trigger_refund`

Issues a refund to an active customer and reduces their refundable balance.

Input:

| Field         | Type   | Rules                                                                                  |
| ------------- | ------ | -------------------------------------------------------------------------------------- |
| `customer_id` | string | Must match `^CUST-\d{5}$`                                                              |
| `amount`      | number | Greater than 0, at most 1,000,000, at most 2 decimal places. Strings are not accepted. |
| `reason`      | string | 10 to 500 characters after trimming leading and trailing whitespace                    |

Output (`structuredContent`, also serialized as JSON in a text content block):

| Field                        | Type   | Description                          |
| ---------------------------- | ------ | ------------------------------------ |
| `refundId`                   | string | Random UUID for the refund           |
| `customerId`                 | string | Customer ID                          |
| `amount`                     | number | Refunded amount                      |
| `currency`                   | string | Currency of the customer account     |
| `reason`                     | string | Trimmed reason                       |
| `status`                     | string | Always `processed`                   |
| `processedAt`                | string | Processing time (ISO 8601)           |
| `remainingRefundableBalance` | number | Refundable balance after this refund |

All money arithmetic is done in integer cents, so repeated refunds do not accumulate floating-point error. Concurrent refunds against the same customer cannot overdraw the balance: the balance update only succeeds if the balance has not changed since it was read, and otherwise the refund is re-evaluated against the new balance.

### Seed data

| Customer ID  | Status    | Refundable balance |
| ------------ | --------- | ------------------ |
| `CUST-00001` | active    | 500.00 USD         |
| `CUST-00002` | suspended | 200.00 USD         |
| `CUST-00003` | active    | 0.00 USD           |

The store is in memory, so balances reset every time the server starts.

## Validation rules

Arguments are validated with [Zod](https://zod.dev). Every input object is strict and no value is coerced from one type to another.

- The arguments object must be present and must be a JSON object. `null`, arrays and other types are rejected.
- Properties that are not part of the schema are rejected.
- `customer_id` must be exactly `CUST-` followed by five digits. Lowercase prefixes, other digit counts, empty strings and surrounding whitespace are rejected.
- `amount` must be a JSON number. Numeric strings such as `"10.00"` are rejected, as are `0`, negative numbers, values above 1,000,000 and values with more than two decimal places such as `10.001`.
- `reason` is trimmed before its length is checked, so a reason made only of whitespace is rejected.

The `inputSchema` and `outputSchema` published by `tools/list` are generated from the same Zod schemas that the server enforces, so the advertised schemas cannot drift from the enforced ones. Both include `"additionalProperties": false`. Two rules cannot be expressed in JSON Schema and are only enforced by the server: the two-decimal-place limit on `amount` and the trimming of `reason` before its length is checked.

## Error handling

| Situation                                                          | Response                      | Code     |
| ------------------------------------------------------------------ | ----------------------------- | -------- |
| Invalid, missing or extra tool arguments                           | JSON-RPC error                | `-32602` |
| Unknown tool name                                                  | JSON-RPC error                | `-32602` |
| Unknown method                                                     | JSON-RPC error (SDK)          | `-32601` |
| Unexpected internal failure                                        | JSON-RPC error                | `-32603` |
| Customer not found, account not active, amount exceeds the balance | Tool result with `isError`    | none     |
| Invalid JSON or a message that is not JSON-RPC                     | Logged to stderr, no response | none     |

Argument validation errors carry the individual problems in `error.data`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32602,
    "message": "MCP error -32602: Invalid arguments for tool trigger_refund",
    "data": {
      "issues": [
        {
          "path": ["amount"],
          "code": "custom",
          "message": "amount must have at most 2 decimal places"
        }
      ]
    }
  }
}
```

Internal failures return the generic message `Internal error`. The underlying error, including its stack trace, is written to stderr and never sent to the client.

Business-rule failures are valid requests that the server cannot carry out. They are returned as normal tool results so the calling model can read the explanation and react to it:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Customer CUST-00002 is suspended. Refunds can only be issued to active accounts."
    }
  ],
  "isError": true
}
```

The MCP specification recommends reporting input-validation failures as tool execution errors, that is, as a tool result with `isError: true`, so that a model can see what went wrong and correct its arguments. This server deliberately departs from that recommendation and rejects invalid arguments with JSON-RPC error `-32602` (Invalid params). Refunds move money, and a strict contract is easier to reason about: a call with invalid arguments never reaches the tool at all, and clients, gateways and audit logs can tell a rejected request apart from a request that ran and failed. Business-rule failures still follow the specification and are reported as tool execution errors.

### Notes on SDK behavior

Some responses are produced by the MCP TypeScript SDK rather than by this server:

- The SDK prefixes error messages with `MCP error <code>: `, so the unknown-tool message on the wire is `MCP error -32602: Unknown tool: <name>`.
- When `arguments` is present but is not a JSON object (for example `null` or an array), the SDK rejects the request with `-32602` before the tool schema runs. That response has no `error.data`.
- When a line on stdin is not valid JSON, or is valid JSON but not a JSON-RPC message, the SDK stdio transport reports it to the server's error handler and does not send a response, so `-32700` (Parse error) and `-32600` (Invalid Request) are never sent. The server logs the problem to stderr and keeps running.
- When a request's `params` do not match the shape the SDK expects for that method (for example a `tools/call` whose `name` is not a string), the SDK responds with `-32603` and its own validation message.

## Stdio isolation

On the stdio transport, stdout is the protocol channel. A single stray line on stdout breaks the client's JSON-RPC parser, so the server keeps stdout reserved for JSON-RPC messages:

- All logging goes through a small structured logger that writes one JSON object per line to stderr.
- The entry point rebinds `console.log`, `console.info` and `console.debug` to stderr before it loads any other module. Modules are loaded with dynamic `import()` after the rebinding, so even code that runs while a module is being loaded cannot write to stdout.
- ESLint enforces `no-console` and forbids `process.stdout` throughout the codebase. The only exception is the console rebinding in `src/index.ts`.
- The integration tests spawn the built server and fail if any stdout line is not a JSON-RPC 2.0 message, including after malformed input and after code calls `console.log`.
- Client configurations run `node dist/index.js` directly, because npm and other wrappers write their own output to stdout.

## Development

| Script                  | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run build`         | Compile TypeScript to `dist/`                                    |
| `npm start`             | Run the built server (for local use only, not in client configs) |
| `npm run dev`           | Run the server from source with `tsx`                            |
| `npm run typecheck`     | Type-check sources and tests                                     |
| `npm run lint`          | Run ESLint with zero warnings allowed                            |
| `npm run format`        | Format files with Prettier                                       |
| `npm run format:check`  | Check formatting                                                 |
| `npm test`              | Build, then run unit and integration tests                       |
| `npm run test:coverage` | Build, then run tests with coverage thresholds                   |
| `npm run inspector`     | Open the MCP Inspector against `dist/index.js`                   |

The integration tests start `dist/index.js` as a child process, so `npm test` builds first. The MCP Inspector requires Node.js 22.19 or later. See [TESTING.md](TESTING.md) for manual test cases and Inspector instructions.

Project layout:

```text
src/
  index.ts                     entry point: stdout guard, transport, signal handling
  server.ts                    server factory, request handlers, error mapping
  logger.ts                    stderr-only structured logger
  schemas.ts                   Zod schemas and JSON Schema export
  errors.ts                    Zod-to-McpError conversion
  money.ts                     integer-cent conversions
  tools/tool.ts                tool contract and result builders
  tools/getCustomerRecord.ts   get_customer_record
  tools/triggerRefund.ts       trigger_refund
  data/customerRepository.ts   repository interface and in-memory store
test/
  unit/                        schema, tool, logger and in-process server tests
  integration/                 tests against the built server over stdio
```

## License

[MIT](LICENSE)
