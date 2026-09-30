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

// Staging allows 5 signups per hour per IP: tests that don't need their own org share one.
let sharedKey: Promise<string> | undefined;
const sharedApiKey = () => (sharedKey ??= bootstrap('shared'));

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
    apiKey = await sharedApiKey();
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
    const localVerify = await clientA.verifyConsentLocally(session.consentToken.token); // JWKS fetched and cached
    expect(localVerify.valid).toBe(true);
    expect(localVerify.keyThumbprint).toBeTruthy();

    // Agent B receipts the action it performed; Agent A files its copy (a duplicate: same acknowledgment)
    const recorded = await clientB.recordActionReceipt({
      sessionId: session.sessionId,
      consentToken: session.consentToken.token,
      action: 'read',
      details: { resource: 'test-resource' },
    });
    expect(recorded.ack.seq).toBe(1);
    expect((await clientA.fileActionReceipt(session.sessionId, recorded.receipt)).duplicate).toBe(true);
    expect((await clientA.getActionReceipts(session.sessionId)).entries).toHaveLength(1);

    // Close the session and get a receipt
    const receipt = await clientA.closeSession(session.sessionId);
    expect(receipt).toBeDefined();
    expect(receipt.receiptId).toBeDefined();
    expect(receipt.receipt.split(".")).toHaveLength(3); // the receipt is a JWS
    expect(receipt.actions.map((a) => a.action)).toEqual(['read']);
    expect((await clientB.getReceipt(session.sessionId) as { receipt: string }).receipt).toBe(receipt.receipt);

    // Verify the receipt signature
    const verification = await clientA.verifyReceipt(receipt);
    expect(verification.valid).toBe(true);
  });
});

// ── parafe_verify_consent_locally error cases ──

describe('parafe_verify_consent_locally', () => {
  let apiKey: string;

  beforeAll(async () => {
    apiKey = await sharedApiKey();
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

// ── AP2 tools, through the MCP protocol (0.8.0) ──

describe('AP2 tools', () => {
  let apiKeyShopper: string;
  let apiKeyShop: string;

  beforeAll(async () => {
    apiKeyShopper = apiKeyShop = await sharedApiKey(); // two agents of one org
  });

  it('verify_mandate reports an invalid mandate; sign/record_ap2_receipt sign and file receipts', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const part = (jwt: string, i: number) => JSON.parse(Buffer.from(jwt.split('.')[i]!, 'base64url').toString());
    const decodeProtectedHeader = (jwt: string) => part(jwt, 0);
    const decodeJwt = (jwt: string) => part(jwt, 1);

    const shopper = createServer({ brokerUrl: BROKER_URL, apiKey: apiKeyShopper, credentialsPath: '/tmp/test-mcp-ap2-a.enc' });
    const shop = createServer({ brokerUrl: BROKER_URL, apiKey: apiKeyShop, credentialsPath: '/tmp/test-mcp-ap2-b.enc' });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await shop.server.connect(serverSide);
    const mcp = new Client({ name: 'test', version: '0' });
    await mcp.connect(clientSide);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await mcp.callTool({ name, arguments: args }) as { content: Array<{ text: string }>; isError?: boolean };
      return { isError: !!r.isError, body: JSON.parse(r.content[0]!.text) };
    };

    const suffix = Date.now().toString(36);
    await shopper.client.register({ name: `mcp-ap2-shopper-${suffix}`, type: 'personal', owner: 'test' });
    const shopReg = await call('parafe_register', { name: `mcp-ap2-shop-${suffix}`, type: 'enterprise', owner: 'test', key_algorithm: 'P-256' });
    expect(shopReg.isError).toBe(false);

    const hs = await shopper.client.handshake({ targetAgentId: shopReg.body.agentId, scope: 'shop', permissions: ['buy'], authorization: { modality: 'autonomous' } });
    const session = await shop.client.completeHandshake({ handshakeId: hs.handshakeId, challengeNonce: hs.challengeForTarget });

    // A malformed mandate: the broker answers with the AP2 error code for the receipt, or refuses it.
    const bad = await call('parafe_verify_mandate', { mandate: 'not-a-mandate', session_id: session.sessionId, redeem: false });
    if (bad.isError) expect(bad.body.statusCode).toBe(400);
    else expect(bad.body).toMatchObject({ valid: false });

    const references = { sdHash: 'a'.repeat(43), closedJwt: 'b'.repeat(43) };

    // Sign only: an ES256 AP2 Checkout Receipt, not filed.
    const signed = await call('parafe_sign_ap2_receipt', { kind: 'checkout', references, order_id: 'ord_1' });
    expect(signed.isError).toBe(false);
    expect(signed.body.kind).toBe('ap2.checkout_receipt');
    expect(decodeProtectedHeader(signed.body.receipt).alg).toBe('ES256');
    expect(decodeJwt(signed.body.receipt)).toMatchObject({ status: 'Success', order_id: 'ord_1', reference: references.closedJwt });

    // Missing required fields are refused before anything is signed.
    const noOrder = await call('parafe_sign_ap2_receipt', { kind: 'checkout', references });
    expect(noOrder.isError).toBe(true);
    expect(noOrder.body.error).toContain('orderId');

    // Record: an Error receipt, signed and filed in the session's index.
    const recorded = await call('parafe_record_ap2_receipt', {
      session_id: session.sessionId, kind: 'checkout', references, reference_form: 'sd_hash',
      error: 'invalid_mandate', error_description: 'Mandate did not verify',
    });
    expect(recorded.isError).toBe(false);
    expect(decodeJwt(recorded.body.receipt)).toMatchObject({ status: 'Error', error: 'invalid_mandate', reference: references.sdHash });
    expect(recorded.body.ack.seq).toBe(1);
    const index = await shopper.client.getActionReceipts(session.sessionId);
    expect(index.entries.map((e) => e.kind)).toEqual(['ap2.checkout_receipt']);

    await mcp.close();
  });
});
