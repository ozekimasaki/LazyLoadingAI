/**
 * MCP Server setup
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Indexer } from '../indexer/index.js';
import { registerTools } from './tools/index.js';

export interface ServerOptions {
  name?: string;
  version?: string;
}

export async function createServer(
  indexer: Indexer,
  options: ServerOptions = {}
): Promise<McpServer> {
  const server = new McpServer({
    name: options.name ?? 'lazyloading-ai',
    version: options.version ?? '1.0.0',
  });

  // Register all tools
  registerTools(server, indexer);

  return server;
}

export async function startStdioServer(
  indexer: Indexer,
  options: ServerOptions = {}
): Promise<void> {
  const server = await createServer(indexer, options);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await indexer.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await indexer.close();
    process.exit(0);
  });
}

export { registerTools } from './tools/index.js';
