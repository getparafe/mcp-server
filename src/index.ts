/**
 * @getparafe/mcp-server — MCP tool server for the Parafe Trust Broker
 *
 * Exposes Parafe trust operations (agent registration, mutual authentication,
 * consent verification, session management, receipts) as MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ParafeClient, ParafeError } from '@getparafe/sdk';
import { TOOL_DEFINITIONS, TOOL_NAMES, buildAuthorization } from './tools.js';
import { RESOURCE_DEFINITIONS, RESOURCE_TEMPLATES } from './resources.js';
import { schemas } from './schemas.js';

// ── Package version (injected at build or read from package.json) ──

const VERSION = '0.4.0';

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

// Parafe A2A extension URIs, newest first. The v1 URIs still appear on older agent cards.
export const PARAFE_EXTENSION_URIS = [
  'https://parafe.ai/extensions/a2a/v2',
  'https://github.com/getparafe/parafe-a2a-extension/v1',
  'https://parafe.dev/a2a-extension/v1',
];

// A2A v1.0 serves the card at agent-card.json; v0.3 agents used agent.json.
const AGENT_CARD_PATHS = ['/.well-known/agent-card.json', '/.well-known/agent.json'];

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

function candidateCardUrls(url: string): string[] {
  // Bare domains (no scheme) get https://
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    parsed = new URL(`https://${url}`);
  }
  // A bare origin means "find the card": try the v1.0 path, then the v0.3 path
  if (parsed.pathname === '/' || parsed.pathname === '') {
    return AGENT_CARD_PATHS.map((path) => `${parsed.origin}${path}`);
  }
  return [parsed.toString()];
}

/** The agent's A2A endpoints: v1.0 `supportedInterfaces`, or the v0.3 top-level `url`. */
function agentInterfaces(card: Record<string, unknown>): Array<Record<string, string | null>> {
  if (Array.isArray(card.supportedInterfaces)) {
    return (card.supportedInterfaces as Array<Record<string, unknown>>)
      .filter((i) => i && typeof i.url === 'string')
      .map((i) => ({
        url: i.url as string,
        protocol_binding: typeof i.protocolBinding === 'string' ? i.protocolBinding : null,
        protocol_version: typeof i.protocolVersion === 'string' ? i.protocolVersion : null,
      }));
  }
  if (typeof card.url === 'string') {
    return [{
      url: card.url,
      protocol_binding: typeof card.preferredTransport === 'string' ? card.preferredTransport : 'JSONRPC',
      protocol_version: typeof card.protocolVersion === 'string' ? card.protocolVersion : null,
    }];
  }
  return [];
}

