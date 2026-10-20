import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, WRITE } from './_format.js';
import * as core from '../core/capture.js';

export function registerCaptureTools(server: McpServer) {
  defineTool(server, {
    name: 'capture_screenshot',
    description: 'Take a screenshot of the TradingView chart',
    inputSchema: {
      region: z.string().optional().describe('Region to capture: full, chart, strategy_tester (default full)'),
      filename: z.string().optional().describe('Custom filename (without extension)'),
      method: z.string().optional().describe('Capture method: cdp (Page.captureScreenshot) or api (chartWidgetCollection.takeScreenshot) (default cdp)'),
    },
    annotations: WRITE,
    run: ({ region, filename, method }) => core.captureScreenshot({ region, filename, method }),
  });
}
