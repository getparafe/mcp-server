/**
 * The HTTP transport serves more than one request (P-44) and needs a token (S-67);
 * an unreadable credentials file is never overwritten (P-47); a renewed credential
 * is saved (P-46); the session resource is a real template (P-45).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, wrapHandler, type ServerConfig } from '../../src/index.js';
import { createHttpRequestHandler } from '../../src/http.js';
import { TOOL_NAMES } from '../../src/tools.js';

const config: ServerConfig = { brokerUrl: 'http://127.0.0.1:9', credentialsPath: '/nonexistent/credentials.enc' };

describe('Streamable HTTP transport', () => {
  let http: Server | undefined;
  afterEach(() => new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve())));

  async function start(token: string): Promise<string> {
    const { newServer } = createServer(config);
    const handler = createHttpRequestHandler({ newServer, bearerToken: token });
    http = createHttpServer((req, res) => { void handler(req, res); });
    await new Promise<void>((resolve) => http!.listen(0, '127.0.0.1', resolve));
    const address = http.address() as { port: number };
    return `http://127.0.0.1:${address.port}/mcp`;
  }

  function rpc(url: string, token: string | null, id: number, method: string, params: object = {}) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
  }

  it('answers every request, not only the first (P-44)', async () => {
    const url = await start('t0ken');
    const init = await rpc(url, 't0ken', 1, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    });
    expect(init.status).toBe(200);
    for (const id of [2, 3]) {
      const list = await rpc(url, 't0ken', id, 'tools/list');
      expect(list.status).toBe(200);
      expect(await list.text()).toContain('parafe_register');
    }
  });

  it('answers GET and DELETE with 405 instead of holding a stream open', async () => {
    const url = await start('t0ken');
    for (const method of ['GET', 'DELETE']) {
      const r = await fetch(url, { method, headers: { Authorization: 'Bearer t0ken', Accept: 'text/event-stream' } });
      expect(r.status).toBe(405);
      await r.text();
    }
  });

  it('refuses a request without the token, or with a wrong one (S-67)', async () => {
    const url = await start('t0ken');
    expect((await rpc(url, null, 1, 'tools/list')).status).toBe(401);
    expect((await rpc(url, 'wrong', 1, 'tools/list')).status).toBe(401);
  });

  it('cannot be built without a token (S-67)', () => {
    const { newServer } = createServer(config);
    expect(() => createHttpRequestHandler({ newServer, bearerToken: '' })).toThrow(/PARAFE_MCP_AUTH_TOKEN/);
  });
});

describe('Credentials file', () => {
  let dir: string | undefined;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('an unreadable file (wrong passphrase) blocks registration and is never overwritten (P-47)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'parafe-mcp-'));
    const credentialsPath = join(dir, 'credentials.enc');
    await writeFile(credentialsPath, 'not a credentials file');
    const cfg: ServerConfig = { ...config, credentialsPath, credentialsPassphrase: 'pass' };
    const { client, tryLoadCredentials } = createServer(cfg);
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
    try {
      await tryLoadCredentials();
    } finally {
      console.error = original;
    }
    expect(String(errors[0])).toContain("won't be overwritten");

    const result = await wrapHandler(TOOL_NAMES.REGISTER, client, cfg)({ type: 'personal' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("exists but couldn't be read");
    expect(await readFile(credentialsPath, 'utf8')).toBe('not a credentials file');
  });
});

describe('Credentials file ownership', () => {
  it('an existing file this server never loaded is not overwritten by parafe_register (P-47)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parafe-mcp-'));
    try {
      const credentialsPath = join(dir, 'credentials.enc');
      await writeFile(credentialsPath, 'someone else\'s identity');
      const cfg: ServerConfig = { ...config, credentialsPath, credentialsPassphrase: 'pass' };
      const { client } = createServer(cfg); // tryLoadCredentials() never called
      const result = await wrapHandler(TOOL_NAMES.REGISTER, client, cfg)({ type: 'personal' });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("wasn't loaded");
      expect(await readFile(credentialsPath, 'utf8')).toBe('someone else\'s identity');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Concurrent registration', () => {
  it('two simultaneous parafe_register calls register one agent', async () => {
    let loaded = false;
    const register = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      loaded = true;
      return { agentId: 'prf_agent_one', did: 'did:web:x', publicKey: 'k', credentialSdJwt: 's', verificationTier: 'unverified', identityAssurance: 'self_registered', issuedAt: 'i', expiresAt: 'e' };
    });
    const client = {
      credentialStatus: () => (loaded ? { loaded: true, agentId: 'prf_agent_one', agentName: 'prf_agent_one', expiresAt: 'e', expired: false } : { loaded: false }),
      register,
    } as unknown as Parameters<typeof wrapHandler>[1];
    const call = () => wrapHandler(TOOL_NAMES.REGISTER, client, config)({ type: 'personal' });
    const [a, b] = await Promise.all([call(), call()]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(JSON.parse(a.content[0]!.text).agentId).toBe('prf_agent_one');
    expect(JSON.parse(b.content[0]!.text).agentId).toBe('prf_agent_one');
  });
});

describe('Credentials after renewal', () => {
  it('saves the renewed credential of the loaded agent (P-46)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'parafe-mcp-'));
    try {
      const cfg: ServerConfig = { ...config, credentialsPath: join(dir, 'credentials.enc'), credentialsPassphrase: 'pass' };
      const saveCredentials = vi.fn(async () => {});
      const client = {
        credentialStatus: () => ({ loaded: true, agentId: 'prf_agent_a1' }),
        renewCredential: async () => ({ agentId: 'prf_agent_a1', renewed: true, reason: 'identity_changed' }),
        saveCredentials,
      } as unknown as Parameters<typeof wrapHandler>[1];
      const result = await wrapHandler(TOOL_NAMES.RENEW_CREDENTIAL, client, cfg)({ agent_id: 'prf_agent_a1' });
      expect(result.isError).toBeUndefined();
      expect(saveCredentials).toHaveBeenCalledWith(cfg.credentialsPath, 'pass');

      // A save that fails still reports the renewal, with a warning (the old credential is revoked).
      saveCredentials.mockImplementationOnce(async () => { throw new Error('EACCES'); });
      const failed = await wrapHandler(TOOL_NAMES.RENEW_CREDENTIAL, client, cfg)({ agent_id: 'prf_agent_a1' });
      expect(failed.isError).toBeUndefined();
      expect(JSON.parse(failed.content[0]!.text)).toMatchObject({ renewed: true, warning: expect.stringContaining('not saved') });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Session resource', () => {
  it('is listed as a URI template, so parafe://session/<id> resolves (P-45)', async () => {
    const { server } = createServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(clientTransport);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain('parafe://session/{sessionId}');
    await client.close();
  });
});
