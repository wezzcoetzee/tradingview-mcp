export function isDebugEnabled(): boolean {
  return /\btv-mcp\b/.test(process.env.DEBUG || '');
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function debug(scope: string, ...args: unknown[]) {
  if (!isDebugEnabled()) return;
  process.stderr.write(`[tv-mcp:${scope}] ${args.map(a => a instanceof Error ? a.message : String(a)).join(' ')}\n`);
}
