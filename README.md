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
        "PARAFE_BROKER_URL": "https://parafe-production-9bc9.up.railway.app",
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
        "PARAFE_BROKER_URL": "https://parafe-production-9bc9.up.railway.app",
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
        "PARAFE_BROKER_URL": "https://parafe-production-9bc9.up.railway.app",
        "PARAFE_API_KEY": "prf_key_live_..."
      }
    }
  }
}
```

### 3. Use It

Your agent now has 15 trust tools. The typical flow:

1. **Discover** — `parafe_discover` fetches the target agent's agent card to learn its trust requirements
2. **Register** — `parafe_register` creates your agent's cryptographic identity (once, persisted)
3. **Handshake** — `parafe_initiate_handshake` starts mutual authentication; the target calls `parafe_complete_handshake`
4. **Interact** — `parafe_verify_consent` and `parafe_record_action` govern the scoped exchange
5. **Close** — `parafe_close_session` generates a signed receipt both parties can verify

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PARAFE_BROKER_URL` | Yes | — | Parafe broker API URL |
| `PARAFE_API_KEY` | Yes | — | API key from the developer portal |
| `PARAFE_CREDENTIALS_PATH` | No | `~/.parafe/credentials.enc` | Encrypted credential file path |
| `PARAFE_CREDENTIALS_PASSPHRASE` | No | — | Passphrase for credential encryption. If not set, credentials are held in memory only. |

## Available Tools

| Tool | Description |
|------|-------------|
| `parafe_discover` | Fetch a target agent's agent card to learn its Parafe trust requirements |
| `parafe_register` | Register a new agent identity with Ed25519 cryptographic credentials |
| `parafe_initiate_handshake` | Start mutual authentication with a target agent |
| `parafe_complete_handshake` | Complete a handshake initiated by another agent |
| `parafe_escalate_scope` | Request additional scope within an existing session |
| `parafe_verify_consent` | Check if an action is permitted by a consent token |
| `parafe_record_action` | Log an action within an active session |
| `parafe_close_session` | Close a session and generate a signed receipt |
| `parafe_verify_receipt` | Verify a receipt's Ed25519 signature |
| `parafe_revoke_agent` | Revoke an agent identity |
| `parafe_renew_credential` | Renew a credential to the org's current verification tier |
| `parafe_update_scope_policies` | Update an agent's accepted scope policies |
| `parafe_get_public_key` | Get the broker's Ed25519 public key |
| `parafe_verify_consent_locally` | Verify a consent token offline using the broker's public key |
| `parafe_get_agent_metrics` | Get reputation metrics for an agent (trust signals from interaction history) |

## Resources

| URI | Description |
|-----|-------------|
| `parafe://agent` | Current agent identity and credential status |
| `parafe://session/{sessionId}` | Session details, participants, consent tokens |
| `parafe://public-key` | Broker's Ed25519 public key |

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

This MCP server wraps the [@getparafe/sdk](https://github.com/getparafe/sdk). Each tool call maps to an SDK method. The SDK handles Ed25519 cryptography, challenge signing, and credential encryption internally.

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
