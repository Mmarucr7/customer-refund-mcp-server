# Manual testing

This document lists manual test cases for the built server. Each case has an ID, a purpose, a command that can be pasted into a POSIX shell (bash or zsh), and the exact output the command produces.

## Before you start

Run every command from the repository root after building:

```sh
npm ci
npm run build
```

Each command pipes three newline-delimited JSON-RPC messages into the server: the `initialize` request (`id` 1), the `notifications/initialized` notification, and the request under test (`id` 2). stderr is discarded with `2>/dev/null`. When stdin reaches end of file the server finishes the pending requests and exits with code 0.

Responses can arrive in any order, so most commands end with `grep '"id":2'` to show only the response to the request under test. Output lines are exactly as the server prints them. Where a value changes on every run, the expected output uses a placeholder:

- `<refund-id>` is a random UUID.
- `<timestamp>` is the current time in ISO 8601 format, for example `2026-01-01T12:00:00.000Z`.

The MCP SDK prefixes JSON-RPC error messages with `MCP error <code>: `. The server's own message follows the prefix.

Every case starts a fresh server, so the seed balances apply each time.

## Successful calls

### TC-01

List the available tools and their published schemas.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"tools":[{"name":"get_customer_record","description":"Returns the customer record for a customer ID in the format CUST-NNNNN, including account status and refundable balance.","inputSchema":{"type":"object","properties":{"customer_id":{"type":"string","pattern":"^CUST-\\d{5}$"}},"required":["customer_id"],"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":false},"outputSchema":{"type":"object","properties":{"customerId":{"type":"string"},"name":{"type":"string"},"email":{"type":"string","format":"email","pattern":"^(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"},"status":{"type":"string","enum":["active","suspended"]},"currency":{"type":"string","minLength":3,"maxLength":3},"refundableBalance":{"type":"number","minimum":0},"createdAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"}},"required":["customerId","name","email","status","currency","refundableBalance","createdAt"],"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":false}},{"name":"trigger_refund","description":"Issues a refund to an active customer and reduces their refundable balance. The amount must be greater than 0, at most 1,000,000, have at most 2 decimal places, and not exceed the refundable balance. The reason must be 10 to 500 characters after trimming.","inputSchema":{"type":"object","properties":{"customer_id":{"type":"string","pattern":"^CUST-\\d{5}$"},"amount":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"reason":{"type":"string","minLength":10,"maxLength":500}},"required":["customer_id","amount","reason"],"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":false},"outputSchema":{"type":"object","properties":{"refundId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|<refund-id>|<refund-id>)$"},"customerId":{"type":"string"},"amount":{"type":"number","exclusiveMinimum":0},"currency":{"type":"string","minLength":3,"maxLength":3},"reason":{"type":"string"},"status":{"type":"string","const":"processed"},"processedAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"},"remainingRefundableBalance":{"type":"number","minimum":0}},"required":["refundId","customerId","amount","currency","reason","status","processedAt","remainingRefundableBalance"],"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":false}}]},"jsonrpc":"2.0","id":2}
```

### TC-02

Fetch an active customer.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-00001"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"{\"customerId\":\"CUST-00001\",\"name\":\"Alice Johnson\",\"email\":\"alice.johnson@example.com\",\"status\":\"active\",\"currency\":\"USD\",\"refundableBalance\":500,\"createdAt\":\"2024-01-15T09:30:00.000Z\"}"}],"structuredContent":{"customerId":"CUST-00001","name":"Alice Johnson","email":"alice.johnson@example.com","status":"active","currency":"USD","refundableBalance":500,"createdAt":"2024-01-15T09:30:00.000Z"}},"jsonrpc":"2.0","id":2}
```

### TC-03

