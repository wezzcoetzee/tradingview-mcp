import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, zBool, WRITE } from './_format.js';
import * as core from '../core/capture.js';

export function registerCaptureTools(server: McpServer) {
  defineTool(server, {
    name: 'capture_screenshot',
    description: 'Take a screenshot of TradingView and save it as a PNG (to TV_MCP_SCREENSHOT_DIR, default a tradingview-mcp-screenshots folder in the OS temp dir). Set inline=true to also receive the image itself. region_fallback is true when the requested region was not found and the full window was captured.',
    inputSchema: {
      region: z.enum(core.CAPTURE_REGIONS).optional().describe('Region to capture (default full)'),
      filename: z.string().optional().describe('Custom filename; a trailing .png is accepted and not doubled'),
      method: z.enum(core.CAPTURE_METHODS).optional().describe('cdp (Page.captureScreenshot, default) or api (chartWidgetCollection.takeScreenshot, handled by TradingView itself)'),
      inline: zBool.optional().describe('Also return the PNG as image content, for clients that cannot read the saved file (default false)'),
    },
    annotations: WRITE,
    run: ({ region, filename, method, inline }) => core.captureScreenshot({ region, filename, method, inline }),
  });
}