export async function discoverAgentCard(url: string): Promise<Record<string, unknown>> {
  const candidates = candidateCardUrls(url);

  let res: Response | undefined;
  let cardUrl = candidates[0]!;
  for (cardUrl of candidates) {
    res = await fetch(cardUrl, {
      headers: {
        'User-Agent': `@getparafe/mcp-server/${VERSION}`,
        Accept: 'application/json',
        // Without this, servers that also speak v0.3 return the v0.3 card shape
        'A2A-Version': '1.0',
      },
    });
    // Only fall through to the next well-known path when this one doesn't exist
    if (res.status !== 404) break;
  }

  if (!res || !res.ok) {
    throw new Error(`Failed to fetch agent card from ${cardUrl}: ${res?.status} ${res?.statusText}`);
  }

  const card = await res.json() as Record<string, unknown>;
  const interfaces = agentInterfaces(card);

  // Extract Parafe extension (prefer the newest URI if a card lists more than one)
  const capabilities = card.capabilities as { extensions?: AgentCardExtension[] } | undefined;
  const extensions = capabilities?.extensions ?? [];
  const parafeExt = PARAFE_EXTENSION_URIS
    .map((uri) => extensions.find((ext) => ext?.uri === uri))
    .find((ext) => ext !== undefined);

  if (!parafeExt) {
    return {
      parafe_required: false,
      agent_name: card.name || null,
      card_url: cardUrl,
      interfaces,
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
    extension_uri: parafeExt.uri,
    card_url: cardUrl,
    interfaces,
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
        keyAlgorithm: args.key_algorithm as 'Ed25519' | 'P-256' | undefined,
        scopePolicies: args.scope_policies as Record<string, {
          permissions?: string[];
          exclusions?: string[];
          minimum_authorization_modality?: 'autonomous' | 'attested' | 'verified';
          minimum_identity_assurance?: 'self_registered' | 'registered';
          minimum_verification_tier?: 'unverified' | 'email_verified' | 'domain_verified' | 'org_verified';
          minimum_initiator_proof?: 'pop' | 'credential';
          description?: string;
        }> | undefined,
      });

      // Auto-save credentials
      let persistenceWarning: string | undefined;
      try {
        await trySaveCredentials(client, config);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to persist credentials: ${msg}`);
        persistenceWarning = 'Credentials were not saved to disk. Store them manually.';
      }

      // Return without exposing the private key
      const response: Record<string, unknown> = {
        agentId: result.agentId,
        did: result.did,
        publicKey: result.publicKey,
        credentialSdJwt: result.credentialSdJwt,
        verificationTier: result.verificationTier,
        identityAssurance: result.identityAssurance,
        issuedAt: result.issuedAt,
        expiresAt: result.expiresAt,
      };
      if (persistenceWarning) {
        response.warning = persistenceWarning;
      }
      return response;
    }

    case TOOL_NAMES.INITIATE_HANDSHAKE: {
      const modality = (args.authorization_modality as string | undefined) ?? 'autonomous';
      if (modality !== 'autonomous' && !args.authorization_evidence) {
        throw new Error(`authorization_evidence is required when modality is '${modality}'.`);
      }

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
      const escalateModality = (args.authorization_modality as string | undefined) ?? 'autonomous';
      if (escalateModality !== 'autonomous' && !args.authorization_evidence) {
        throw new Error(`authorization_evidence is required when modality is '${escalateModality}'.`);
      }

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
        ...(args.presentation_proof ? { presentationProof: args.presentation_proof as string } : {}),
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
      // A JWS string, an SDK receipt (its `receipt` field is the JWS), or a v1 receipt object.
      const r = args.receipt as string | Record<string, unknown>;
      if (typeof r === 'string') return client.verifyReceipt(r);
      if (typeof r.receipt === 'string') return client.verifyReceipt(r.receipt);
      const issued = (r.issued ?? r.receipt ?? r) as Record<string, unknown>;
      return client.verifyReceipt({ formatVersion: 1, receiptId: issued.receipt_id as string, sessionId: issued.session_id as string, issued });
    }

    case TOOL_NAMES.GET_SESSION_RECEIPT: {
      return client.getReceipt(args.session_id as string);
    }

    case TOOL_NAMES.CREATE_PRESENTATION_PROOF: {
      return { proof: await client.createPresentationProof(args.consent_token as string, args.message_id as string | undefined) };
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
      return client.getJwks();
    }

    case TOOL_NAMES.VERIFY_CONSENT_LOCALLY: {
      return client.verifyConsentLocally(
        args.consent_token as string,
        (args.broker_public_key as string | undefined) || undefined,
      );
    }

    case TOOL_NAMES.GET_AGENT_METRICS: {
      return client.getAgentMetrics(args.agent_id as string);
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
    return JSON.stringify(await client.getJwks(), null, 2);
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
  server.tool(TOOL_NAMES.GET_PUBLIC_KEY, desc(TOOL_NAMES.GET_PUBLIC_KEY), schemas.get_public_key, h(TOOL_NAMES.GET_PUBLIC_KEY));
  server.tool(TOOL_NAMES.VERIFY_CONSENT_LOCALLY, desc(TOOL_NAMES.VERIFY_CONSENT_LOCALLY), schemas.verify_consent_locally, h(TOOL_NAMES.VERIFY_CONSENT_LOCALLY));
  server.tool(TOOL_NAMES.GET_AGENT_METRICS, desc(TOOL_NAMES.GET_AGENT_METRICS), schemas.get_agent_metrics, h(TOOL_NAMES.GET_AGENT_METRICS));
  server.tool(TOOL_NAMES.GET_SESSION_RECEIPT, desc(TOOL_NAMES.GET_SESSION_RECEIPT), schemas.get_session_receipt, h(TOOL_NAMES.GET_SESSION_RECEIPT));
  server.tool(TOOL_NAMES.CREATE_PRESENTATION_PROOF, desc(TOOL_NAMES.CREATE_PRESENTATION_PROOF), schemas.create_presentation_proof, h(TOOL_NAMES.CREATE_PRESENTATION_PROOF));

  // Register static resources
  for (const resDef of RESOURCE_DEFINITIONS) {
    server.resource(
      resDef.name,
      resDef.uri,
      { description: resDef.description, mimeType: resDef.mimeType },
      async () => {
        try {
          return {
            contents: [{
              uri: resDef.uri,
              mimeType: resDef.mimeType,
              text: await handleResourceRead(resDef.uri, client, config),
            }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new McpError(ErrorCode.InternalError, `Resource read failed for ${resDef.uri}: ${message}`);
        }
      },
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
        try {
          return {
            contents: [{
              uri: fullUri,
              mimeType: tmpl.mimeType,
              text: await handleResourceRead(fullUri, client, config),
            }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new McpError(ErrorCode.InternalError, `Resource read failed for ${fullUri}: ${message}`);
        }
      },
    );
  }

  return { server, client, tryLoadCredentials: () => tryLoadCredentials(client, config) };
}
