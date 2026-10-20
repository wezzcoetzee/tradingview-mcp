import CDP from 'chrome-remote-interface';
import { debug } from './debug.js';

const CDP_HOST = '127.0.0.1';
const DEFAULT_CDP_PORT = 9222;
const MAX_ATTEMPTS = 3;
const BASE_DELAY = 500;
const CONNECT_TIMEOUT_MS = 5000;
const CALL_TIMEOUT_MS = 30000;
const MAX_ERROR_DESC_LEN = 500;
// Nothing is listening, or the host is unreachable: retrying only delays the error.
const FATAL_ERROR_CODES = new Set(['ECONNREFUSED', 'ConnectionRefused', 'ENOTFOUND', 'EADDRNOTAVAIL', 'EHOSTUNREACH']);

type CdpClient = Awaited<ReturnType<typeof CDP>>;
// returnByValue results are JSON, so type them like JSON.parse output.
type JsonValue = ReturnType<typeof JSON.parse>;

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
}

interface Connection {
  client: CdpClient;
  target: CdpTarget;
  /** Send a CDP command with a deadline. Missing it drops the connection so the next call reconnects. */
  call: (method: string, params?: object, ms?: number) => Promise<JsonValue>;
}

interface EvaluateResult {
  result?: { value?: JsonValue };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

interface EvaluateOptions {
  timeoutMs?: number;
  awaitPromise?: boolean;
  [param: string]: unknown;
}

let current: Connection | null = null;
let pendingConnect: Promise<Connection> | null = null;
let preferredTargetId: string | null = null;

export function parseCdpPort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CDP port: ${value}`);
  }
  return port;
}

let cdpPort = process.env.TV_CDP_PORT ? parseCdpPort(process.env.TV_CDP_PORT) : DEFAULT_CDP_PORT;

export function getCdpPort(): number {
  return cdpPort;
}

/** Point every tool at another CDP port (tv_launch calls this). Drops any connection to the old one. */
export function setCdpPort(port: number) {
  const next = parseCdpPort(port);
  if (next === cdpPort) return;
  cdpPort = next;
  void disconnect();
}

export function cdpBaseUrl(port = cdpPort): string {
  return `http://${CDP_HOST}:${port}`;
}

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 */
export function safeString(str) {
  if (str === null || str === undefined) {
    throw new Error('safeString: value must not be null or undefined');
  }
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

/** Trimmed non-empty string; an empty symbol or timeframe would otherwise be a silent no-op. */
export function requireText(value: unknown, name: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new Error(`${name} is required (got ${JSON.stringify(value)})`);
  return s;
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** False for errors that mean nothing is listening on the CDP port, so retrying is pointless. */
export function isTransientError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return !FATAL_ERROR_CODES.has(e?.code ?? e?.cause?.code ?? '');
}

/** GET a CDP HTTP endpoint (/json/list, /json/version, ...) with a deadline. Throws on a non-2xx status. */
export async function cdpFetch(path: string, { port = cdpPort, timeoutMs = CONNECT_TIMEOUT_MS } = {}): Promise<Response> {
  const resp = await fetch(cdpBaseUrl(port) + path, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`CDP ${path} returned HTTP ${resp.status}`);
  return resp;
}

export async function listTargets(): Promise<CdpTarget[]> {
  return (await cdpFetch('/json/list')).json();
}

export function pickChartTarget(targets: CdpTarget[], preferredId: string | null): CdpTarget | null {
  const pages = targets.filter(t => t.type === 'page');
  return pages.find(t => t.id === preferredId)
    ?? pages.find(t => /tradingview\.com\/chart/i.test(t.url))
    ?? pages.find(t => /tradingview/i.test(t.url))
    ?? null;
}

export function setPreferredTargetId(id: string | null) {
  preferredTargetId = id;
}

async function findChartTarget(): Promise<CdpTarget | null> {
  const targets = await listTargets();
  // A closed tab's id never comes back, so stop preferring it.
  if (preferredTargetId && !targets.some(t => t.id === preferredTargetId)) preferredTargetId = null;
  return pickChartTarget(targets, preferredTargetId);
}

function drop(conn: Connection) {
  if (current === conn) current = null;
  conn.client.close().catch(() => {});
}

async function openConnection(): Promise<Connection> {
  const target = await findChartTarget();
  if (!target) {
    throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
  }

  const pending = CDP({ host: CDP_HOST, port: cdpPort, target: target.id });
  let client: CdpClient;
  try {
    client = await withTimeout(pending, CONNECT_TIMEOUT_MS, 'CDP connect');
  } catch (err) {
    // The socket can still open after we gave up on it; close it instead of leaking it.
    pending.then(late => late.close()).catch(() => {});
    throw err;
  }

  const send = client.send.bind(client);
  const conn: Connection = {
    client,
    target,
    call: (method, params = {}, ms = CALL_TIMEOUT_MS) =>
      withTimeout(send(method, params), ms, method).catch((err: unknown) => {
        if (err instanceof TimeoutError) drop(conn);
        throw err;
      }),
  };
  // Domain helpers (client.Input.dispatchKeyEvent, ...) all go through send(), so this gives them deadlines too.
  client.send = (method: string, params?: object, sessionId?: string, callback?: () => void) =>
    callback ? send(method, params, sessionId, callback) : conn.call(method, params);
  client.on('disconnect', () => {
    if (current === conn) current = null;
  });

  try {
    await Promise.all([client.Runtime.enable(), client.Page.enable(), client.DOM.enable()]);
  } catch (err) {
    drop(conn);
    throw err;
  }
  return conn;
}

async function establish(): Promise<Connection> {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await openConnection();
      if (current) drop(current);
      current = conn;
      return conn;
    } catch (err) {
      const msg = errorMessage(err);
      if (!isTransientError(err)) {
        throw new Error(`Cannot reach TradingView at ${cdpBaseUrl()} (${msg}). Start it with tv_launch, or launch it with --remote-debugging-port=${cdpPort}.`);
      }
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`CDP connection failed after ${attempt} attempts: ${msg}`);
      }
      debug('connection', `attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg}`);
      await new Promise(r => setTimeout(r, BASE_DELAY * 2 ** (attempt - 1)));
    }
  }
}

function reconnect(): Promise<Connection> {
  pendingConnect ??= establish().finally(() => { pendingConnect = null; });
  return pendingConnect;
}

function getConnection(): Promise<Connection> {
  return current ? Promise.resolve(current) : reconnect();
}

export async function getClient() {
  return (await getConnection()).client;
}

export async function connect() {
  return (await reconnect()).client;
}

export async function getTargetInfo(): Promise<CdpTarget> {
  return (await getConnection()).target;
}

/**
 * A timeout drops the connection rather than sending Runtime.terminateExecution: if our
 * script is only awaiting a promise, that would terminate TradingView's next script instead.
 */
export async function evaluate(expression: string, { timeoutMs = CALL_TIMEOUT_MS, ...params }: EvaluateOptions = {}) {
  const conn = await getConnection();
  const result: EvaluateResult = await conn.call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: false, ...params },
    timeoutMs,
  );
  if (result.exceptionDetails) {
    const raw = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    const msg = String(raw).slice(0, MAX_ERROR_DESC_LEN);
    debug('evaluate', msg);
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression: string) {
  return evaluate(expression, { awaitPromise: true });
}

export async function disconnect() {
  if (current) drop(current);
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
