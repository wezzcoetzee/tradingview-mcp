/** Parse a JSON-object argument that may arrive as a string or an already-parsed object. */
export function parseJsonObject(raw: unknown, name: string): Record<string, unknown> {
  const message = `${name} must be a JSON object, e.g. {"length": 50}`;
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); }
    catch { throw new Error(message); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
