# @getparafe/mcp-server

MCP tool server for the Parafe Trust Broker. Wraps `@getparafe/sdk` to expose trust operations as MCP tools.

## Project Structure

- `src/index.ts` — Server entry, tool handlers, resource handlers, credential lifecycle
- `src/tools.ts` — Tool name constants, tool definitions (descriptions + JSON Schema), authorization builder
- `src/schemas.ts` — Zod schemas for tool parameters (required by MCP SDK)
- `src/resources.ts` — MCP resource definitions
- `src/bin/parafe-mcp.ts` — CLI entry point for `npx` execution
- `tests/unit/server.test.ts` — Unit tests (37 tests, no network)
- `tests/integration/lifecycle.test.ts` — Integration tests (4 tests, self-bootstrapping against live broker)

## Running

```bash
npm install
npm run build
npm run test:unit           # Unit tests (no network)
npm run test:integration    # Integration tests (requires broker)
npm test                    # Both

# Run locally with stdio
PARAFE_BROKER_URL=https://... PARAFE_API_KEY=prf_key_... node dist/bin/parafe-mcp.js

# Run with HTTP transport (set PARAFE_MCP_AUTH_TOKEN for bearer auth)
PARAFE_BROKER_URL=https://... PARAFE_API_KEY=prf_key_... PARAFE_MCP_AUTH_TOKEN=secret node dist/bin/parafe-mcp.js --transport=http
```

Integration tests are self-bootstrapping — they create their own org + API key via `POST /auth/signup`. The only env var needed is `PARAFE_TEST_BROKER_URL` (defaults to `http://localhost:3000`).

## Key Design Decisions

- **Thin wrapper** — all broker interaction goes through `@getparafe/sdk`. No direct HTTP calls to the broker except for `parafe_discover` (fetches agent cards from third-party domains).
- **Zod schemas** — MCP SDK requires Zod for parameter validation. Schemas in `src/schemas.ts`.
- **Tool descriptions** — written so an LLM knows when/how to use each tool without external docs. These are in `src/tools.ts`.
- **Credential lifecycle** — auto-loads on startup if passphrase is set, auto-saves after registration.
- **`parafe_record_action`** auto-populates `agentId` from loaded credentials (the MCP user doesn't need to pass it).

## When Making Changes

- If adding a tool, add it in three places: `src/tools.ts` (name + description), `src/schemas.ts` (Zod schema), and `src/index.ts` (handler + registration).
- Tool descriptions are critical for LLM usability — test them.
- Run `npm test` before pushing.
