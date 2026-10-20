/**
 * Shared MCP tool helpers.
 * All tool files register through defineTool instead of calling server.tool directly.
 */
import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';

/** A `{ success: false }` payload is an error even when no exception was thrown. */
export function jsonResult(obj: unknown, isError = false): CallToolResult {
  const failed = isError || (typeof obj === 'object' && obj !== null && 'success' in obj && obj.success === false);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
    ...(failed && { isError: true }),
  };
}

/** Annotation presets, passed as `annotations`. Anything not read-only is a write. */
export const READ_ONLY = { readOnlyHint: true } satisfies ToolAnnotations;
export const WRITE = { readOnlyHint: false, destructiveHint: false } satisfies ToolAnnotations;
export const IDEMPOTENT_WRITE = { ...WRITE, idempotentHint: true } satisfies ToolAnnotations;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } satisfies ToolAnnotations;

/** Boolean that also accepts "true"/"false" strings; z.coerce.boolean() would turn "false" into true. */
export const zBool = z.union([z.boolean(), z.enum(['true', 'false']).transform(v => v === 'true')]);

interface ToolDefinition<Shape extends ZodRawShape> {
  name: string;
  description: string;
  /** Zod shape; omit for tools without arguments. */
  inputSchema?: Shape;
  annotations: ToolAnnotations;
  run: (args: z.infer<z.ZodObject<Shape>>) => unknown | Promise<unknown>;
  /** Build a custom failure payload (extra hints, cleanup). Defaults to `{ success: false, error }`. */
  onError?: (message: string, err: unknown) => object | Promise<object>;
}

/**
 * Register a tool whose result is returned as JSON text. Thrown errors become
 * an `isError` result, so tools need no try/catch of their own.
 */
export function defineTool<Shape extends ZodRawShape = {}>(
  server: McpServer,
  { name, description, inputSchema, annotations, run, onError }: ToolDefinition<Shape>,
) {
  const handler = async (args: z.infer<z.ZodObject<Shape>>) => {
    try {
      return jsonResult(await run(args));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResult(onError ? await onError(message, err) : { success: false, error: message }, true);
    }
  };
  // The SDK's ToolCallback is a conditional type TypeScript cannot resolve for a generic Shape.
  server.registerTool(
    name,
    { description, inputSchema: inputSchema ?? ({} as Shape), annotations },
    handler as unknown as ToolCallback<Shape>,
  );
}
