import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './create-server.js';
import { errorMessage } from './debug.js';

const server = createServer();

// Startup notice (stderr so it doesn't interfere with MCP stdio protocol)
process.stderr.write('⚠  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n');
process.stderr.write('   Ensure your usage complies with TradingView\'s Terms of Use.\n\n');

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (err) {
  process.stderr.write(`Failed to start MCP server: ${errorMessage(err)}\n`);
  process.exit(1);
}