Fetch a suspended customer. Lookups do not depend on account status.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-00002"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"{\"customerId\":\"CUST-00002\",\"name\":\"Bob Martinez\",\"email\":\"bob.martinez@example.com\",\"status\":\"suspended\",\"currency\":\"USD\",\"refundableBalance\":200,\"createdAt\":\"2024-03-02T14:05:00.000Z\"}"}],"structuredContent":{"customerId":"CUST-00002","name":"Bob Martinez","email":"bob.martinez@example.com","status":"suspended","currency":"USD","refundableBalance":200,"createdAt":"2024-03-02T14:05:00.000Z"}},"jsonrpc":"2.0","id":2}
```

### TC-04

Fetch an active customer with a zero refundable balance.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-00003"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"{\"customerId\":\"CUST-00003\",\"name\":\"Carol Nguyen\",\"email\":\"carol.nguyen@example.com\",\"status\":\"active\",\"currency\":\"USD\",\"refundableBalance\":0,\"createdAt\":\"2024-06-20T17:45:00.000Z\"}"}],"structuredContent":{"customerId":"CUST-00003","name":"Carol Nguyen","email":"carol.nguyen@example.com","status":"active","currency":"USD","refundableBalance":0,"createdAt":"2024-06-20T17:45:00.000Z"}},"jsonrpc":"2.0","id":2}
```

### TC-05

Issue a refund to an active customer.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":125.5,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"{\"refundId\":\"<refund-id>\",\"customerId\":\"CUST-00001\",\"amount\":125.5,\"currency\":\"USD\",\"reason\":\"Duplicate charge on order 1042\",\"status\":\"processed\",\"processedAt\":\"<timestamp>\",\"remainingRefundableBalance\":374.5}"}],"structuredContent":{"refundId":"<refund-id>","customerId":"CUST-00001","amount":125.5,"currency":"USD","reason":"Duplicate charge on order 1042","status":"processed","processedAt":"<timestamp>","remainingRefundableBalance":374.5}},"jsonrpc":"2.0","id":2}
```

`<refund-id>` is a random UUID and `<timestamp>` is the current time in ISO 8601 format.

### TC-06

Refund the entire refundable balance.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":500,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"{\"refundId\":\"<refund-id>\",\"customerId\":\"CUST-00001\",\"amount\":500,\"currency\":\"USD\",\"reason\":\"Duplicate charge on order 1042\",\"status\":\"processed\",\"processedAt\":\"<timestamp>\",\"remainingRefundableBalance\":0}"}],"structuredContent":{"refundId":"<refund-id>","customerId":"CUST-00001","amount":500,"currency":"USD","reason":"Duplicate charge on order 1042","status":"processed","processedAt":"<timestamp>","remainingRefundableBalance":0}},"jsonrpc":"2.0","id":2}
```

`<refund-id>` is a random UUID and `<timestamp>` is the current time in ISO 8601 format.

### TC-07

Refund the smallest allowed amount (0.01).

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":0.01,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"{\"refundId\":\"<refund-id>\",\"customerId\":\"CUST-00001\",\"amount\":0.01,\"currency\":\"USD\",\"reason\":\"Duplicate charge on order 1042\",\"status\":\"processed\",\"processedAt\":\"<timestamp>\",\"remainingRefundableBalance\":499.99}"}],"structuredContent":{"refundId":"<refund-id>","customerId":"CUST-00001","amount":0.01,"currency":"USD","reason":"Duplicate charge on order 1042","status":"processed","processedAt":"<timestamp>","remainingRefundableBalance":499.99}},"jsonrpc":"2.0","id":2}
```

`<refund-id>` is a random UUID and `<timestamp>` is the current time in ISO 8601 format.

### TC-08

Accept a reason of exactly 10 characters after trimming; the stored reason is trimmed.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":10,"reason":"   abcdefghij   "}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"{\"refundId\":\"<refund-id>\",\"customerId\":\"CUST-00001\",\"amount\":10,\"currency\":\"USD\",\"reason\":\"abcdefghij\",\"status\":\"processed\",\"processedAt\":\"<timestamp>\",\"remainingRefundableBalance\":490}"}],"structuredContent":{"refundId":"<refund-id>","customerId":"CUST-00001","amount":10,"currency":"USD","reason":"abcdefghij","status":"processed","processedAt":"<timestamp>","remainingRefundableBalance":490}},"jsonrpc":"2.0","id":2}
```

`<refund-id>` is a random UUID and `<timestamp>` is the current time in ISO 8601 format.

