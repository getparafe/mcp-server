/**
 * Unit tests for @getparafe/mcp-server
 *
 * These are unit tests with mocked SDK and HTTP calls.
 * They verify tool definitions, handler routing, authorization building,
 * credential lifecycle, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOOL_DEFINITIONS, TOOL_NAMES, buildAuthorization } from '../../src/tools.js';
import { RESOURCE_DEFINITIONS, RESOURCE_TEMPLATES } from '../../src/resources.js';
import { loadConfig, createServer, type ServerConfig } from '../../src/index.js';

// ── Tool definition tests ──

describe('Tool definitions', () => {
  it('should define exactly 15 tools', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(15);
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
    expect(names).toContain(TOOL_NAMES.RECORD_ACTION);
    expect(names).toContain(TOOL_NAMES.CLOSE_SESSION);
    expect(names).toContain(TOOL_NAMES.VERIFY_RECEIPT);
    expect(names).toContain(TOOL_NAMES.REVOKE_AGENT);
    expect(names).toContain(TOOL_NAMES.RENEW_CREDENTIAL);
    expect(names).toContain(TOOL_NAMES.UPDATE_SCOPE_POLICIES);
    expect(names).toContain(TOOL_NAMES.GET_PUBLIC_KEY);
    expect(names).toContain(TOOL_NAMES.VERIFY_CONSENT_LOCALLY);
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

  it('parafe_register should require name, type, owner', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.REGISTER);
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['name', 'type', 'owner']),
    );
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

  it('parafe_get_public_key should have no required fields', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.GET_PUBLIC_KEY);
    expect(tool?.inputSchema.required).toHaveLength(0);
  });

  it('parafe_verify_consent_locally should require consent_token and broker_public_key', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.VERIFY_CONSENT_LOCALLY);
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(['consent_token', 'broker_public_key']),
    );
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
      expect(props).toHaveProperty('user_signature');
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

  it('should build verified authorization with user_signature', () => {
    const auth = buildAuthorization('verified', {
      instruction: 'Approve payment',
      platform: 'wallet-app',
      user_signature: 'base64sig==',
      timestamp: '2026-03-28T10:00:00Z',
    });
    expect(auth.modality).toBe('verified');
    if ('evidence' in auth) {
      expect(auth.evidence).toHaveProperty('user_signature', 'base64sig==');
    }
  });

  it('should default unknown modality to autonomous', () => {
    const auth = buildAuthorization('unknown_modality');
    expect(auth).toEqual({ modality: 'autonomous' });
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

  it('should throw if PARAFE_API_KEY is missing', () => {
    process.env.PARAFE_BROKER_URL = 'https://broker.example.com';
    delete process.env.PARAFE_API_KEY;
    expect(() => loadConfig()).toThrow('PARAFE_API_KEY');
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

  it('parafe_register description should mention credential persistence', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.REGISTER);
    expect(tool?.description).toContain('persist across sessions');
  });

  it('parafe_verify_consent_locally description should mention no network call', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === TOOL_NAMES.VERIFY_CONSENT_LOCALLY);
    expect(tool?.description).toContain('no network');
  });
});
