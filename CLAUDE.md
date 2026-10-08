# @getparafe/mcp-server

MCP tool server for the Parafe Trust Broker. Wraps `@getparafe/sdk` to expose trust operations as MCP tools.

## Project Structure

- `src/index.ts` — Server entry, tool handlers, resource handlers, credential lifecycle
- `src/tools.ts` — Tool name constants, tool definitions (descriptions + JSON Schema), authorization builder
- `src/schemas.ts` — Zod schemas for tool parameters (required by MCP SDK)
- `src/resources.ts` — MCP resource definitions
- `src/bin/parafe-mcp.ts` — CLI entry point for `npx` execution
- `tests/unit/server.test.ts` — Unit tests (no network)
- `tests/integration/lifecycle.test.ts` — Integration tests (5 tests, self-bootstrapping against live broker; the AP2 one drives the tools through an MCP client)

## Running

```bash
npm install
npm run build
npm run test:unit           # Unit tests (no network)
npm run test:integration    # Integration tests (requires broker)
npm test                    # Both

# Run locally with stdio
PARAFE_BROKER_URL=https://... PARAFE_API_KEY=prf_key_... node dist/bin/parafe-mcp.js

# Run with HTTP transport (always set PARAFE_MCP_AUTH_TOKEN: without it /mcp has no auth; S-67)
# Known bug: the transport fails after the first request (P-44)
PARAFE_BROKER_URL=https://... PARAFE_API_KEY=prf_key_... PARAFE_MCP_AUTH_TOKEN=secret node dist/bin/parafe-mcp.js --transport=http
```

Integration tests are self-bootstrapping — they create their own org + API key via `POST /auth/signup`. The only env var needed is `PARAFE_TEST_BROKER_URL` (defaults to `http://localhost:3000`).

## Key Design Decisions

- **Thin wrapper** — broker interaction goes through `@getparafe/sdk`, with one exception: the `parafe://session/{id}` resource calls the broker's `/admin/sessions/:id` directly, which fails (CODE_REVIEW P-45). `parafe_discover` fetches agent cards from third-party domains, not the broker.
- **Zod schemas** — MCP SDK requires Zod for parameter validation. Schemas in `src/schemas.ts`.
- **Tool descriptions** — written so an LLM knows when/how to use each tool without external docs. These are in `src/tools.ts`.
- **Credential lifecycle** — auto-loads on startup if passphrase is set, auto-saves after registration. Not after renewal (CODE_REVIEW P-46), and a load error is swallowed (P-47).
- **P-256 by default (0.9.0)** — `parafe_register` passes `keyAlgorithm: 'P-256'` unless `key_algorithm` says otherwise (AP2 receipts need P-256; Ed25519 stays accepted).
- **AP2 tools (0.8.0)** — `parafe_verify_mandate` wraps the SDK's `verifyMandate()`; `parafe_record_ap2_receipt` / `parafe_sign_ap2_receipt` wrap `recordAp2Receipt()` / `signAp2Receipt()` (ES256: the agent needs a P-256 key). Snake_case arguments map to SDK options in `buildVerifyMandateOptions` / `buildAp2ReceiptOptions` (`src/tools.ts`); the SDK validates the receipt fields.
- **Action receipts (0.6.0)** — `parafe_record_action_receipt` signs with the loaded agent's key and files it; `parafe_file_action_receipt` files the other agent's copy (a duplicate returns the original acknowledgment); `parafe_get_action_receipts` lists the index. `parafe_record_action` (`/interaction/record`) was removed.

## When Making Changes

- If adding a tool, add it in three places: `src/tools.ts` (name + description), `src/schemas.ts` (Zod schema), and `src/index.ts` (handler + registration).
- Tool descriptions are critical for LLM usability — test them.
- Run `npm test` before pushing.
