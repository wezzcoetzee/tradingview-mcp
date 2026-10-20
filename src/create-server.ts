import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHealthTools } from './tools/health.js';
import { registerChartTools } from './tools/chart.js';
import { registerPineTools } from './tools/pine.js';
import { registerDataTools } from './tools/data.js';
import { registerCaptureTools } from './tools/capture.js';
import { registerDrawingTools } from './tools/drawing.js';
import { registerAlertTools } from './tools/alerts.js';
import { registerBatchTools } from './tools/batch.js';
import { registerReplayTools } from './tools/replay.js';
import { registerIndicatorTools } from './tools/indicators.js';
import { registerWatchlistTools } from './tools/watchlist.js';
import { registerUiTools } from './tools/ui.js';
import { registerPaneTools } from './tools/pane.js';
import { registerTabTools } from './tools/tab.js';
import { INSTRUCTIONS } from './instructions.js';
import { registerSkillPrompts } from './skills.js';
import pkg from '../package.json' with { type: 'json' };

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'tradingview',
      version: pkg.version,
      description: 'AI-assisted TradingView chart analysis and Pine Script development via Chrome DevTools Protocol',
    },
    {
      instructions: INSTRUCTIONS,
    }
  );

  // Register all tool groups
  registerHealthTools(server);
  registerChartTools(server);
  registerPineTools(server);
  registerDataTools(server);
  registerCaptureTools(server);
  registerDrawingTools(server);
  registerAlertTools(server);
  registerBatchTools(server);
  registerReplayTools(server);
  registerIndicatorTools(server);
  registerWatchlistTools(server);
  registerUiTools(server);
  registerPaneTools(server);
  registerTabTools(server);
  registerSkillPrompts(server);
  return server;
}
