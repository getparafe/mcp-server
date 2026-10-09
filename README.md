# @getparafe/mcp-server

MCP tool server for the [Parafe Trust Broker](https://parafe.ai). Add trust handshakes to any MCP-compatible AI agent with zero code changes.

## What This Does

Parafe is a neutral trust broker for agent-to-agent interactions. This MCP server exposes Parafe's trust operations — agent registration, mutual authentication, scoped consent, and signed receipts — as MCP tools that any LLM agent can call.

Add a JSON config block. Your agent gets trust handshakes.

## Quick Start

### 1. Get Credentials

Sign up at [platform.parafe.ai](https://platform.parafe.ai) and create an API key.

### 2. Configure Your MCP Client

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "parafe-trust": {
      "command": "npx",
      "args": ["@getparafe/mcp-server"],
      "env": {
        "PARAFE_BROKER_URL": "https://api.parafe.ai",
        "PARAFE_API_KEY": "prf_key_live_...",
        "PARAFE_CREDENTIALS_PASSPHRASE": "your-passphrase"
      }
    }
  }
}
```

**Claude Code** (`.mcp.json` in your project root, or `claude mcp add parafe-trust -e PARAFE_BROKER_URL=https://api.parafe.ai -e PARAFE_CREDENTIALS_PASSPHRASE=your-passphrase -- npx @getparafe/mcp-server`):

```json
{
  "mcpServers": {
    "parafe-trust": {
      "command": "npx",
      "args": ["@getparafe/mcp-server"],
      "env": {
        "PARAFE_BROKER_URL": "https://api.parafe.ai",
        "PARAFE_API_KEY": "prf_key_live_...",
        "PARAFE_CREDENTIALS_PASSPHRASE": "your-passphrase"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "parafe-trust": {
      "command": "npx",
      "args": ["@getparafe/mcp-server"],
      "env": {
        "PARAFE_BROKER_URL": "https://api.parafe.ai",
        "PARAFE_API_KEY": "prf_key_live_...",
        "PARAFE_CREDENTIALS_PASSPHRASE": "your-passphrase"
      }
    }
  }
}
```

Without `PARAFE_CREDENTIALS_PASSPHRASE` the agent's identity lives in memory only, and every restart registers a new agent.

### 3. Use It

Your agent now has 24 trust tools. The typical flow:

1. **Discover** — `parafe_discover` fetches the target agent's agent card to learn its trust requirements
2. **Register** — `parafe_register` creates your agent's cryptographic identity (once; saved to the credentials file when `PARAFE_CREDENTIALS_PASSPHRASE` is set)
3. **Handshake** — `parafe_initiate_handshake` starts mutual authentication; the target calls `parafe_complete_handshake`
4. **Interact** — `parafe_verify_consent` checks each request; after each action you perform or refuse, `parafe_record_action_receipt` signs an action receipt and files it in the session's index (`parafe_file_action_receipt` files the other agent's copy)
   - **Selling under an AP2 mandate?** `parafe_verify_mandate` has the broker check the mandate the shopping agent presented; answer with `parafe_record_ap2_receipt` (an AP2 Checkout or Payment Receipt, signed with your P-256 key and filed in the session's index)
5. **Close** — `parafe_close_session` generates a signed receipt (a JWS) of the session's trust context and every action receipt filed, verifiable by anyone who holds it; the other participant fetches it with `parafe_get_session_receipt`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PARAFE_BROKER_URL` | Yes | — | Parafe broker API URL |
| `PARAFE_API_KEY` | No | — | API key from the developer portal. Without one, `parafe_register` self-registers the agent (no operator or principal; its public name is its agent ID) and returns a claim link: the agent shows it to the person it acts for and tells them its code; they open the link, check the page shows the same code, sign in and approve (`parafe_create_claim_link` makes a new one; `parafe_get_claim_status` waits for the approval) |
| `PARAFE_CREDENTIALS_PATH` | No | `~/.parafe/credentials.enc` | Encrypted credential file path |
| `PARAFE_CREDENTIALS_PASSPHRASE` | No | — | Passphrase for credential encryption. If not set, credentials are held in memory only. |
| `PARAFE_MCP_AUTH_TOKEN` | For `--transport=http` | — | Bearer token MCP clients must send on `/mcp`. The HTTP transport won't start without it (0.13.0 started without it and served `/mcp` with no authentication). |

## Available Tools

| Tool | Description |
|------|-------------|
| `parafe_discover` | Fetch a target agent's agent card to learn its Parafe trust requirements |
| `parafe_register` | Register a new agent identity (P-256 key by default, or Ed25519; JWT and SD-JWT VC credentials). Only `type` is required. With an API key, `name` is required (unique per operator); without one, `name` and `principal_name` are optional and shown only on the claim page. With an API key, `acts_for_ref` registers it for one of your platform's users (an opaque reference, not an email): you become its operator |
| `parafe_initiate_handshake` | Start mutual authentication with a target agent |
| `parafe_complete_handshake` | Complete a handshake initiated by another agent |
| `parafe_escalate_scope` | Request additional scope within an existing session |
| `parafe_verify_consent` | Check if an action is permitted by a consent token (and, with `presentation_proof`, that it's presented by its rightful holder) |
| `parafe_record_action_receipt` | Sign an action receipt for what you did or refused, and file it in the session's index |
| `parafe_file_action_receipt` | File the other agent's action receipt (or an AP2 receipt) in the session's index |
| `parafe_get_action_receipts` | List the session's index (either participant) |
| `parafe_create_claim_link` | A claim link for an agent registered without an API key (or by a platform for one of its users): the person it acts for opens it, checks the code and approves while signed in to Parafé, and the agent acts for them |
| `parafe_get_claim_status` | Whether the person has approved the claim link yet. Waits for the approval (up to `wait_seconds`, default 25) and answers the moment they approve; call it again while `claimed` is false, for up to 30 minutes. Then `parafe_renew_credential`. Needs `@getparafe/sdk` 0.12 and a broker from 2026-10-08 |
| `parafe_close_session` | Close a session and generate a signed receipt |
| `parafe_get_session_receipt` | Fetch a closed session's receipt (either participant) |
| `parafe_verify_receipt` | Ask the broker to check a receipt's signature (for an independent check, verify the JWS against the broker's JWKS, e.g. with `@getparafe/verify`) |
| `parafe_revoke_agent` | Revoke an agent identity |
| `parafe_renew_credential` | Renew a credential: after a claim or a tier change, or when expired or within 7 days of expiry; otherwise `renewed: false` |
| `parafe_update_scope_policies` | Update an agent's accepted scope policies |
| `parafe_get_public_key` | Get the broker's signing keys (JWKS) |
| `parafe_verify_consent_locally` | Verify a consent token offline against the broker's keys |
| `parafe_create_presentation_proof` | Proof to send with a consent token you present (tokens are bound to your key) |
| `parafe_get_agent_metrics` | Get reputation metrics for an agent (trust signals from interaction history). With an API key: your org's agents and agents with no org only (403 for another org's agent) |
| `parafe_verify_mandate` | Have the broker verify an AP2 mandate presented to you (merchant or payment processor): valid, the AP2 error code if not, the agent holding it, the redemption |
| `parafe_record_ap2_receipt` | Sign an AP2 Checkout or Payment Receipt and file it in the session's index (needs a P-256 agent key) |
| `parafe_sign_ap2_receipt` | Sign an AP2 Checkout or Payment Receipt without filing it (a purchase outside a Parafé session) |

