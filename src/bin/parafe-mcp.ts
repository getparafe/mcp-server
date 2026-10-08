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
    console.error('');
    console.error('Optional:');
    console.error('  PARAFE_API_KEY                  Developer API key from the Parafe portal. Without one, the agent self-registers and gets a claim link for the person it acts for.');
    console.error('  PARAFE_CREDENTIALS_PATH         Path to encrypted credential file (default: ~/.parafe/credentials.enc)');
    console.error('  PARAFE_CREDENTIALS_PASSPHRASE   Passphrase for credential encryption');
    console.error('  PARAFE_MCP_AUTH_TOKEN            Bearer token MCP clients must send (required for --transport=http)');
    process.exit(1);
  }

  const { server, newServer, tryLoadCredentials } = createServer(config);

  if (transport === 'http' && !process.env.PARAFE_MCP_AUTH_TOKEN) {
    // Without a token, anyone who reaches the port would act as the loaded agent (S-67).
    console.error('The HTTP transport needs PARAFE_MCP_AUTH_TOKEN: a bearer token MCP clients must send (Authorization: Bearer <token>).');
    process.exit(1);
  }

  // Auto-load credentials if available
  await tryLoadCredentials();

  if (transport === 'stdio') {
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
  } else if (transport === 'http') {
    const portArg = args.find((a) => a.startsWith('--port='));
    const port = portArg ? parseInt(portArg.split('=')[1], 10) : 3001;

    const { createHttpRequestHandler } = await import('../http.js');
    const { createServer: createHttpServer } = await import('node:http');

    // One McpServer and transport per request (stateless), sharing the loaded agent (P-44).
    const handler = createHttpRequestHandler({ newServer, bearerToken: process.env.PARAFE_MCP_AUTH_TOKEN as string });
    const httpServer = createHttpServer((req, res) => { void handler(req, res); });

    httpServer.listen(port, () => {
      console.error(`Parafe MCP server listening on port ${port} (all interfaces), path /mcp`);
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
