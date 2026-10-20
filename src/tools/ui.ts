import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, DESTRUCTIVE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/ui.js';

export function registerUiTools(server: McpServer) {
  defineTool(server, {
    name: 'ui_click',
    description: 'Click a UI element by aria-label, data-name, text content, or class substring',
    inputSchema: {
      by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Selector strategy'),
      value: z.string().describe('Value to match against the chosen selector strategy'),
    },
    annotations: DESTRUCTIVE,
    run: ({ by, value }) => core.click({ by, value }),
  });

  defineTool(server, {
    name: 'ui_open_panel',
    description: 'Open, close, or toggle TradingView panels (pine-editor, strategy-tester, watchlist, alerts, trading)',
    inputSchema: {
      panel: z.enum(['pine-editor', 'strategy-tester', 'watchlist', 'alerts', 'trading']).describe('Panel name'),
      action: z.enum(['open', 'close', 'toggle']).describe('Action to perform'),
    },
    annotations: WRITE,
    run: ({ panel, action }) => core.openPanel({ panel, action }),
  });

  defineTool(server, {
    name: 'ui_fullscreen',
    description: 'Toggle TradingView fullscreen mode',
    annotations: WRITE,
    run: () => core.fullscreen(),
  });

  defineTool(server, {
    name: 'layout_list',
    description: 'List saved chart layouts',
    annotations: READ_ONLY,
    run: () => core.layoutList(),
  });

  defineTool(server, {
    name: 'layout_switch',
    description: 'Switch to a saved chart layout by name or ID',
    inputSchema: {
      name: z.string().describe('Name or ID of the layout to switch to'),
    },
    annotations: DESTRUCTIVE,
    run: ({ name }) => core.layoutSwitch({ name }),
  });

  defineTool(server, {
    name: 'ui_keyboard',
    description: 'Press keyboard keys or shortcuts (e.g., Enter, Escape, Alt+S, Ctrl+Z)',
    inputSchema: {
      key: z.string().describe('Key to press (e.g., "Enter", "Escape", "Tab", "a", "ArrowUp")'),
      modifiers: z.array(z.enum(['ctrl', 'alt', 'shift', 'meta'])).optional().describe('Modifier keys to hold (e.g., ["ctrl", "shift"])'),
    },
    annotations: DESTRUCTIVE,
    run: ({ key, modifiers }) => core.keyboard({ key, modifiers }),
  });

  defineTool(server, {
    name: 'ui_type_text',
    description: 'Type text into the currently focused input/textarea element',
    inputSchema: {
      text: z.string().describe('Text to type into the focused element'),
    },
    annotations: DESTRUCTIVE,
    run: ({ text }) => core.typeText({ text }),
  });

  defineTool(server, {
    name: 'ui_hover',
    description: 'Hover over a UI element by aria-label, data-name, or text content',
    inputSchema: {
      by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Selector strategy'),
      value: z.string().describe('Value to match'),
    },
    annotations: WRITE,
    run: ({ by, value }) => core.hover({ by, value }),
  });

  defineTool(server, {
    name: 'ui_scroll',
    description: 'Scroll the chart or page up/down/left/right',
    inputSchema: {
      direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
      amount: z.coerce.number().optional().describe('Scroll amount in pixels (default 300)'),
    },
    annotations: WRITE,
    run: ({ direction, amount }) => core.scroll({ direction, amount }),
  });

  defineTool(server, {
    name: 'ui_mouse_click',
    description: 'Click at specific x,y coordinates on the TradingView window',
    inputSchema: {
      x: z.coerce.number().describe('X coordinate (pixels from left)'),
      y: z.coerce.number().describe('Y coordinate (pixels from top)'),
      button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default left)'),
      double_click: z.coerce.boolean().optional().describe('Double click (default false)'),
    },
    annotations: DESTRUCTIVE,
    run: ({ x, y, button, double_click }) => core.mouseClick({ x, y, button, double_click }),
  });

  defineTool(server, {
    name: 'ui_find_element',
    description: 'Find UI elements by text, aria-label, or CSS selector and return their positions',
    inputSchema: {
      query: z.string().describe('Text content, aria-label value, or CSS selector to search for'),
      strategy: z.enum(['text', 'aria-label', 'css']).optional().describe('Search strategy (default: text)'),
    },
    annotations: READ_ONLY,
    run: ({ query, strategy }) => core.findElement({ query, strategy }),
  });

  if (process.env.TRADINGVIEW_MCP_ALLOW_EVAL === '1') {
    defineTool(server, {
      name: 'ui_evaluate',
      description: 'Execute JavaScript code in the TradingView page context for advanced automation. DANGEROUS: only enabled when TRADINGVIEW_MCP_ALLOW_EVAL=1.',
      inputSchema: {
        expression: z.string().describe('JavaScript expression to evaluate in the page context. Wrap in IIFE for complex logic.'),
      },
      annotations: DESTRUCTIVE,
      run: ({ expression }) => core.uiEvaluate({ expression }),
    });
  }
}