## Resources

| URI | Description |
|-----|-------------|
| `parafe://agent` | Whether credentials are loaded: agent ID and name, expiry |
| `parafe://session/{sessionId}` | A session the loaded agent takes part in: its action-receipt index and, once closed, its signed receipt |
| `parafe://public-key` | Broker's signing keys (JWKS) |

## Transports

**stdio** (default) — standard for local MCP clients:

```bash
npx @getparafe/mcp-server
```

**Streamable HTTP** — for hosted/remote deployments:

```bash
npx @getparafe/mcp-server --transport=http --port=3001
```

Connect to `http://localhost:3001/mcp` from your MCP client, sending `Authorization: Bearer <PARAFE_MCP_AUTH_TOKEN>`. It listens on every interface; each request is served statelessly, all as the one loaded agent.

## How It Works

This MCP server wraps the [@getparafe/sdk](https://github.com/getparafe/sdk). Each tool call maps to an SDK method, except `parafe_discover`, which fetches the target's agent card itself. The SDK handles the cryptography (P-256 or Ed25519 agent keys, challenge signing, a proof of possession on every request made as your agent) and credential encryption internally.

```
MCP Client (Claude, Cursor, etc.)
    ↓ MCP protocol
@getparafe/mcp-server
    ↓ SDK method calls
@getparafe/sdk
    ↓ HTTPS
Parafe Broker API
```

## New in 0.15.0

- `parafe_verify_consent` and `parafe_verify_consent_locally` refuse a consent token issued for a different agent than the loaded one (`wrong_audience`), so a token from another session can't be replayed at this agent. A refusal names its cause (`token_expired`, `token_invalid`, `session_inactive`, ...).
- An agent whose credential expired less than a year ago can renew it with `parafe_renew_credential` (broker from 2026-10-08).
- `parafe_get_agent_metrics` reads only your own agent's track record: other agents' are private since 2026-10-08 (set reputation floors in your scope policies instead).
- The `instruction` of an `attested` handshake goes to the other agent, and the tool descriptions now say so: send a short summary of what the person asked for, without personal details. With SDK 0.14, the handshake and consent token results carry `evidenceSalt`: the session receipt's hash of the instruction is salted since 2026-10-09.

## New in 0.14.0

- Uses `@getparafe/sdk` 0.13: `parafe_register` proves it holds the key it registers (a `Parafe-PoP` proof). The broker requires this since 2026-10-08, so **0.13.0 and earlier can no longer register new agents**; identities already registered keep working.
- Fixes the 0.13.0 issues below.

## Fixed in 0.14.0 (known issues in 0.13.0)

- **Streamable HTTP** answers the first request and fails every later one, and serves `/mcp` with no authentication unless `PARAFE_MCP_AUTH_TOKEN` is set. Use stdio with 0.13.0.
- **`parafe_renew_credential`** doesn't save the renewed credential, and the broker revokes the old one, so after a restart the server loads the revoked credential. A keyless agent that renewed and then restarted must delete (or move) its credentials file and register again.
- **`parafe://session/{sessionId}`** always fails.
- A wrong `PARAFE_CREDENTIALS_PASSPHRASE` is ignored silently, and the next `parafe_register` overwrites the saved identity. Since the fix, the server logs the error and refuses to register until the passphrase is fixed or the file is moved.

## Development

```bash
npm install
npm run build
npm run test:unit                                   # no network
PARAFE_TEST_BROKER_URL=https://… npm run test:integration   # signs up a test org on that broker
```

## License

MIT
