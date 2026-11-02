import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, zBool, WRITE } from './_format.js';
import * as core from '../core/capture.js';

export function registerCaptureTools(server: McpServer) {
  defineTool(server, {
    name: 'capture_screenshot',
    description: 'Take a screenshot of TradingView and save it as a PNG (to TV_MCP_SCREENSHOT_DIR, default a tradingview-mcp-screenshots folder in the OS temp dir). Set inline=true to also receive the image itself. region_fallback is true when a different region than requested was captured (see region). window_hidden is true when the TradingView window is hidden (screen locked or minimized); the default method then renders the chart from its model so the image stays correct.',
    inputSchema: {
      region: z.enum(core.CAPTURE_REGIONS).optional().describe('Region to capture (default full)'),
      filename: z.string().optional().describe('Custom filename; a trailing .png is accepted and not doubled'),
      method: z.enum(core.CAPTURE_METHODS).optional().describe('cdp (window pixels) or snapshot (TradingView renders the chart panes, legend and drawings from the model). Default: snapshot while the window is hidden, cdp otherwise'),
      inline: zBool.optional().describe('Also return the PNG as image content, for clients that cannot read the saved file (default false)'),
    },
    annotations: WRITE,
    run: ({ region, filename, method, inline }) => core.captureScreenshot({ region, filename, method, inline }),
  });
}
