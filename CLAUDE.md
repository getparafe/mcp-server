# @getparafe/mcp-server

MCP tool server for the Parafe Trust Broker. Wraps `@getparafe/sdk` to expose trust operations as MCP tools.

## Project Structure

- `src/index.ts` — Server entry, tool handlers, resource handlers, credential lifecycle
- `src/tools.ts` — Tool name constants, tool definitions (descriptions + JSON Schema), authorization builder
- `src/schemas.ts` — Zod schemas for tool parameters (required by MCP SDK)
- `src/resources.ts` — MCP resource definitions
- `src/bin/parafe-mcp.ts` — CLI entry point for `npx` execution
- `tests/server.test.ts` — Unit tests (35 tests)

## Running

```bash
npm install
npm run build
npm test

# Run locally with stdio
PARAFE_BROKER_URL=https://... PARAFE_API_KEY=prf_key_... node dist/bin/parafe-mcp.js
```

## Key Design Decisions

- **Thin wrapper** — all broker interaction goes through `@getparafe/sdk`. No direct HTTP calls to the broker except for `parafe_discover` (fetches agent cards) and `parafe_get_public_key`.
- **Zod schemas** — MCP SDK requires Zod for parameter validation. Schemas in `src/schemas.ts`.
- **Tool descriptions** — written so an LLM knows when/how to use each tool without external docs. These are in `src/tools.ts`.
- **Credential lifecycle** — auto-loads on startup if passphrase is set, auto-saves after registration.
- **`parafe_record_action`** auto-populates `agentId` from loaded credentials (the MCP user doesn't need to pass it).

## When Making Changes

- If adding a tool, add it in three places: `src/tools.ts` (name + description), `src/schemas.ts` (Zod schema), and `src/index.ts` (handler + registration).
- Tool descriptions are critical for LLM usability — test them.
- Run `npm test` before pushing.