### TC-09

Accept a reason of exactly 500 characters.

```sh
R=$(printf 'x%.0s' $(seq 1 500)); printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":10,"reason":"'"$R"'"}}}' | node dist/index.js 2>/dev/null | grep '"id":2' | grep -o '"status":"processed"'
```

Expected output:

```text
"status":"processed"
```

### TC-10

A refund reduces the balance seen by later lookups. The sleep makes the lookup run after the refund completes.

```sh
{ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":99.99,"reason":"Duplicate charge on order 1042"}}}'; sleep 1; printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-00001"}}}'; } | node dist/index.js 2>/dev/null | grep '"id":3'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"{\"customerId\":\"CUST-00001\",\"name\":\"Alice Johnson\",\"email\":\"alice.johnson@example.com\",\"status\":\"active\",\"currency\":\"USD\",\"refundableBalance\":400.01,\"createdAt\":\"2024-01-15T09:30:00.000Z\"}"}],"structuredContent":{"customerId":"CUST-00001","name":"Alice Johnson","email":"alice.johnson@example.com","status":"active","currency":"USD","refundableBalance":400.01,"createdAt":"2024-01-15T09:30:00.000Z"}},"jsonrpc":"2.0","id":3}
```

## Validation rejections (JSON-RPC error -32602)

### TC-11

Reject a call with no arguments object.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record"}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":[],"code":"invalid_type","message":"Invalid input: expected object, received undefined"}]}}}
```

### TC-12

Reject null arguments. The SDK rejects this before the tool schema runs.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":null}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid tools/call request: [\n  {\n    \"expected\": \"record\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"params\",\n      \"arguments\"\n    ],\n    \"message\": \"Invalid input: expected record, received null\"\n  }\n]"}}
```

### TC-13

Reject an array as the arguments object. The SDK rejects this before the tool schema runs.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":["CUST-00001"]}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid tools/call request: [\n  {\n    \"expected\": \"record\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"params\",\n      \"arguments\"\n    ],\n    \"message\": \"Invalid input: expected record, received array\"\n  }\n]"}}
```

### TC-14

Reject an empty arguments object.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":["customer_id"],"code":"invalid_type","message":"Invalid input: expected string, received undefined"}]}}}
```

### TC-15

Reject an extra property.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-00001","verbose":true}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":[],"code":"unrecognized_keys","message":"Unrecognized key: \"verbose\""}]}}}
```

### TC-16

Reject a numeric customer_id.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":1}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":["customer_id"],"code":"invalid_type","message":"Invalid input: expected string, received number"}]}}}
```

### TC-17

Reject an empty customer_id.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":""}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":["customer_id"],"code":"invalid_format","message":"customer_id must match the format CUST-NNNNN (five digits)"}]}}}
```

### TC-18

Reject a lowercase customer_id.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"cust-00001"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":["customer_id"],"code":"invalid_format","message":"customer_id must match the format CUST-NNNNN (five digits)"}]}}}
```

### TC-19

Reject a customer_id with four digits.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-0001"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":["customer_id"],"code":"invalid_format","message":"customer_id must match the format CUST-NNNNN (five digits)"}]}}}
```

### TC-20

Reject a customer_id with six digits.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-000001"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":["customer_id"],"code":"invalid_format","message":"customer_id must match the format CUST-NNNNN (five digits)"}]}}}
```

### TC-21

Reject a customer_id with leading whitespace.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":" CUST-00001"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":["customer_id"],"code":"invalid_format","message":"customer_id must match the format CUST-NNNNN (five digits)"}]}}}
```

### TC-22

Reject a customer_id with trailing whitespace.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-00001 "}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool get_customer_record","data":{"issues":[{"path":["customer_id"],"code":"invalid_format","message":"customer_id must match the format CUST-NNNNN (five digits)"}]}}}
```

### TC-23

Reject an amount of 0.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":0,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["amount"],"code":"too_small","message":"amount must be greater than 0"}]}}}
```

### TC-24

Reject a negative amount.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":-10,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["amount"],"code":"too_small","message":"amount must be greater than 0"}]}}}
```

