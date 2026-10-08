# @getparafe/mcp-server

MCP tool server for the Parafe Trust Broker. Wraps `@getparafe/sdk` to expose trust operations as MCP tools.

## Project Structure

- `src/index.ts` — Server entry, tool handlers, resource handlers, credential lifecycle
- `src/tools.ts` — Tool name constants, tool definitions (descriptions + JSON Schema), authorization builder
- `src/schemas.ts` — Zod schemas for tool parameters (required by MCP SDK)
- `src/resources.ts` — MCP resource definitions
- `src/bin/parafe-mcp.ts` — CLI entry point for `npx` execution
- `src/http.ts` — Streamable HTTP handler: one McpServer and transport per request (stateless), sharing one `ParafeClient`; bearer token required
- `tests/unit/server.test.ts`, `tests/unit/transport-and-credentials.test.ts` — Unit tests (no network)
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

# Run with HTTP transport (PARAFE_MCP_AUTH_TOKEN is required; it won't start without it)
PARAFE_BROKER_URL=https://... PARAFE_API_KEY=prf_key_... PARAFE_MCP_AUTH_TOKEN=secret node dist/bin/parafe-mcp.js --transport=http
```

Integration tests are self-bootstrapping — they create their own org + API key via `POST /auth/signup`. The only env var needed is `PARAFE_TEST_BROKER_URL` (defaults to `http://localhost:3000`).

## Key Design Decisions

- **Thin wrapper** — all broker interaction goes through `@getparafe/sdk`. `parafe_discover` fetches agent cards from third-party domains, not the broker. `createServer()` returns `newServer()` for a fresh McpServer on the same client (the HTTP transport needs one per request: the MCP SDK refuses to reuse a stateless transport). Resource templates must be `ResourceTemplate` objects; a string registers one literal URI.
- **Consent audience (S-69)** — `checkConsentAudience()` (`src/index.ts`) refuses a consent token issued for another agent than the loaded one before `parafe_verify_consent` and `parafe_verify_consent_locally` call the SDK, so the check holds with SDK 0.13 too (SDK 0.14 checks as well).
- **Zod schemas** — MCP SDK requires Zod for parameter validation. Schemas in `src/schemas.ts`.
- **Tool descriptions** — written so an LLM knows when/how to use each tool without external docs. These are in `src/tools.ts`.
- **Credential lifecycle** — auto-loads on startup if passphrase is set, auto-saves after registration and after the loaded agent's credential is renewed (the broker revokes the old one). A file that exists but can't be read is logged and never overwritten: `parafe_register` refuses until it's fixed or moved.
- **P-256 by default (0.9.0)** — `parafe_register` passes `keyAlgorithm: 'P-256'` unless `key_algorithm` says otherwise (AP2 receipts need P-256; Ed25519 stays accepted).
- **AP2 tools (0.8.0)** — `parafe_verify_mandate` wraps the SDK's `verifyMandate()`; `parafe_record_ap2_receipt` / `parafe_sign_ap2_receipt` wrap `recordAp2Receipt()` / `signAp2Receipt()` (ES256: the agent needs a P-256 key). Snake_case arguments map to SDK options in `buildVerifyMandateOptions` / `buildAp2ReceiptOptions` (`src/tools.ts`); the SDK validates the receipt fields.
- **Action receipts (0.6.0)** — `parafe_record_action_receipt` signs with the loaded agent's key and files it; `parafe_file_action_receipt` files the other agent's copy (a duplicate returns the original acknowledgment); `parafe_get_action_receipts` lists the index. `parafe_record_action` (`/interaction/record`) was removed.

## When Making Changes

- If adding a tool, add it in three places: `src/tools.ts` (name + description), `src/schemas.ts` (Zod schema), and `src/index.ts` (handler + registration).
- Tool descriptions are critical for LLM usability — test them.
- Run `npm test` before pushing.
