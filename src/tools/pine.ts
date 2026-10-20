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
    description: 'Set Pine Script source code in the editor. Replaces the open script\'s contents; the response includes script_name, the script a following pine_save would overwrite.',
    inputSchema: {
      source: z.string().describe('Pine Script source code to inject'),
    },
    annotations: DESTRUCTIVE,
    run: ({ source }) => core.setSource({ source }),
  });

  defineTool(server, {
    name: 'pine_compile',
    description: 'Compile / add the current Pine Script to the chart. compile_confirmed is false when no marker or chart change was seen within 6s.',
    annotations: WRITE,
    run: () => core.compile(),
  });

  defineTool(server, {
    name: 'pine_get_errors',
    description: 'Get Pine Script compilation markers from Monaco. errors are severity 8 only and set has_errors; warnings (severity < 8) are listed separately and do not fail the build.',
    annotations: READ_ONLY,
    run: () => core.getErrors(),
  });

  defineTool(server, {
    name: 'pine_save',
    description: 'Save the current Pine Script (Cmd+S on macOS, Ctrl+S elsewhere). Overwrites the saved script named in script_name. Returns success: false if the save cannot be confirmed.',
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
    description: 'Intelligent compile: detects button, compiles, waits for markers or chart studies to change, reports errors, warnings and study changes. compile_confirmed is false (with a note) when the result may belong to the previous compile.',
    annotations: WRITE,
    run: () => core.smartCompile(),
  });

  defineTool(server, {
    name: 'pine_new',
    description: 'Replace the editor contents with a new blank Pine Script template. Does not open a new tab: if the editor holds a saved script, a following pine_save would overwrite it, so this refuses unless replace_current is true.',
    inputSchema: {
      type: z.enum(['indicator', 'strategy', 'library']).describe('Type of script to create'),
      replace_current: z.boolean().optional().describe('Set true to replace the editor contents even though a saved script is open (a later pine_save would overwrite it)'),
    },
    annotations: DESTRUCTIVE,
    run: ({ type, replace_current }) => core.newScript({ type, replace_current }),
  });

  defineTool(server, {
    name: 'pine_open',
    description: 'Load a saved Pine Script by name into the editor by replacing its contents (the editor still holds the previously open script, so a pine_save would overwrite that one). Refuses when a saved script is open unless replace_current is true.',
    inputSchema: {
      name: z.string().describe('Name of the saved script to open (case-insensitive match)'),
      replace_current: z.boolean().optional().describe('Set true to replace the editor contents even though a saved script is open (a later pine_save would overwrite it)'),
    },
    annotations: DESTRUCTIVE,
    run: ({ name, replace_current }) => core.openScript({ name, replace_current }),
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