### TC-25

Reject an amount with three decimal places.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":10.001,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["amount"],"code":"custom","message":"amount must have at most 2 decimal places"}]}}}
```

### TC-26

Reject a numeric string amount (no type coercion).

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":"10.00","reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["amount"],"code":"invalid_type","message":"Invalid input: expected number, received string"}]}}}
```

### TC-27

Reject an amount above 1,000,000.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":1000000.01,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["amount"],"code":"too_big","message":"amount must not exceed 1000000"}]}}}
```

### TC-28

Reject a reason shorter than 10 characters after trimming.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":10,"reason":"  too short  "}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["reason"],"code":"too_small","message":"reason must be at least 10 characters after trimming whitespace"}]}}}
```

### TC-29

Reject a reason made only of whitespace.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":10,"reason":"              "}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["reason"],"code":"too_small","message":"reason must be at least 10 characters after trimming whitespace"}]}}}
```

### TC-30

Reject a reason longer than 500 characters.

```sh
R=$(printf 'x%.0s' $(seq 1 501)); printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":10,"reason":"'"$R"'"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["reason"],"code":"too_big","message":"reason must be at most 500 characters after trimming whitespace"}]}}}
```

### TC-31

Reject a refund with missing amount and reason.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["amount"],"code":"invalid_type","message":"Invalid input: expected number, received undefined"},{"path":["reason"],"code":"invalid_type","message":"Invalid input: expected string, received undefined"}]}}}
```

### TC-32

Reject a refund with an extra property.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":10,"reason":"Duplicate charge on order 1042","currency":"USD"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":[],"code":"unrecognized_keys","message":"Unrecognized key: \"currency\""}]}}}
```

### TC-33

Reject a refund with a lowercase customer_id.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"cust-00001","amount":10,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool trigger_refund","data":{"issues":[{"path":["customer_id"],"code":"invalid_format","message":"customer_id must match the format CUST-NNNNN (five digits)"}]}}}
```

## Business-rule failures (isError: true)

### TC-34

Look up a customer that does not exist.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-99999"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"Customer CUST-99999 was not found."}],"isError":true},"jsonrpc":"2.0","id":2}
```

### TC-35

Refund a customer that does not exist.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-99999","amount":10,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"Customer CUST-99999 was not found."}],"isError":true},"jsonrpc":"2.0","id":2}
```

### TC-36

Refund a suspended customer.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00002","amount":10,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"Customer CUST-00002 is suspended. Refunds can only be issued to active accounts."}],"isError":true},"jsonrpc":"2.0","id":2}
```

### TC-37

Refund a customer whose refundable balance is zero.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00003","amount":0.01,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"Refund amount 0.01 USD exceeds the refundable balance of 0.00 USD for customer CUST-00003."}],"isError":true},"jsonrpc":"2.0","id":2}
```

### TC-38

Refund more than the refundable balance.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":500.01,"reason":"Duplicate charge on order 1042"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"result":{"content":[{"type":"text","text":"Refund amount 500.01 USD exceeds the refundable balance of 500.00 USD for customer CUST-00001."}],"isError":true},"jsonrpc":"2.0","id":2}
```

## Protocol behavior

### TC-39

Call a tool that does not exist (-32602).

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"delete_customer","arguments":{"customer_id":"CUST-00001"}}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"MCP error -32602: Unknown tool: delete_customer"}}
```

### TC-40

Call a method that does not exist (-32601, handled by the SDK).

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"customers/delete","params":{}}' | node dist/index.js 2>/dev/null | grep '"id":2'
```

Expected output:

```text
{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}
```

### TC-41

Send malformed JSON followed by a ping. The SDK logs the parse failure to stderr and sends no response for it; the ping is still answered.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":99,"method":' '{"jsonrpc":"2.0","id":2,"method":"ping"}' | node dist/index.js 2>/dev/null | grep -v '"id":1}'
```

Expected output:

```text
{"result":{},"jsonrpc":"2.0","id":2}
```

### TC-42

