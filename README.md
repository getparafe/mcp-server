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

**Claude Code** (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "parafe-trust": {
      "command": "npx",
      "args": ["@getparafe/mcp-server"],
      "env": {
        "PARAFE_BROKER_URL": "https://api.parafe.ai",
        "PARAFE_API_KEY": "prf_key_live_..."
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
        "PARAFE_API_KEY": "prf_key_live_..."
      }
    }
  }
}
```

### 3. Use It

Your agent now has 23 trust tools. The typical flow:

1. **Discover** — `parafe_discover` fetches the target agent's agent card to learn its trust requirements
2. **Register** — `parafe_register` creates your agent's cryptographic identity (once, persisted)
3. **Handshake** — `parafe_initiate_handshake` starts mutual authentication; the target calls `parafe_complete_handshake`
4. **Interact** — `parafe_verify_consent` checks each request; after each action you perform or refuse, `parafe_record_action_receipt` signs an action receipt and files it in the session's index (`parafe_file_action_receipt` files the other agent's copy)
   - **Selling under an AP2 mandate?** `parafe_verify_mandate` has the broker check the mandate the shopping agent presented; answer with `parafe_record_ap2_receipt` (an AP2 Checkout or Payment Receipt, signed with your P-256 key and filed in the session's index)
5. **Close** — `parafe_close_session` generates a signed receipt (a JWS) of the session's trust context and every action receipt filed, verifiable by anyone who holds it; the other participant fetches it with `parafe_get_session_receipt`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PARAFE_BROKER_URL` | Yes | — | Parafe broker API URL |
| `PARAFE_API_KEY` | No | — | API key from the developer portal. Without one, `parafe_register` self-registers the agent (no owner) and returns a claim link: the person it acts for opens it, signs in and approves (`parafe_create_claim_link` makes a new one) |
| `PARAFE_CREDENTIALS_PATH` | No | `~/.parafe/credentials.enc` | Encrypted credential file path |
| `PARAFE_CREDENTIALS_PASSPHRASE` | No | — | Passphrase for credential encryption. If not set, credentials are held in memory only. |

## Available Tools

| Tool | Description |
|------|-------------|
| `parafe_discover` | Fetch a target agent's agent card to learn its Parafe trust requirements |
| `parafe_register` | Register a new agent identity (Ed25519 or P-256 key; JWT and SD-JWT VC credentials) |
| `parafe_initiate_handshake` | Start mutual authentication with a target agent |
| `parafe_complete_handshake` | Complete a handshake initiated by another agent |
| `parafe_escalate_scope` | Request additional scope within an existing session |
| `parafe_verify_consent` | Check if an action is permitted by a consent token (and, with `presentation_proof`, that it's presented by its rightful holder) |
| `parafe_record_action_receipt` | Sign an action receipt for what you did or refused, and file it in the session's index |
| `parafe_file_action_receipt` | File the other agent's action receipt (or an AP2 receipt) in the session's index |
| `parafe_get_action_receipts` | List the session's index (either participant) |
| `parafe_create_claim_link` | A claim link for an agent registered without an API key: the person it acts for opens it and approves, and the agent becomes theirs |
| `parafe_close_session` | Close a session and generate a signed receipt |
| `parafe_get_session_receipt` | Fetch a closed session's receipt (either participant) |
| `parafe_verify_receipt` | Verify a receipt's signature |
| `parafe_revoke_agent` | Revoke an agent identity |
| `parafe_renew_credential` | Renew a credential (tier changed, or within 7 days of expiry) |
| `parafe_update_scope_policies` | Update an agent's accepted scope policies |
| `parafe_get_public_key` | Get the broker's signing keys (JWKS) |
| `parafe_verify_consent_locally` | Verify a consent token offline against the broker's keys |
| `parafe_create_presentation_proof` | Proof to send with a consent token you present (tokens are bound to your key) |
| `parafe_get_agent_metrics` | Get reputation metrics for an agent (trust signals from interaction history) |
| `parafe_verify_mandate` | Have the broker verify an AP2 mandate presented to you (merchant or payment processor): valid, the AP2 error code if not, the agent holding it, the redemption |
| `parafe_record_ap2_receipt` | Sign an AP2 Checkout or Payment Receipt and file it in the session's index (needs a P-256 agent key) |
| `parafe_sign_ap2_receipt` | Sign an AP2 Checkout or Payment Receipt without filing it (a purchase outside a Parafé session) |

## Resources

| URI | Description |
|-----|-------------|
| `parafe://agent` | Current agent identity and credential status |
| `parafe://session/{sessionId}` | Session details, participants, consent tokens |
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

Connect to `http://localhost:3001/mcp` from your MCP client.

## How It Works

This MCP server wraps the [@getparafe/sdk](https://github.com/getparafe/sdk). Each tool call maps to an SDK method. The SDK handles the cryptography (Ed25519 or P-256 agent keys, challenge signing, a proof of possession on every request made as your agent) and credential encryption internally.

```
MCP Client (Claude, Cursor, etc.)
    ↓ MCP protocol
@getparafe/mcp-server
    ↓ SDK method calls
@getparafe/sdk
    ↓ HTTPS
Parafe Broker API
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
