/**
 * Structured logger. Every call is written to the browser console — that's the
 * single sink. We don't keep our own buffer: on a real gateway the skin runs
 * inside an InAppWebView whose host captures all `console.*` into
 * `webview_console.log` (the whole current session, ~1 MB, survives reloads),
 * readable via `GET /api/v1/webview/logs` (`api.webviewLogs()`); in dev the
 * browser devtools console is the sink. The gateway capture records the console
 * *level*, so we map each of our levels onto a console method whose native
 * level survives:
 *
 *   our level  console method   gateway wire level   token in line
 *   error      console.error    ERROR                [ERROR]
 *   warn       console.warn     WARNING              [WARN]
 *   info       console.info     LOG                  [INFO]
 *   debug      console.debug    DEBUG                [DEBUG]
 *   trace      console.debug    DEBUG                [TRACE]
 *
 * `info`/`log` collapse to LOG and `trace`/`debug` collapse to DEBUG on the
 * wire (the WebView has no finer levels), so the `[LEVEL]` token in the line is
 * what keeps all five greppable in both the devtools console and the gateway
 * file.
 *
 * Leaf module (no app imports) so anything can call `log.*` without import
 * cycles. Calls below the active threshold are a cheap no-op.
 */

/**
 * Verbosity threshold, least → most verbose. A message emits when its level is
 * at or below the active threshold; `silent` suppresses everything.
 *
 * Default is `info`: error/warn/info always emit (so a real gateway always
 * captures the session narrative for post-hoc debugging), while debug/trace
 * stay off until a developer raises the level in Settings → Developer.
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** All selectable levels, ordered least → most verbose (for UI pickers). */
export const LOG_LEVELS: readonly LogLevel[] = [
  'silent',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;

/** Verbosity rank — higher is more verbose. `silent` (0) emits nothing. */
const RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/** Emitting levels (everything except `silent`), mapped to their wire setup. */
type EmitLevel = Exclude<LogLevel, 'silent'>;

const CONSOLE_METHOD: Record<EmitLevel, 'error' | 'warn' | 'info' | 'debug'> = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'debug',
  trace: 'debug',
};

const TOKEN: Record<EmitLevel, string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  debug: 'DEBUG',
  trace: 'TRACE',
};

let threshold: LogLevel = 'info';

/** Set the active verbosity threshold (wired to the `logLevel` pref in App). */
export const setLogLevel = (level: LogLevel): void => {
  threshold = level;
};

/** The active verbosity threshold. */
export const getLogLevel = (): LogLevel => threshold;

/**
 * Whether a message at `level` would currently emit. Use this only to guard
 * *expensive* work done solely to build a log line (e.g. a per-frame
 * accumulation) — ordinary `log.*` calls already no-op below the threshold.
 */
export const isLevelEnabled = (level: EmitLevel): boolean =>
  RANK[level] <= RANK[threshold];

/**
 * Render one argument to a log-safe string. Objects are JSON-stringified so the
 * gateway capture stays readable (a bare object renders as `[object Object]`);
 * `Error` is special-cased because `JSON.stringify(err)` yields `{}` and would
 * drop the message + stack — exactly what an `error` line needs to keep.
 */
const render = (arg: unknown): string => {
  if (typeof arg === 'string') return arg;
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (arg instanceof Error) {
    return arg.stack ? `${arg.name}: ${arg.message}\n${arg.stack}` : `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg, circularSafeReplacer());
    } catch {
      return String(arg);
    }
  }
  return String(arg);
};

/** JSON replacer that drops already-seen objects so cycles don't throw. */
const circularSafeReplacer = (): ((key: string, value: unknown) => unknown) => {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
};

const emit = (level: EmitLevel, tag: string, args: unknown[]): void => {
  if (RANK[level] > RANK[threshold]) return;
  const ts = new Date().toISOString();
  const message = args.map(render).join(' ');
  const line = `${ts}  [${TOKEN[level]}]  ${tag}  ${message}`;
  // eslint-disable-next-line no-console
  console[CONSOLE_METHOD[level]]('[overdose]', line);
};

/**
 * Tagged, levelled logger. `tag` is a short greppable namespace
 * (`shot`, `steam`, `ws`, `api`, `state`, …); remaining args are rendered and
 * space-joined into the message.
 */
export const log = {
  trace: (tag: string, ...args: unknown[]): void => emit('trace', tag, args),
  debug: (tag: string, ...args: unknown[]): void => emit('debug', tag, args),
  info: (tag: string, ...args: unknown[]): void => emit('info', tag, args),
  warn: (tag: string, ...args: unknown[]): void => emit('warn', tag, args),
  error: (tag: string, ...args: unknown[]): void => emit('error', tag, args),
};