Send valid JSON that is not a JSON-RPC message, followed by a ping. The SDK logs it to stderr and sends no response for it; the ping is still answered.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"1.0","id":7,"method":"ping"}' '{"hello":"world"}' '{"jsonrpc":"2.0","id":2,"method":"ping"}' | node dist/index.js 2>/dev/null | grep -v '"id":1}'
```

Expected output:

```text
{"result":{},"jsonrpc":"2.0","id":2}
```

### TC-43

Check stdout purity: every line written to stdout during a mixed session is a JSON-RPC 2.0 message.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-00001"}}}' '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00001","amount":10.001,"reason":"Duplicate charge on order 1042"}}}' '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"trigger_refund","arguments":{"customer_id":"CUST-00002","amount":10,"reason":"Duplicate charge on order 1042"}}}' 'not json at all' '{"jsonrpc":"2.0","id":6,"method":"unknown/method"}' | node dist/index.js 2>/dev/null | node -e 'let n=0;require("readline").createInterface({input:process.stdin}).on("line",l=>{const m=JSON.parse(l);if(m.jsonrpc!=="2.0")throw new Error(l);n++}).on("close",()=>console.log("stdout lines: "+n+", all JSON-RPC 2.0"))'
```

Expected output:

```text
stdout lines: 6, all JSON-RPC 2.0
```

### TC-44

Confirm that logs go to stderr. stdout is discarded and only stderr is shown.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_customer_record","arguments":{"customer_id":"CUST-00001"}}}' | LOG_LEVEL=debug node dist/index.js 2>&1 >/dev/null | grep -o '"level":"[a-z]*","message":"[A-Za-z ]*"'
```

Expected output:

```text
"level":"info","message":"Server started"
"level":"debug","message":"Tool call received"
"level":"info","message":"Tool call completed"
"level":"info","message":"Shutting down"
"level":"info","message":"Server stopped"
```

### TC-45

Graceful shutdown on SIGTERM exits with code 0.

```sh
sleep 5 | node dist/index.js 2>/dev/null & sleep 1; kill -TERM $!; wait $!; echo "exit code: $?"
```

Expected output:

```text
exit code: 0
```

## MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) provides a web UI for calling the tools interactively. The Inspector version used by `npm run inspector` requires Node.js 22.19 or later.

1. Build the server with `npm run build`.
2. Run `npm run inspector`. This starts the Inspector with `node dist/index.js` as a stdio server.
3. Open the URL printed in the terminal. It starts with `http://127.0.0.1:6274` and includes an `MCP_INSPECTOR_API_TOKEN` query parameter, which the Inspector requires.
4. Check that the transport is STDIO, the command is `node` and the arguments are `dist/index.js`, then connect.
5. Open the Tools view and list the tools. Confirm that `get_customer_record` and `trigger_refund` appear, each with an input schema and an output schema.
6. Select `get_customer_record`, enter `CUST-00001` as `customer_id` and run it. The result shows the structured customer record with `refundableBalance` 500.
7. Select `trigger_refund` and run it with `customer_id` `CUST-00001`, `amount` `125.50` and `reason` `Duplicate charge on order 1042`. The result has `status` `processed` and `remainingRefundableBalance` 374.5.
8. Run `get_customer_record` for `CUST-00001` again. `refundableBalance` is now 374.5.
9. Run `trigger_refund` for `CUST-00002`. The result is marked as an error with the message `Customer CUST-00002 is suspended. Refunds can only be issued to active accounts.`
10. Run `trigger_refund` for `CUST-00001` with `amount` `10.001`. The Inspector shows a JSON-RPC error with code `-32602` and the message `MCP error -32602: Invalid arguments for tool trigger_refund`.
11. Check the server's stderr output in the Inspector. It contains JSON log lines such as `Tool call completed`.

The balance changes made in the Inspector last until the Inspector restarts the server.

The Inspector also has a command-line mode that is useful for quick checks:

```sh
npx @modelcontextprotocol/inspector@2.13.0 --cli node dist/index.js --method tools/list
npx @modelcontextprotocol/inspector@2.13.0 --cli node dist/index.js --method tools/call --tool-name get_customer_record --tool-arg customer_id=CUST-00001
```
