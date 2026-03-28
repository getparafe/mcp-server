/**
 * Integration tests for @getparafe/mcp-server
 *
 * These tests run against a live broker. They are self-bootstrapping:
 * each run creates its own org + developer + API key via POST /auth/signup.
 * The only environment variable required is PARAFE_TEST_BROKER_URL
 * (defaults to http://localhost:3000).
 *
 * Run: npm run test:integration
 * Against staging: PARAFE_TEST_BROKER_URL=https://parafe-staging.up.railway.app npm run test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../../src/index.js';

const BROKER_URL = process.env.PARAFE_TEST_BROKER_URL || 'http://localhost:3000';

// Bootstrap: create an org + developer + API key by calling POST /auth/signup directly.
// Returns the API key for use in the MCP server config.
async function bootstrap(label: string): Promise<string> {
  const email = `test-${label}-${Date.now().toString(36)}@example.com`;
  const res = await fetch(`${BROKER_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPassword123!',
      name: `Test User ${label}`,
      org_name: `test-org-${label}-${Date.now().toString(36)}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bootstrap signup failed (${res.status}): ${body}`);
  }
  const data = await res.json() as { api_key?: { key: string } };
  if (!data.api_key?.key) {
    throw new Error('Bootstrap: no api_key.key in signup response');
  }
  return data.api_key.key;
}

// ── Health check ──

describe('Broker reachability', () => {
  it('broker should be reachable', async () => {
    const res = await fetch(`${BROKER_URL}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });
});

// ── parafe_get_public_key ──

describe('parafe_get_public_key', () => {
  let apiKey: string;

  beforeAll(async () => {
    apiKey = await bootstrap('pubkey');
  });

  it('should return the broker public key via SDK method', async () => {
    const config = { brokerUrl: BROKER_URL, apiKey, credentialsPath: '/tmp/test-mcp.enc' };
    const { client } = createServer(config);
    const result = await client.getPublicKey();
    expect(result).toHaveProperty('publicKey');
    expect(typeof (result as { publicKey: string }).publicKey).toBe('string');
  });
});

// ── Full trust lifecycle ──

describe('Trust lifecycle', () => {
  let apiKeyA: string;
  let apiKeyB: string;

  beforeAll(async () => {
    [apiKeyA, apiKeyB] = await Promise.all([
      bootstrap('agentA'),
      bootstrap('agentB'),
    ]);
  });

  it('should complete the full lifecycle: register → handshake → consent → record → close → verify', async () => {
    const configA = { brokerUrl: BROKER_URL, apiKey: apiKeyA, credentialsPath: '/tmp/test-mcp-a.enc' };
    const configB = { brokerUrl: BROKER_URL, apiKey: apiKeyB, credentialsPath: '/tmp/test-mcp-b.enc' };
    const { client: clientA } = createServer(configA);
    const { client: clientB } = createServer(configB);

    const suffix = Date.now().toString(36);

    // Register agent A
    const regA = await clientA.register({
      name: `mcp-agent-a-${suffix}`,
      type: 'personal',
      owner: 'test-org-a',
    });
    expect(regA.agentId).toBeDefined();
    expect(regA.agentId).toMatch(/^prf_agent_/);

    // Register agent B
    const regB = await clientB.register({
      name: `mcp-agent-b-${suffix}`,
      type: 'personal',
      owner: 'test-org-b',
    });
    expect(regB.agentId).toBeDefined();

    // Agent A initiates handshake toward Agent B
    const handshakeResult = await clientA.handshake({
      targetAgentId: regB.agentId,
      scope: 'test-scope',
      permissions: ['read', 'write'],
      authorization: { modality: 'autonomous' },
    });
    expect(handshakeResult.handshakeId).toBeDefined();
    expect(handshakeResult.challengeForTarget).toBeDefined();

    // Agent B completes the handshake
    const session = await clientB.completeHandshake({
      handshakeId: handshakeResult.handshakeId,
      challengeNonce: handshakeResult.challengeForTarget,
    });
    expect(session.sessionId).toBeDefined();
    expect(session.consentToken).toBeDefined();
    expect(session.consentToken.token).toBeDefined();

    // Verify consent token (network round-trip)
    const consent = await clientA.verifyConsent({
      consentToken: session.consentToken.token,
      action: 'read',
      sessionId: session.sessionId,
    });
    expect(consent.permitted).toBe(true);

    // Verify consent token locally (no network)
    const publicKeyResult = await clientA.getPublicKey();
    const localVerify = await clientA.verifyConsentLocally(
      session.consentToken.token,
      publicKeyResult.publicKey,
    );
    expect(localVerify).toBeDefined();

    // Record an action
    await clientA.recordAction({
      sessionId: session.sessionId,
      agentId: regA.agentId,
      action: 'read',
      details: { resource: 'test-resource' },
    });

    // Close the session and get a receipt
    const receipt = await clientA.closeSession(session.sessionId);
    expect(receipt).toBeDefined();
    expect(receipt.receiptId).toBeDefined();
    expect(receipt.signature).toBeDefined();

    // Verify the receipt signature
    const verification = await clientA.verifyReceipt(receipt);
    expect(verification.valid).toBe(true);
  });
});

// ── parafe_verify_consent_locally error cases ──

describe('parafe_verify_consent_locally', () => {
  let apiKey: string;

  beforeAll(async () => {
    apiKey = await bootstrap('vcl');
  });

  it('should reject a tampered or invalid consent token', async () => {
    const config = { brokerUrl: BROKER_URL, apiKey, credentialsPath: '/tmp/test-mcp-vcl.enc' };
    const { client } = createServer(config);
    const publicKeyResult = await client.getPublicKey() as { publicKey: string };

    await expect(
      client.verifyConsentLocally('not.a.valid.jwt', publicKeyResult.publicKey),
    ).rejects.toThrow();
  });
});
