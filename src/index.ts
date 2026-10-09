/**
 * @getparafe/mcp-server — MCP tool server for the Parafe Trust Broker
 *
 * Exposes Parafe trust operations (agent registration, mutual authentication,
 * consent verification, session management, receipts) as MCP tools.
 */

import { createRequire } from 'node:module';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ParafeClient, ParafeError, ForbiddenError, ConflictError, type ActionErrorCode, type ReceiptKind } from '@getparafe/sdk';
import { TOOL_DEFINITIONS, TOOL_NAMES, buildAuthorization, buildVerifyMandateOptions, buildAp2ReceiptOptions } from './tools.js';
import { RESOURCE_DEFINITIONS, RESOURCE_TEMPLATES } from './resources.js';
import { schemas } from './schemas.js';

// ── Package version (read from package.json: ../package.json from both src/ and dist/) ──

const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

// ── Configuration ──

export interface ServerConfig {
  brokerUrl: string;
  /** Optional since 0.5.0: without one, parafe_register self-registers (no operator or principal) and returns a claim link. */
  apiKey?: string;
  credentialsPath: string;
  credentialsPassphrase?: string;
}

export function loadConfig(): ServerConfig {
  const brokerUrl = process.env.PARAFE_BROKER_URL;
  const apiKey = process.env.PARAFE_API_KEY;

  if (!brokerUrl) {
    throw new Error('PARAFE_BROKER_URL environment variable is required');
  }
  // No API key: the agent registers itself (self_registered, no operator or principal) and the
  // person it acts for claims it through a claim link (parafe_create_claim_link).

  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return {
    brokerUrl,
    apiKey: apiKey || undefined,
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

// A credentials file that exists but couldn't be read (wrong passphrase, damaged file).
const credentialsLoadErrors = new WeakMap<ParafeClient, string>();
// Clients that loaded or wrote the credentials file: only they may overwrite it. An existing
// file holds an identity that may still be wanted, so nothing else replaces it (P-47).
const credentialsFileOwners = new WeakSet<ParafeClient>();
// parafe_register runs one call at a time per client.
const registerLocks = new WeakMap<ParafeClient, Promise<void>>();

async function fileExists(path: string): Promise<boolean> {
  const { access } = await import('node:fs/promises');
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Why this client may not write the credentials file, or null if it may. */
async function credentialsFileBlocked(client: ParafeClient, config: ServerConfig): Promise<string | null> {
  if (!config.credentialsPassphrase || credentialsFileOwners.has(client)) return null;
  if (!(await fileExists(config.credentialsPath))) return null;
  const loadError = credentialsLoadErrors.get(client);
  return loadError
    ? `The credentials file ${config.credentialsPath} exists but couldn't be read (${loadError}). Fix PARAFE_CREDENTIALS_PASSPHRASE and restart, or move the file away to register a new agent.`
    : `The credentials file ${config.credentialsPath} already exists and wasn't loaded. Restart the server to load it, or move it away to register a new agent.`;
}

async function tryLoadCredentials(client: ParafeClient, config: ServerConfig): Promise<void> {
  if (!config.credentialsPassphrase) return;

  if (!(await fileExists(config.credentialsPath))) return; // No file yet: that's fine
  try {
    await client.loadCredentials(config.credentialsPath, config.credentialsPassphrase);
    credentialsFileOwners.add(client);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    credentialsLoadErrors.set(client, message);
    console.error(`Could not read the credentials file ${config.credentialsPath} (${message}). Check PARAFE_CREDENTIALS_PASSPHRASE. The file won't be overwritten.`);
  }
}

/**
 * S-69: a consent token must be for the loaded agent, unless the loaded agent is
 * its initiator (checking its own token). Checked here as well as in the SDK, so
 * it holds with any SDK version this server accepts.
 */
export function checkConsentAudience(client: ParafeClient, consentToken: string): void {
  const status = client.credentialStatus();
  if (!status.loaded) return;
  let claims: { sub?: unknown; target_agent_id?: unknown };
  try {
    claims = JSON.parse(Buffer.from(consentToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return; // not a JWT: the verification itself refuses it
  }
  if (claims.sub === status.agentId || claims.target_agent_id === status.agentId) return;
  throw new Error(`wrong_audience: this consent token was issued for ${String(claims.target_agent_id)}, not the loaded agent ${status.agentId}. Don't act on it.`);
}

async function trySaveCredentials(client: ParafeClient, config: ServerConfig): Promise<void> {
  if (!config.credentialsPassphrase) return;
  const blocked = await credentialsFileBlocked(client, config);
  if (blocked) throw new Error(blocked);

  await ensureDirectoryExists(config.credentialsPath);
  await client.saveCredentials(config.credentialsPath, config.credentialsPassphrase);
  credentialsFileOwners.add(client);
}

// ── Tool handler ──

type ToolArgs = Record<string, unknown>;

async function registerAgent(args: ToolArgs, client: ParafeClient, config: ServerConfig): Promise<unknown> {
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
  // Check before registering: an agent whose credentials can't be saved would be orphaned.
  const blocked = await credentialsFileBlocked(client, config);
  if (blocked) throw new Error(blocked);

  const result = await client.register({
    ...(args.name ? { name: args.name as string } : {}),
    type: args.type as 'personal' | 'enterprise',
    ...(args.principal_name ? { principalName: args.principal_name as string } : {}),
    ...(args.acts_for_ref ? { actsFor: { ref: args.acts_for_ref as string } } : {}),
    keyAlgorithm: (args.key_algorithm as 'Ed25519' | 'P-256' | undefined) ?? 'P-256',
    scopePolicies: args.scope_policies as Record<string, {
      permissions?: string[];
      exclusions?: string[];
      minimum_authorization_modality?: 'autonomous' | 'attested' | 'verified';
      minimum_identity_assurance?: 'self_registered' | 'registered' | 'claimed';
      minimum_verification_tier?: 'unverified' | 'email_verified' | 'domain_verified' | 'org_verified';
      minimum_initiator_proof?: 'pop' | 'credential';
      minimum_tenure_days?: number;
      minimum_session_completion_rate?: number;
      maximum_denied_requests_30d?: number;
      minimum_unique_counterparties?: number;
      minimum_handshake_success_rate?: number;
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
  // Self-registered: show the person the url and tell them its code.
  if (result.claimLink) response.claimLink = result.claimLink;
  if (persistenceWarning) {
    response.warning = persistenceWarning;
  }
  return response;
}

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
      // One registration at a time per client: a second concurrent call (HTTP transport)
      // waits, then finds the first one's credentials loaded.
      const previous = registerLocks.get(client) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((resolve) => { release = resolve; });
      registerLocks.set(client, previous.then(() => mine));
      await previous;
      try {
        return await registerAgent(args, client, config);
      } finally {
        release();
      }
    }

    case TOOL_NAMES.INITIATE_HANDSHAKE: {
      const modality = (args.authorization_modality as string | undefined) ?? 'autonomous';
      if (modality !== 'autonomous' && !args.authorization_evidence) {
        throw new Error(`authorization_evidence is required when modality is '${modality}'.`);
      }

      const authorization = buildAuthorization(
        args.authorization_modality as string | undefined,
        args.authorization_evidence as Parameters<typeof buildAuthorization>[1],
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
        args.authorization_evidence as Parameters<typeof buildAuthorization>[1],
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
      checkConsentAudience(client, args.consent_token as string);
      return client.verifyConsent({
        consentToken: args.consent_token as string,
        action: args.action as string,
        sessionId: args.session_id as string,
        ...(args.presentation_proof ? { presentationProof: args.presentation_proof as string } : {}),
      });
    }

    case TOOL_NAMES.RECORD_ACTION_RECEIPT: {
      if (!client.credentialStatus().loaded) {
        throw new Error('No credentials loaded. Register an agent first using parafe_register.');
      }
      const result = (args.result as 'success' | 'error' | undefined) ?? 'success';
      if (result === 'error' && !args.error) {
        throw new Error("result 'error' needs error: not_permitted, excluded, consent_invalid, consent_expired, proof_invalid or failed");
      }
      return client.recordActionReceipt({
        sessionId: args.session_id as string,
        consentToken: args.consent_token as string,
        action: args.action as string,
        result,
        ...(result === 'error' ? { error: args.error as ActionErrorCode } : {}),
        ...(args.error_description ? { errorDescription: args.error_description as string } : {}),
        ...(args.details ? { details: args.details } : {}),
        ...(args.business_ref ? { businessRef: args.business_ref as string } : {}),
      });
    }

    case TOOL_NAMES.FILE_ACTION_RECEIPT: {
      return client.fileActionReceipt(args.session_id as string, args.receipt as string, args.kind ? { kind: args.kind as ReceiptKind } : {});
    }

    case TOOL_NAMES.GET_ACTION_RECEIPTS: {
      return client.getActionReceipts(args.session_id as string);
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
      const result = await client.renewCredential(args.agent_id as string);
      // The broker revokes the old credential on renewal: save the new one (P-46).
      const loaded = client.credentialStatus();
      if (result.renewed && loaded.loaded && loaded.agentId === args.agent_id) {
        try {
          await trySaveCredentials(client, config);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Failed to persist renewed credentials: ${msg}`);
          return { ...result, warning: 'The renewed credential was not saved to disk, and the old one is revoked. Store it manually before restarting.' };
        }
      }
      return result;
    }

    case TOOL_NAMES.CREATE_CLAIM_LINK: {
      return client.createClaimLink();
    }

    case TOOL_NAMES.GET_CLAIM_STATUS: {
      // One wait per call: MCP clients time out long tool calls, so the agent calls again.
      return client.getClaimStatus({ waitSeconds: (args.wait_seconds as number | undefined) ?? 25 });
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
      checkConsentAudience(client, args.consent_token as string);
      // The broker's JWKS is fetched and cached; the retired Ed25519 key no
      // longer verifies tokens (broker S-72, 2026-10-09).
      return client.verifyConsentLocally(args.consent_token as string);
    }

    case TOOL_NAMES.GET_AGENT_METRICS: {
      return client.getAgentMetrics(args.agent_id as string);
    }

    case TOOL_NAMES.VERIFY_MANDATE: {
      return client.verifyMandate(buildVerifyMandateOptions(args));
    }

    case TOOL_NAMES.RECORD_AP2_RECEIPT: {
      return client.recordAp2Receipt(args.session_id as string, buildAp2ReceiptOptions(args));
    }

    case TOOL_NAMES.SIGN_AP2_RECEIPT: {
      return client.signAp2Receipt(buildAp2ReceiptOptions(args));
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

  // parafe://session/{sessionId}: what a participant can read (P-45: this used to call an admin route)
  const sessionMatch = uri.match(/^parafe:\/\/session\/(.+)$/);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    const actionReceipts = await client.getActionReceipts(sessionId);
    let receipt: unknown = null;
    try {
      receipt = await client.getReceipt(sessionId);
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err; // 409: not closed yet
    }
    return JSON.stringify({ sessionId, closed: receipt !== null, receipt, actionReceipts }, null, 2);
  }

  throw new Error(`Unknown resource: ${uri}`);
}

// ── Server factory ──

// ── Wrap a tool handler with error handling ──

export function wrapHandler(
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
      // A refusal for identity or tier carries a claim link and a hint; a reputation floor says what it measured.
      if (err instanceof ForbiddenError) {
        if (err.claim) detail.claim = err.claim;
        if (err.hint) detail.hint = err.hint;
        if (err.reputation) detail.reputation = err.reputation;
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
  const client = new ParafeClient({
    brokerUrl: config.brokerUrl,
    apiKey: config.apiKey,
  });

  return {
    server: buildServer(client, config),
    client,
    /** A fresh McpServer on the same client (the HTTP transport needs one per request). */
    newServer: () => buildServer(client, config),
    tryLoadCredentials: () => tryLoadCredentials(client, config),
  };
}

function buildServer(client: ParafeClient, config: ServerConfig): McpServer {
  const server = new McpServer({
    name: '@getparafe/mcp-server',
    version: VERSION,
  });

  // Register tools with Zod schemas
  const h = (name: string) => wrapHandler(name, client, config);

  server.tool(TOOL_NAMES.DISCOVER, desc(TOOL_NAMES.DISCOVER), schemas.discover, h(TOOL_NAMES.DISCOVER));
  server.tool(TOOL_NAMES.REGISTER, desc(TOOL_NAMES.REGISTER), schemas.register, h(TOOL_NAMES.REGISTER));
  server.tool(TOOL_NAMES.INITIATE_HANDSHAKE, desc(TOOL_NAMES.INITIATE_HANDSHAKE), schemas.initiate_handshake, h(TOOL_NAMES.INITIATE_HANDSHAKE));
  server.tool(TOOL_NAMES.COMPLETE_HANDSHAKE, desc(TOOL_NAMES.COMPLETE_HANDSHAKE), schemas.complete_handshake, h(TOOL_NAMES.COMPLETE_HANDSHAKE));
  server.tool(TOOL_NAMES.ESCALATE_SCOPE, desc(TOOL_NAMES.ESCALATE_SCOPE), schemas.escalate_scope, h(TOOL_NAMES.ESCALATE_SCOPE));
  server.tool(TOOL_NAMES.VERIFY_CONSENT, desc(TOOL_NAMES.VERIFY_CONSENT), schemas.verify_consent, h(TOOL_NAMES.VERIFY_CONSENT));
  server.tool(TOOL_NAMES.RECORD_ACTION_RECEIPT, desc(TOOL_NAMES.RECORD_ACTION_RECEIPT), schemas.record_action_receipt, h(TOOL_NAMES.RECORD_ACTION_RECEIPT));
  server.tool(TOOL_NAMES.FILE_ACTION_RECEIPT, desc(TOOL_NAMES.FILE_ACTION_RECEIPT), schemas.file_action_receipt, h(TOOL_NAMES.FILE_ACTION_RECEIPT));
  server.tool(TOOL_NAMES.GET_ACTION_RECEIPTS, desc(TOOL_NAMES.GET_ACTION_RECEIPTS), schemas.get_action_receipts, h(TOOL_NAMES.GET_ACTION_RECEIPTS));
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
  server.tool(TOOL_NAMES.CREATE_CLAIM_LINK, desc(TOOL_NAMES.CREATE_CLAIM_LINK), schemas.create_claim_link, h(TOOL_NAMES.CREATE_CLAIM_LINK));
  server.tool(TOOL_NAMES.GET_CLAIM_STATUS, desc(TOOL_NAMES.GET_CLAIM_STATUS), schemas.get_claim_status, h(TOOL_NAMES.GET_CLAIM_STATUS));
  server.tool(TOOL_NAMES.VERIFY_MANDATE, desc(TOOL_NAMES.VERIFY_MANDATE), schemas.verify_mandate, h(TOOL_NAMES.VERIFY_MANDATE));
  server.tool(TOOL_NAMES.RECORD_AP2_RECEIPT, desc(TOOL_NAMES.RECORD_AP2_RECEIPT), schemas.record_ap2_receipt, h(TOOL_NAMES.RECORD_AP2_RECEIPT));
  server.tool(TOOL_NAMES.SIGN_AP2_RECEIPT, desc(TOOL_NAMES.SIGN_AP2_RECEIPT), schemas.sign_ap2_receipt, h(TOOL_NAMES.SIGN_AP2_RECEIPT));

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
      new ResourceTemplate(tmpl.uriTemplate, { list: undefined }),
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

  return server;
}
