/**
 * Streamable HTTP transport for the MCP server.
 *
 * Stateless mode: each POST gets its own McpServer and transport (the MCP SDK
 * refuses to reuse a stateless transport across requests), all sharing one
 * ParafeClient, so the loaded agent is the same for every request. GET and DELETE
 * answer 405: there is no stream to open and no session to end.
 *
 * A bearer token is required: without one, anyone who reaches the port would act
 * as the loaded agent (S-67).
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface HttpHandlerOptions {
  /** A fresh McpServer bound to the shared ParafeClient. */
  newServer: () => McpServer;
  /** Required: requests to /mcp must send `Authorization: Bearer <bearerToken>`. */
  bearerToken: string;
}

function tokenMatches(header: string | undefined, bearerToken: string): boolean {
  const expected = Buffer.from(`Bearer ${bearerToken}`);
  const given = Buffer.from(header ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function createHttpRequestHandler(options: HttpHandlerOptions) {
  if (!options.bearerToken) {
    throw new Error('The HTTP transport needs PARAFE_MCP_AUTH_TOKEN (a bearer token clients must send).');
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: '@getparafe/mcp-server' }));
      return;
    }
    if (req.url !== '/mcp' && !req.url?.startsWith('/mcp?')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    if (!tokenMatches(req.headers.authorization, options.bearerToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Stateless: no server-to-client stream (GET) and no session to end (DELETE).
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
      return;
    }

    try {
      const server = options.newServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: (err as Error).message }, id: null }));
      }
    }
  };
}
