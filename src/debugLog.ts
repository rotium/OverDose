/**
 * Tiny in-app debug log. When enabled (Settings → App → Developer), key flow
 * events are appended both to the browser console and to an in-memory ring
 * buffer, so the buffer can be copied out after the fact instead of trying to
 * catch a fast-moving moment live on a running machine.
 *
 * Leaf module (no app imports) so anything can call `dlog` without cycles.
 * `dlog` is a cheap no-op when logging is off.
 */
const BUFFER_MAX = 1000;
const buffer: string[] = [];
let enabled = false;

/** Toggle logging on/off (wired to the `debugLogging` pref in App). */
export const setDebugLogging = (on: boolean): void => {
  enabled = on;
};

export const isDebugLogging = (): boolean => enabled;

/** Append a tagged line. No-op when logging is off. */
export const dlog = (tag: string, message: string | number): void => {
  if (!enabled) return;
  const ts =
    typeof performance !== 'undefined'
      ? `${(performance.now() / 1000).toFixed(2)}s`
      : '';
  const line = `${ts}  ${tag}  ${message}`;
  buffer.push(line);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  // eslint-disable-next-line no-console
  console.log('[overdose]', line);
};

/** The buffered log as text (newest last). */
export const getDebugLog = (): string => buffer.join('\n');

/** How many lines are buffered. */
export const debugLogSize = (): number => buffer.length;

/** Empty the buffer. */
export const clearDebugLog = (): void => {
  buffer.length = 0;
};
