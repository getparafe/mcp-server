/**
 * @getparafe/mcp-server — MCP tool server for the Parafe Trust Broker
 *
 * Exposes Parafe trust operations (agent registration, mutual authentication,
 * consent verification, session management, receipts) as MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ParafeClient, ParafeError } from '@getparafe/sdk';
import { TOOL_DEFINITIONS, TOOL_NAMES, buildAuthorization } from './tools.js';
import { RESOURCE_DEFINITIONS, RESOURCE_TEMPLATES } from './resources.js';
import { schemas } from './schemas.js';

// ── Package version (injected at build or read from package.json) ──

const VERSION = '0.1.0';

// ── Configuration ──

export interface ServerConfig {
  brokerUrl: string;
  apiKey: string;
  credentialsPath: string;
  credentialsPassphrase?: string;
}

export function loadConfig(): ServerConfig {
  const brokerUrl = process.env.PARAFE_BROKER_URL;
  const apiKey = process.env.PARAFE_API_KEY;

  if (!brokerUrl) {
    throw new Error('PARAFE_BROKER_URL environment variable is required');
  }
  if (!apiKey) {
    throw new Error('PARAFE_API_KEY environment variable is required');
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return {
    brokerUrl,
    apiKey,
    credentialsPath: process.env.PARAFE_CREDENTIALS_PATH || `${homeDir}/.parafe/credentials.enc`,
    credentialsPassphrase: process.env.PARAFE_CREDENTIALS_PASSPHRASE,
  };
}

// ── Agent card discovery ──

const PARAFE_EXTENSION_URI = 'https://parafe.dev/a2a-extension/v1';

interface AgentCardExtension {
  uri: string;
  required?: boolean;
  params?: {
    agent_id?: string;
    broker_url?: string;
    minimum_identity_assurance?: string;
    scope_requirements?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

async function discoverAgentCard(url: string): Promise<Record<string, unknown>> {
  // Auto-append well-known path if just a domain
  let cardUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/' || parsed.pathname === '') {
      cardUrl = `${parsed.origin}/.well-known/agent.json`;
    }
  } catch {
    // If not a valid URL, try adding protocol
    cardUrl = `https://${url}/.well-known/agent.json`;
  }

  const res = await fetch(cardUrl, {
    headers: { 'User-Agent': `@getparafe/mcp-server/${VERSION}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch agent card from ${cardUrl}: ${res.status} ${res.statusText}`);
  }

  const card = await res.json() as Record<string, unknown>;

  // Extract Parafe extension
  const capabilities = card.capabilities as { extensions?: AgentCardExtension[] } | undefined;
  const extensions = capabilities?.extensions;
  const parafeExt = extensions?.find(
    (ext: AgentCardExtension) => ext.uri === PARAFE_EXTENSION_URI,
  );

  if (!parafeExt) {
    return {
      parafe_required: false,
      agent_name: card.name || null,
      raw_agent_card: card,
    };
  }

  const params = parafeExt.params || {};
  return {
    parafe_required: parafeExt.required ?? true,
    agent_name: card.name || null,
    agent_id: params.agent_id || null,
    broker_url: params.broker_url || null,
    minimum_identity_assurance: params.minimum_identity_assurance || null,
    scopes: params.scope_requirements || {},
  };
}

// ── Credential persistence helpers ──

async function ensureDirectoryExists(filePath: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

async function tryLoadCredentials(client: ParafeClient, config: ServerConfig): Promise<void> {
  if (!config.credentialsPassphrase) return;

  try {
    const { access } = await import('node:fs/promises');
    await access(config.credentialsPath);
    await client.loadCredentials(config.credentialsPath, config.credentialsPassphrase);
  } catch {
    // File doesn't exist yet — that's fine
  }
}

async function trySaveCredentials(client: ParafeClient, config: ServerConfig): Promise<void> {
  if (!config.credentialsPassphrase) return;

  await ensureDirectoryExists(config.credentialsPath);
  await client.saveCredentials(config.credentialsPath, config.credentialsPassphrase);
}

// ── SDK 0.2.0 method shim ──
// getPublicKey() and verifyConsentLocally() were added in @getparafe/sdk@0.2.0.
// Cast through this interface until the published type declarations include them.
interface ParafeClientV2 {
  getPublicKey(): Promise<unknown>;
  verifyConsentLocally(consentToken: string, brokerPublicKeyBase64: string): Promise<unknown>;
}

function asV2(client: ParafeClient): ParafeClient & ParafeClientV2 {
  return client as ParafeClient & ParafeClientV2;
}

// ── Tool handler ──

type ToolArgs = Record<string, unknown>;

async function handleToolCall(
  name: string,
  args: ToolArgs,
  client: ParafeClient,
  config: ServerConfig,
): Promise<unknown> {
  switch (name) {
    case TOOL_NAMES.DISCOVER: {
      return discoverAgentCard(args.agent_card_url as string);
    }

    case TOOL_NAMES.REGISTER: {
      // If credentials already loaded, return existing info
      const status = client.credentialStatus();
      if (status.loaded) {
        return {
          message: 'Credentials already loaded. Using existing agent identity.',
          agentId: status.agentId,
          agentName: status.agentName,
          expiresAt: status.expiresAt,
          expired: status.expired,
        };
      }

      const result = await client.register({
        name: args.name as string,
        type: args.type as 'personal' | 'enterprise',
        owner: args.owner as string,
        scopePolicies: args.scope_policies as Record<string, {
          permissions?: string[];
          exclusions?: string[];
          minimum_authorization_modality?: 'autonomous' | 'attested' | 'verified';
          minimum_identity_assurance?: 'self_registered' | 'registered';
          minimum_verification_tier?: 'unverified' | 'email_verified' | 'domain_verified' | 'org_verified';
        }> | undefined,
      });

      // Auto-save credentials
      await trySaveCredentials(client, config);

      // Return without exposing the private key
      return {
        agentId: result.agentId,
        publicKey: result.publicKey,
        verificationTier: result.verificationTier,
        identityAssurance: result.identityAssurance,
        issuedAt: result.issuedAt,
        expiresAt: result.expiresAt,
      };
    }

    case TOOL_NAMES.INITIATE_HANDSHAKE: {
      const authorization = buildAuthorization(
        args.authorization_modality as string | undefined,
        args.authorization_evidence as { instruction?: string; platform?: string; timestamp?: string; user_signature?: string } | undefined,
      );

      return client.handshake({
        targetAgentId: args.target_agent_id as string,
        scope: args.scope as string,
        permissions: args.permissions as string[],
        authorization,
        context: args.context as Record<string, unknown> | undefined,
      });
    }

    case TOOL_NAMES.COMPLETE_HANDSHAKE: {
      return client.completeHandshake({
        handshakeId: args.handshake_id as string,
        challengeNonce: args.challenge_nonce as string,
      });
    }

    case TOOL_NAMES.ESCALATE_SCOPE: {
      const authorization = buildAuthorization(
        args.authorization_modality as string | undefined,
        args.authorization_evidence as { instruction?: string; platform?: string; timestamp?: string; user_signature?: string } | undefined,
      );

      return client.escalateScope({
        sessionId: args.session_id as string,
        targetAgentId: args.target_agent_id as string,
        scope: args.scope as string,
        permissions: args.permissions as string[],
        authorization,
      });
    }

    case TOOL_NAMES.VERIFY_CONSENT: {
      return client.verifyConsent({
        consentToken: args.consent_token as string,
        action: args.action as string,
        sessionId: args.session_id as string,
      });
    }

    case TOOL_NAMES.RECORD_ACTION: {
      const status = client.credentialStatus();
      if (!status.loaded) {
        throw new Error('No credentials loaded. Register an agent first using parafe_register.');
      }

      return client.recordAction({
        sessionId: args.session_id as string,
        agentId: status.agentId,
        action: args.action as string,
        details: args.details as Record<string, unknown> | undefined,
        consentToken: args.consent_token as string | undefined,
      });
    }

    case TOOL_NAMES.CLOSE_SESSION: {
      return client.closeSession(args.session_id as string);
    }

    case TOOL_NAMES.VERIFY_RECEIPT: {
      return client.verifyReceipt(args.receipt as Parameters<typeof client.verifyReceipt>[0]);
    }

    case TOOL_NAMES.REVOKE_AGENT: {
      return client.revokeAgent(args.agent_id as string);
    }

    case TOOL_NAMES.RENEW_CREDENTIAL: {
      return client.renewCredential(args.agent_id as string);
    }

    case TOOL_NAMES.UPDATE_SCOPE_POLICIES: {
      return client.updateScopePolicies(
        args.agent_id as string,
        args.scope_policies as Record<string, { permissions?: string[] }>,
      );
    }

    case TOOL_NAMES.GET_PUBLIC_KEY: {
      return asV2(client).getPublicKey();
    }

    case TOOL_NAMES.VERIFY_CONSENT_LOCALLY: {
      return asV2(client).verifyConsentLocally(
        args.consent_token as string,
        args.broker_public_key as string,
      );
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Resource handler ──

async function handleResourceRead(
  uri: string,
  client: ParafeClient,
  config: ServerConfig,
): Promise<string> {
  if (uri === 'parafe://agent') {
    return JSON.stringify(client.credentialStatus(), null, 2);
  }

  if (uri === 'parafe://public-key') {
    return JSON.stringify(await asV2(client).getPublicKey(), null, 2);
  }

  // parafe://session/{sessionId}
  const sessionMatch = uri.match(/^parafe:\/\/session\/(.+)$/);
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    // Fetch session details via broker API
    const res = await fetch(`${config.brokerUrl}/admin/sessions/${sessionId}`, {
      headers: {
        'User-Agent': `@getparafe/mcp-server/${VERSION}`,
        'x-api-key': config.apiKey,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch session ${sessionId}: ${res.status}`);
    }
    return JSON.stringify(await res.json(), null, 2);
  }

  throw new Error(`Unknown resource: ${uri}`);
}

// ── Server factory ──

// ── Wrap a tool handler with error handling ──

function wrapHandler(
  toolName: string,
  client: ParafeClient,
  config: ServerConfig,
) {
  return async (args: ToolArgs) => {
    try {
      const result = await handleToolCall(toolName, args, client, config);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const error = err as Error;
      const detail: Record<string, unknown> = { error: error.message };
      if (err instanceof ParafeError) {
        detail.code = (err as ParafeError & { code?: string }).code;
        detail.statusCode = (err as ParafeError & { statusCode?: number }).statusCode;
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(detail, null, 2) }],
        isError: true,
      };
    }
  };
}

// Look up a tool description by name
function desc(name: string): string {
  return TOOL_DEFINITIONS.find((t) => t.name === name)?.description ?? '';
}

export function createServer(config: ServerConfig) {
  const server = new McpServer({
    name: '@getparafe/mcp-server',
    version: VERSION,
  });

  const client = new ParafeClient({
    brokerUrl: config.brokerUrl,
    apiKey: config.apiKey,
  });

  // Register tools with Zod schemas
  const h = (name: string) => wrapHandler(name, client, config);

  server.tool(TOOL_NAMES.DISCOVER, desc(TOOL_NAMES.DISCOVER), schemas.discover, h(TOOL_NAMES.DISCOVER));
  server.tool(TOOL_NAMES.REGISTER, desc(TOOL_NAMES.REGISTER), schemas.register, h(TOOL_NAMES.REGISTER));
  server.tool(TOOL_NAMES.INITIATE_HANDSHAKE, desc(TOOL_NAMES.INITIATE_HANDSHAKE), schemas.initiate_handshake, h(TOOL_NAMES.INITIATE_HANDSHAKE));
  server.tool(TOOL_NAMES.COMPLETE_HANDSHAKE, desc(TOOL_NAMES.COMPLETE_HANDSHAKE), schemas.complete_handshake, h(TOOL_NAMES.COMPLETE_HANDSHAKE));
  server.tool(TOOL_NAMES.ESCALATE_SCOPE, desc(TOOL_NAMES.ESCALATE_SCOPE), schemas.escalate_scope, h(TOOL_NAMES.ESCALATE_SCOPE));
  server.tool(TOOL_NAMES.VERIFY_CONSENT, desc(TOOL_NAMES.VERIFY_CONSENT), schemas.verify_consent, h(TOOL_NAMES.VERIFY_CONSENT));
  server.tool(TOOL_NAMES.RECORD_ACTION, desc(TOOL_NAMES.RECORD_ACTION), schemas.record_action, h(TOOL_NAMES.RECORD_ACTION));
  server.tool(TOOL_NAMES.CLOSE_SESSION, desc(TOOL_NAMES.CLOSE_SESSION), schemas.close_session, h(TOOL_NAMES.CLOSE_SESSION));
  server.tool(TOOL_NAMES.VERIFY_RECEIPT, desc(TOOL_NAMES.VERIFY_RECEIPT), schemas.verify_receipt, h(TOOL_NAMES.VERIFY_RECEIPT));
  server.tool(TOOL_NAMES.REVOKE_AGENT, desc(TOOL_NAMES.REVOKE_AGENT), schemas.revoke_agent, h(TOOL_NAMES.REVOKE_AGENT));
  server.tool(TOOL_NAMES.RENEW_CREDENTIAL, desc(TOOL_NAMES.RENEW_CREDENTIAL), schemas.renew_credential, h(TOOL_NAMES.RENEW_CREDENTIAL));
  server.tool(TOOL_NAMES.UPDATE_SCOPE_POLICIES, desc(TOOL_NAMES.UPDATE_SCOPE_POLICIES), schemas.update_scope_policies, h(TOOL_NAMES.UPDATE_SCOPE_POLICIES));
  server.tool(TOOL_NAMES.GET_PUBLIC_KEY, desc(TOOL_NAMES.GET_PUBLIC_KEY), h(TOOL_NAMES.GET_PUBLIC_KEY));
  server.tool(TOOL_NAMES.VERIFY_CONSENT_LOCALLY, desc(TOOL_NAMES.VERIFY_CONSENT_LOCALLY), schemas.verify_consent_locally, h(TOOL_NAMES.VERIFY_CONSENT_LOCALLY));

  // Register static resources
  for (const resDef of RESOURCE_DEFINITIONS) {
    server.resource(
      resDef.name,
      resDef.uri,
      { description: resDef.description, mimeType: resDef.mimeType },
      async () => ({
        contents: [{
          uri: resDef.uri,
          mimeType: resDef.mimeType,
          text: await handleResourceRead(resDef.uri, client, config),
        }],
      }),
    );
  }

  // Register resource templates
  for (const tmpl of RESOURCE_TEMPLATES) {
    server.resource(
      tmpl.name,
      tmpl.uriTemplate,
      { description: tmpl.description, mimeType: tmpl.mimeType },
      async (uri: URL) => {
        const fullUri = uri.toString();
        return {
          contents: [{
            uri: fullUri,
            mimeType: tmpl.mimeType,
            text: await handleResourceRead(fullUri, client, config),
          }],
        };
      },
    );
  }

  return { server, client, tryLoadCredentials: () => tryLoadCredentials(client, config) };
}
