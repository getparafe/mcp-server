#!/usr/bin/env node

/**
 * CLI entry point for @getparafe/mcp-server
 *
 * Usage:
 *   npx @getparafe/mcp-server                          # stdio transport (default)
 *   npx @getparafe/mcp-server --transport=http          # Streamable HTTP transport
 *   npx @getparafe/mcp-server --transport=http --port=3001
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, loadConfig } from '../index.js';

async function main() {
  const args = process.argv.slice(2);
  const transportArg = args.find((a) => a.startsWith('--transport='));
  const transport = transportArg?.split('=')[1] || 'stdio';

  // Load configuration from environment
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`Configuration error: ${(err as Error).message}`);
    console.error('');
    console.error('Required environment variables:');
    console.error('  PARAFE_BROKER_URL    Parafe broker API URL');
    console.error('  PARAFE_API_KEY       Developer API key from the Parafe portal');
    console.error('');
    console.error('Optional:');
    console.error('  PARAFE_CREDENTIALS_PATH         Path to encrypted credential file (default: ~/.parafe/credentials.enc)');
    console.error('  PARAFE_CREDENTIALS_PASSPHRASE   Passphrase for credential encryption');
    process.exit(1);
  }

  const { server, tryLoadCredentials } = createServer(config);

  // Auto-load credentials if available
  await tryLoadCredentials();

  if (transport === 'stdio') {
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
  } else if (transport === 'http') {
    const portArg = args.find((a) => a.startsWith('--port='));
    const port = portArg ? parseInt(portArg.split('=')[1], 10) : 3001;

    // Dynamically import the Streamable HTTP transport
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );

    const { createServer: createHttpServer } = await import('node:http');

    const httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(httpTransport);

    const httpServer = createHttpServer(async (req, res) => {
      if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
        await httpTransport.handleRequest(req, res);
      } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', server: '@getparafe/mcp-server' }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    httpServer.listen(port, () => {
      console.error(`Parafe MCP server listening on http://localhost:${port}/mcp`);
    });
  } else {
    console.error(`Unknown transport: ${transport}. Use 'stdio' or 'http'.`);
    process.exit(1);
  }
}

// Graceful shutdown
function shutdown(signal: string) {
  console.error(`Received ${signal}, shutting down gracefully...`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
