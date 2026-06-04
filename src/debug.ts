export function isDebugEnabled(): boolean {
  return /\btv-mcp\b/.test(process.env.DEBUG || '');
}

export function debug(scope, ...args) {
  if (!isDebugEnabled()) return;
  process.stderr.write(`[tv-mcp:${scope}] ${args.map(a => a instanceof Error ? a.message : String(a)).join(' ')}\n`);
}
