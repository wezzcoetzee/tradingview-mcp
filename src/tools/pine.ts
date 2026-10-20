import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, DESTRUCTIVE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/pine.js';

export function registerPineTools(server: McpServer) {
  defineTool(server, {
    name: 'pine_get_source',
    description: 'Get current Pine Script source code from the editor',
    annotations: READ_ONLY,
    run: () => core.getSource(),
  });

  defineTool(server, {
    name: 'pine_set_source',
    description: 'Set Pine Script source code in the editor',
    inputSchema: {
      source: z.string().describe('Pine Script source code to inject'),
    },
    annotations: DESTRUCTIVE,
    run: ({ source }) => core.setSource({ source }),
  });

  defineTool(server, {
    name: 'pine_compile',
    description: 'Compile / add the current Pine Script to the chart',
    annotations: WRITE,
    run: () => core.compile(),
  });

  defineTool(server, {
    name: 'pine_get_errors',
    description: 'Get Pine Script compilation errors from Monaco markers',
    annotations: READ_ONLY,
    run: () => core.getErrors(),
  });

  defineTool(server, {
    name: 'pine_save',
    description: 'Save the current Pine Script (Ctrl+S)',
    annotations: WRITE,
    run: () => core.save(),
  });

  defineTool(server, {
    name: 'pine_get_console',
    description: 'Read Pine Script console/log output (compile messages, log.info(), errors)',
    annotations: READ_ONLY,
    run: () => core.getConsole(),
  });

  defineTool(server, {
    name: 'pine_smart_compile',
    description: 'Intelligent compile: detects button, compiles, checks errors, reports study changes',
    annotations: WRITE,
    run: () => core.smartCompile(),
  });

  defineTool(server, {
    name: 'pine_new',
    description: 'Create a new blank Pine Script',
    inputSchema: {
      type: z.enum(['indicator', 'strategy', 'library']).describe('Type of script to create'),
    },
    annotations: DESTRUCTIVE,
    run: ({ type }) => core.newScript({ type }),
  });

  defineTool(server, {
    name: 'pine_open',
    description: 'Open a saved Pine Script by name',
    inputSchema: {
      name: z.string().describe('Name of the saved script to open (case-insensitive match)'),
    },
    annotations: DESTRUCTIVE,
    run: ({ name }) => core.openScript({ name }),
    onError: (error) => ({ success: false, source: 'internal_api', error }),
  });

  defineTool(server, {
    name: 'pine_list_scripts',
    description: 'List saved Pine Scripts',
    annotations: READ_ONLY,
    run: () => core.listScripts(),
  });

  defineTool(server, {
    name: 'pine_analyze',
    description: 'Run static analysis on Pine Script code WITHOUT compiling — catches array out-of-bounds, unguarded array.first()/last(), bad loop bounds, and implicit bool casts. Works offline, no TradingView connection needed.',
    inputSchema: {
      source: z.string().describe('Pine Script source code to analyze'),
    },
    annotations: READ_ONLY,
    run: ({ source }) => core.analyze({ source }),
  });

  defineTool(server, {
    name: 'pine_check',
    description: 'Compile Pine Script via TradingView\'s server API without needing the chart open. Returns compilation errors/warnings. Useful for validating code before injecting into the chart.',
    inputSchema: {
      source: z.string().describe('Pine Script source code to compile/validate'),
    },
    annotations: READ_ONLY,
    run: ({ source }) => core.check({ source }),
  });
}
