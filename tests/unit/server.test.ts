/**
 * Unit tests for @getparafe/mcp-server
 *
 * These are unit tests with mocked SDK and HTTP calls.
 * They verify tool definitions, handler routing, authorization building,
 * credential lifecycle, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOOL_DEFINITIONS, TOOL_NAMES, buildAuthorization, buildVerifyMandateOptions, buildAp2ReceiptOptions } from '../../src/tools.js';
import { RESOURCE_DEFINITIONS, RESOURCE_TEMPLATES } from '../../src/resources.js';
import { loadConfig, createServer, discoverAgentCard, PARAFE_EXTENSION_URIS, type ServerConfig } from '../../src/index.js';

// ── Tool definition tests ──

describe('Tool definitions', () => {
  it('should define exactly 23 tools', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(23);
  });

  it('adds the AP2 tools (0.8.0)', () => {
    const find = (n: string) => TOOL_DEFINITIONS.find((t) => t.name === n);
    expect(find(TOOL_NAMES.VERIFY_MANDATE)?.inputSchema.required).toEqual(['mandate']);
    expect(find(TOOL_NAMES.RECORD_AP2_RECEIPT)?.inputSchema.required).toEqual(['session_id', 'kind']);
    expect(find(TOOL_NAMES.SIGN_AP2_RECEIPT)?.inputSchema.required).toEqual(['kind']);
    expect(find(TOOL_NAMES.RECORD_AP2_RECEIPT)?.description).toContain('P-256');
  });

  it('replaces parafe_record_action with action receipt tools (0.6.0)', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).not.toContain('parafe_record_action');
    const record = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.RECORD_ACTION_RECEIPT);
    expect(record?.inputSchema.required).toEqual(['session_id', 'consent_token', 'action']);
    expect(record?.description).toContain('excluded');
    expect(record?.description).toContain('before the session is closed');
    const file = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.FILE_ACTION_RECEIPT);
    expect(file?.inputSchema.required).toEqual(['session_id', 'receipt']);
    const list = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.GET_ACTION_RECEIPTS);
    expect(list?.inputSchema.required).toEqual(['session_id']);
  });

  it('adds parafe_get_session_receipt and parafe_create_presentation_proof (0.4.0)', () => {
    const receipt = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.GET_SESSION_RECEIPT);
    expect(receipt?.inputSchema.required).toEqual(['session_id']);
    const proof = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.CREATE_PRESENTATION_PROOF);
    expect(proof?.inputSchema.required).toEqual(['consent_token']);
  });

  it('should have unique tool names', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should have all expected tool names', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain(TOOL_NAMES.DISCOVER);
    expect(names).toContain(TOOL_NAMES.REGISTER);
    expect(names).toContain(TOOL_NAMES.INITIATE_HANDSHAKE);
    expect(names).toContain(TOOL_NAMES.COMPLETE_HANDSHAKE);
    expect(names).toContain(TOOL_NAMES.ESCALATE_SCOPE);
    expect(names).toContain(TOOL_NAMES.VERIFY_CONSENT);
    expect(names).toContain(TOOL_NAMES.RECORD_ACTION_RECEIPT);
    expect(names).toContain(TOOL_NAMES.FILE_ACTION_RECEIPT);
    expect(names).toContain(TOOL_NAMES.GET_ACTION_RECEIPTS);
    expect(names).toContain(TOOL_NAMES.CLOSE_SESSION);
    expect(names).toContain(TOOL_NAMES.VERIFY_RECEIPT);
    expect(names).toContain(TOOL_NAMES.REVOKE_AGENT);
    expect(names).toContain(TOOL_NAMES.RENEW_CREDENTIAL);
    expect(names).toContain(TOOL_NAMES.UPDATE_SCOPE_POLICIES);
    expect(names).toContain(TOOL_NAMES.GET_PUBLIC_KEY);
    expect(names).toContain(TOOL_NAMES.VERIFY_CONSENT_LOCALLY);
    expect(names).toContain(TOOL_NAMES.VERIFY_MANDATE);
    expect(names).toContain(TOOL_NAMES.SIGN_AP2_RECEIPT);
    expect(names).toContain(TOOL_NAMES.RECORD_AP2_RECEIPT);
  });

  it('every tool should have a non-empty description', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('every tool should have a valid inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema).toHaveProperty('properties');
      expect(tool.inputSchema).toHaveProperty('required');
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it('parafe_discover should require agent_card_url', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.DISCOVER);
    expect(tool?.inputSchema.required).toContain('agent_card_url');
  });

  it('parafe_register requires only type; name, principal_name and acts_for_ref are optional (broker SPEC-002 decision 10)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.REGISTER);
    expect(tool?.inputSchema.required).toEqual(['type']);
    expect(tool?.inputSchema.properties).toHaveProperty('name');
    expect(tool?.inputSchema.properties).toHaveProperty('principal_name');
    expect(schemas.register.name.isOptional()).toBe(true);
    expect(schemas.register.principal_name.isOptional()).toBe(true);
    expect(tool?.inputSchema.required).not.toContain('owner');
    expect(tool?.inputSchema.properties).toHaveProperty('acts_for_ref');
    expect(tool?.inputSchema.properties).not.toHaveProperty('owner');
  });

  it('parafe_initiate_handshake should require target_agent_id, scope, permissions', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.INITIATE_HANDSHAKE);
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['target_agent_id', 'scope', 'permissions']),
    );
  });

  it('parafe_complete_handshake should require handshake_id and challenge_nonce', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.COMPLETE_HANDSHAKE);
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['handshake_id', 'challenge_nonce']),
    );
  });

  it('parafe_escalate_scope should require session_id, target_agent_id, scope, permissions', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.ESCALATE_SCOPE);
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['session_id', 'target_agent_id', 'scope', 'permissions']),
    );
  });

  it('parafe_close_session should require session_id', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.CLOSE_SESSION);
    expect(tool?.inputSchema.required).toContain('session_id');
  });

  it('parafe_create_claim_link takes no input (it acts as the loaded agent)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.CREATE_CLAIM_LINK);
    expect(tool?.inputSchema.required).toHaveLength(0);
  });

  it('parafe_get_public_key should have no required fields', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.GET_PUBLIC_KEY);
    expect(tool?.inputSchema.required).toHaveLength(0);
  });

  it('parafe_verify_consent_locally requires only consent_token (the broker keys are fetched)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.VERIFY_CONSENT_LOCALLY);
    expect(tool?.inputSchema.required).toEqual(['consent_token']);
  });

  it('handshake tools should include authorization_evidence with timestamp field', () => {
    for (const name of [TOOL_NAMES.INITIATE_HANDSHAKE, TOOL_NAMES.ESCALATE_SCOPE]) {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
      const evidence = tool?.inputSchema.properties.authorization_evidence as Record<string, unknown>;
      expect(evidence).toBeDefined();
      const props = evidence.properties as Record<string, unknown>;
      expect(props).toHaveProperty('instruction');
      expect(props).toHaveProperty('platform');
      expect(props).toHaveProperty('timestamp');
      expect(props).toHaveProperty('ap2_mandate');
      expect(props).not.toHaveProperty('user_signature');
    }
  });
});

// ── Resource definition tests ──

describe('Resource definitions', () => {
  it('should define 2 static resources', () => {
    expect(RESOURCE_DEFINITIONS).toHaveLength(2);
  });

  it('should define 1 resource template', () => {
    expect(RESOURCE_TEMPLATES).toHaveLength(1);
  });

  it('should have parafe://agent resource', () => {
    const agent = RESOURCE_DEFINITIONS.find((r) => r.uri === 'parafe://agent');
    expect(agent).toBeDefined();
    expect(agent?.mimeType).toBe('application/json');
  });

  it('should have parafe://public-key resource', () => {
    const pk = RESOURCE_DEFINITIONS.find((r) => r.uri === 'parafe://public-key');
    expect(pk).toBeDefined();
  });

  it('should have session resource template', () => {
    const session = RESOURCE_TEMPLATES.find(
      (r) => r.uriTemplate === 'parafe://session/{sessionId}',
    );
    expect(session).toBeDefined();
  });
});

// ── Authorization builder tests ──

describe('buildAuthorization', () => {
  it('should return autonomous for no modality', () => {
    const auth = buildAuthorization();
    expect(auth).toEqual({ modality: 'autonomous' });
  });

  it('should return autonomous for explicit "autonomous"', () => {
    const auth = buildAuthorization('autonomous');
    expect(auth).toEqual({ modality: 'autonomous' });
  });

  it('should build attested authorization with evidence', () => {
    const auth = buildAuthorization('attested', {
      instruction: 'Book my flight',
      platform: 'travel-app',
      timestamp: '2026-03-28T10:00:00Z',
    });
    expect(auth.modality).toBe('attested');
    expect('evidence' in auth && auth.evidence).toEqual({
      instruction: 'Book my flight',
      platform: 'travel-app',
      timestamp: '2026-03-28T10:00:00Z',
    });
  });

  it("B8: delegated and verified carry the AP2 mandate; a missing mandate is refused", () => {
    expect(buildAuthorization('delegated', { ap2_mandate: 'open~~closed~' })).toEqual({ modality: 'delegated', evidence: { ap2_mandate: 'open~~closed~' } });
    expect(buildAuthorization('verified', { ap2_mandate: 'root~', checkout_jwt: 'cj' })).toEqual({ modality: 'verified', evidence: { ap2_mandate: 'root~', checkout_jwt: 'cj' } });
    expect(() => buildAuthorization('verified', { instruction: 'pay', platform: 'app' })).toThrow(/mandate/);
    expect(() => buildAuthorization('supervised')).toThrow(/Unknown/);
  });

  it('should auto-set timestamp for attested when omitted', () => {
    const auth = buildAuthorization('attested', {
      instruction: 'Book my flight',
      platform: 'travel-app',
    });
    expect(auth.modality).toBe('attested');
    if ('evidence' in auth) {
      expect(auth.evidence.timestamp).toBeDefined();
      // Should be a valid ISO timestamp
      expect(new Date(auth.evidence.timestamp).toISOString()).toBe(auth.evidence.timestamp);
    }
  });

  it('an unknown modality is refused, not silently treated as autonomous', () => {
    expect(() => buildAuthorization('unknown_modality')).toThrow(/Unknown authorization modality/);
  });
});

// ── Configuration tests ──

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw if PARAFE_BROKER_URL is missing', () => {
    delete process.env.PARAFE_BROKER_URL;
    process.env.PARAFE_API_KEY = 'prf_key_test';
    expect(() => loadConfig()).toThrow('PARAFE_BROKER_URL');
  });

  it('allows no PARAFE_API_KEY: the agent self-registers and is claimed (0.5.0)', () => {
    process.env.PARAFE_BROKER_URL = 'https://broker.example.com';
    delete process.env.PARAFE_API_KEY;
    expect(loadConfig().apiKey).toBeUndefined();
  });

  it('should load config from env vars', () => {
    process.env.PARAFE_BROKER_URL = 'https://broker.example.com';
    process.env.PARAFE_API_KEY = 'prf_key_test';
    process.env.PARAFE_CREDENTIALS_PATH = '/tmp/creds.enc';
    process.env.PARAFE_CREDENTIALS_PASSPHRASE = 'secret';

    const config = loadConfig();
    expect(config.brokerUrl).toBe('https://broker.example.com');
    expect(config.apiKey).toBe('prf_key_test');
    expect(config.credentialsPath).toBe('/tmp/creds.enc');
    expect(config.credentialsPassphrase).toBe('secret');
  });

  it('should use default credentials path when not provided', () => {
    process.env.PARAFE_BROKER_URL = 'https://broker.example.com';
    process.env.PARAFE_API_KEY = 'prf_key_test';
    delete process.env.PARAFE_CREDENTIALS_PATH;
    delete process.env.PARAFE_CREDENTIALS_PASSPHRASE;

    const config = loadConfig();
    expect(config.credentialsPath).toContain('.parafe/credentials.enc');
    expect(config.credentialsPassphrase).toBeUndefined();
  });
});

// ── Server creation tests ──

describe('createServer', () => {
  const config: ServerConfig = {
    brokerUrl: 'https://broker.example.com',
    apiKey: 'prf_key_test_123',
    credentialsPath: '/tmp/test-creds.enc',
    credentialsPassphrase: 'test-passphrase',
  };

  it('should create a server and client', () => {
    const { server, client } = createServer(config);
    expect(server).toBeDefined();
    expect(client).toBeDefined();
  });

  it('should return credential status as not loaded initially', () => {
    const { client } = createServer(config);
    const status = client.credentialStatus();
    expect(status.loaded).toBe(false);
  });
});

// ── Tool description quality tests ──

describe('Tool description quality', () => {
  it('parafe_discover description should mention agent card and well-known URL', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.DISCOVER);
    expect(tool?.description).toContain('agent card');
    expect(tool?.description).toContain('.well-known/agent-card.json');
    expect(tool?.description).toContain('.well-known/agent.json');
  });

  it('parafe_initiate_handshake description should explain authorization modalities', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.INITIATE_HANDSHAKE);
    expect(tool?.description).toContain('autonomous');
    expect(tool?.description).toContain('attested');
    expect(tool?.description).toContain('verified');
  });

  it('parafe_escalate_scope description should explain scope escalation within a session', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.ESCALATE_SCOPE);
    expect(tool?.description).toContain('existing authenticated session');
    expect(tool?.description).toContain('re-handshaking');
  });

  it('parafe_close_session description should mention receipt and independent verification', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.CLOSE_SESSION);
    expect(tool?.description).toContain('receipt');
    expect(tool?.description).toContain('independently verify');
  });

  it('parafe_register defaults to a P-256 key (Phase 3.5)', () => {
    const reg = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.REGISTER);
    const alg = (reg?.inputSchema.properties as Record<string, { description: string }>).key_algorithm;
    expect(alg.description).toMatch(/^Key type\. 'P-256' \(default/);
    expect(reg?.description).toContain('P-256 by default');
  });

  it('register and create_claim_link tell the agent to show the pairing code with the link', () => {
    for (const name of [TOOL_NAMES.REGISTER, TOOL_NAMES.CREATE_CLAIM_LINK]) {
      expect(TOOL_DEFINITIONS.find((t) => t.name === name)?.description).toContain('pairingCode');
    }
  });

  it('parafe_register description should mention credential persistence', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.REGISTER);
    expect(tool?.description).toContain('persist across sessions');
  });

  it('parafe_verify_consent_locally description should mention no broker round-trip', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.VERIFY_CONSENT_LOCALLY);
    expect(tool?.description).toContain('no broker round-trip');
  });

  it('receipt descriptions describe the JWS receipt, exclusions and the action receipts it lists', () => {
    const close = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.CLOSE_SESSION);
    expect(close?.description).toContain('JWS');
    expect(close?.description).toContain('exclusions');
    expect(close?.description).toContain('every action receipt filed');
  });
});

// ── Agent card discovery ──

describe('Agent card discovery', () => {
  const V2 = 'https://parafe.ai/extensions/a2a/v2';
  const V1 = 'https://github.com/getparafe/parafe-a2a-extension/v1';
  const LEGACY = 'https://parafe.dev/a2a-extension/v1';

  const parafeExtension = (uri: string, agentId = 'prf_agent_shop') => ({
    uri,
    required: true,
    params: {
      agent_id: agentId,
      broker_url: 'https://api.parafe.ai',
      minimum_identity_assurance: 'self_registered',
      scope_requirements: { 'order-donuts': { permissions: ['create_order'], minimum_authorization_modality: 'attested' } },
    },
  });

  const v1Card = (extensions: unknown[]) => ({
    name: 'Shop Agent',
    supportedInterfaces: [
      { url: 'https://shop.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { url: 'https://shop.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '0.3' },
    ],
    capabilities: { extensions },
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('knows every Parafe extension URI, newest first', () => {
    expect(PARAFE_EXTENSION_URIS).toEqual([V2, V1, LEGACY]);
  });

  it('tries the A2A v1.0 card path first and sends A2A-Version', async () => {
    fetchMock.mockResolvedValueOnce(json(v1Card([parafeExtension(V1)])));

    const result = await discoverAgentCard('https://shop.example');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://shop.example/.well-known/agent-card.json');
    expect((init as RequestInit).headers).toMatchObject({ 'A2A-Version': '1.0' });
    expect(result).toMatchObject({
      parafe_required: true,
      agent_id: 'prf_agent_shop',
      extension_uri: V1,
      card_url: 'https://shop.example/.well-known/agent-card.json',
      interfaces: [
        { url: 'https://shop.example/a2a', protocol_binding: 'JSONRPC', protocol_version: '1.0' },
        { url: 'https://shop.example/a2a', protocol_binding: 'JSONRPC', protocol_version: '0.3' },
      ],
    });
  });

  it('falls back to /.well-known/agent.json for A2A v0.3 agents', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(json({
        name: 'Old Agent',
        url: 'https://old.example/rpc',
        protocolVersion: '0.3',
        capabilities: { extensions: [parafeExtension(LEGACY, 'prf_agent_old')] },
      }));

    const result = await discoverAgentCard('old.example');

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://old.example/.well-known/agent-card.json',
      'https://old.example/.well-known/agent.json',
    ]);
    expect(result).toMatchObject({
      agent_id: 'prf_agent_old',
      extension_uri: LEGACY,
      card_url: 'https://old.example/.well-known/agent.json',
      interfaces: [{ url: 'https://old.example/rpc', protocol_binding: 'JSONRPC', protocol_version: '0.3' }],
    });
  });

  it('recognizes the v2 extension URI and prefers it when a card lists several', async () => {
    fetchMock.mockResolvedValueOnce(json(v1Card([parafeExtension(V1, 'prf_agent_v1'), parafeExtension(V2, 'prf_agent_v2')])));

    const result = await discoverAgentCard('https://shop.example');

    expect(result).toMatchObject({ extension_uri: V2, agent_id: 'prf_agent_v2' });
  });

  it('reports parafe_required false when the card has no Parafe extension', async () => {
    fetchMock.mockResolvedValueOnce(json(v1Card([{ uri: 'https://example.com/ext/other/v1' }])));

    const result = await discoverAgentCard('https://shop.example');

    expect(result).toMatchObject({ parafe_required: false, agent_name: 'Shop Agent' });
    expect(result.interfaces).toHaveLength(2);
    expect(result).toHaveProperty('raw_agent_card');
  });

  it('fetches an explicit card URL as given, without fallback', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404, statusText: 'Not Found' }));

    await expect(discoverAgentCard('https://shop.example/cards/shop.json')).rejects.toThrow(
      'Failed to fetch agent card from https://shop.example/cards/shop.json: 404',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back on server errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500, statusText: 'Internal Server Error' }));

    await expect(discoverAgentCard('https://shop.example')).rejects.toThrow('500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── B18: reputation floors in scope policies ──

import { z } from 'zod';
import { schemas } from '../../src/schemas.js';

describe('scope policy schema (B18 reputation floors)', () => {
  const policies = z.object(schemas.update_scope_policies).shape.scope_policies;
  it('accepts the reputation floors and claimed assurance', () => {
    expect(policies.safeParse({ s: { permissions: ['a'], minimum_tenure_days: 30, minimum_session_completion_rate: 0.8, maximum_denied_requests_30d: 2, minimum_unique_counterparties: 3, minimum_handshake_success_rate: 0.9, minimum_identity_assurance: 'claimed' } }).success).toBe(true);
  });
  it('refuses out-of-range values and unknown fields', () => {
    expect(policies.safeParse({ s: { permissions: ['a'], minimum_session_completion_rate: 1.2 } }).success).toBe(false);
    expect(policies.safeParse({ s: { permissions: ['a'], minimum_tenure_days: 1.5 } }).success).toBe(false);
    expect(policies.safeParse({ s: { permissions: ['a'], minimum_reputation_score: 0.5 } }).success).toBe(false);
  });
  it('the tool definitions list the fields', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.UPDATE_SCOPE_POLICIES);
    expect(JSON.stringify(tool?.inputSchema)).toContain('minimum_tenure_days');
  });
});

describe('AP2 argument mapping', () => {
  it('maps verify_mandate arguments to the SDK options, leaving out what was not given', () => {
    expect(buildVerifyMandateOptions({ mandate: 'm' })).toEqual({ mandate: 'm' });
    expect(buildVerifyMandateOptions({
      mandate: 'm', session_id: 'sess_1', agent_id: 'prf_agent_1', checkout_jwt: 'cj', checkout_hash: 'ch', checkout_mandate: 'cm',
      expected_audience: 'aud', expected_nonce: 'n', trusted_issuers: [{ jwk: { kty: 'EC' } }],
      context: { total_amount: 500, total_uses: 0 }, redeem: false,
    })).toEqual({
      mandate: 'm', sessionId: 'sess_1', agentId: 'prf_agent_1', checkoutJwt: 'cj', checkoutHash: 'ch', checkoutMandate: 'cm',
      expectedAudience: 'aud', expectedNonce: 'n', trustedIssuers: [{ jwk: { kty: 'EC' } }],
      context: { totalAmount: 500, totalUses: 0 }, redeem: false,
    });
  });

  it('maps AP2 receipt arguments to the SDK options', () => {
    expect(buildAp2ReceiptOptions({
      kind: 'payment', mandate: 'm', reference_form: 'sd_hash', iss: 'psp', status: 'Error', error: 'invalid_mandate',
      error_description: 'bad', payment_id: 'p1', psp_confirmation_id: 'c1', network_confirmation_id: 'n1', session_id: 'ignored',
    })).toEqual({
      kind: 'payment', mandate: 'm', referenceForm: 'sd_hash', iss: 'psp', status: 'Error', error: 'invalid_mandate',
      errorDescription: 'bad', paymentId: 'p1', pspConfirmationId: 'c1', networkConfirmationId: 'n1',
    });
    expect(buildAp2ReceiptOptions({ kind: 'checkout', references: { sdHash: 's', closedJwt: 'c' }, order_id: 'o' }))
      .toEqual({ kind: 'checkout', references: { sdHash: 's', closedJwt: 'c' }, orderId: 'o' });
  });
});
