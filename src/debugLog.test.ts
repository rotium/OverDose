import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLogLevel, isLevelEnabled, log, setLogLevel } from './debugLog';

/** All console lines emitted this test, across every level method. */
const allLines = (): string[] =>
  [console.error, console.warn, console.info, console.debug].flatMap((fn) =>
    (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (args) => String(args[1]),
    ),
  );

describe('debugLog', () => {
  beforeEach(() => {
    setLogLevel('info');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel('info');
  });

  describe('threshold gating', () => {
    it('at info (default), emits error/warn/info but not debug/trace', () => {
      log.error('a', 'err-line');
      log.warn('a', 'warn-line');
      log.info('a', 'info-line');
      log.debug('a', 'debug-line');
      log.trace('a', 'trace-line');
      const lines = allLines();
      expect(lines).toHaveLength(3);
      expect(lines.join('\n')).toContain('[ERROR]  a  err-line');
      expect(lines.join('\n')).toContain('[WARN]  a  warn-line');
      expect(lines.join('\n')).toContain('[INFO]  a  info-line');
      expect(lines.join('\n')).not.toContain('debug-line');
      expect(lines.join('\n')).not.toContain('trace-line');
    });

    it('at trace, emits every level', () => {
      setLogLevel('trace');
      log.error('a', 'err-line');
      log.warn('a', 'warn-line');
      log.info('a', 'info-line');
      log.debug('a', 'debug-line');
      log.trace('a', 'trace-line');
      expect(allLines()).toHaveLength(5);
      expect(allLines().join('\n')).toContain('[TRACE]  a  trace-line');
    });

    it('at silent, emits nothing', () => {
      setLogLevel('silent');
      log.error('a', 'boom');
      expect(allLines()).toHaveLength(0);
    });

    it('isLevelEnabled reflects the threshold', () => {
      setLogLevel('info');
      expect(isLevelEnabled('error')).toBe(true);
      expect(isLevelEnabled('info')).toBe(true);
      expect(isLevelEnabled('debug')).toBe(false);
      setLogLevel('debug');
      expect(isLevelEnabled('debug')).toBe(true);
      expect(isLevelEnabled('trace')).toBe(false);
    });

    it('getLogLevel returns the active threshold', () => {
      setLogLevel('warn');
      expect(getLogLevel()).toBe('warn');
    });
  });

  describe('console routing', () => {
    it('maps each level to its console method', () => {
      setLogLevel('trace');
      log.error('a', 'x');
      log.warn('a', 'x');
      log.info('a', 'x');
      log.debug('a', 'x');
      log.trace('a', 'x');
      expect(console.error).toHaveBeenCalledOnce();
      expect(console.warn).toHaveBeenCalledOnce();
      expect(console.info).toHaveBeenCalledOnce();
      // debug + trace both route through console.debug
      expect(console.debug).toHaveBeenCalledTimes(2);
    });

    it('prefixes every line with [overdose]', () => {
      log.info('a', 'x');
      expect(console.info).toHaveBeenCalledWith(
        '[overdose]',
        expect.stringContaining('[INFO]  a  x'),
      );
    });
  });

  describe('argument rendering', () => {
    it('JSON-stringifies objects instead of [object Object]', () => {
      log.info('state', { from: 'idle', to: 'espresso' });
      expect(allLines().join('\n')).toContain('{"from":"idle","to":"espresso"}');
    });

    it('renders Error with message and stack, not {}', () => {
      log.error('boom', new Error('kaboom'));
      const text = allLines().join('\n');
      expect(text).toContain('Error: kaboom');
      expect(text).not.toContain('{}');
    });

    it('survives circular references', () => {
      const a: Record<string, unknown> = { name: 'a' };
      a.self = a;
      expect(() => log.info('cyc', a)).not.toThrow();
      expect(allLines().join('\n')).toContain('[Circular]');
    });

    it('joins multiple args with spaces', () => {
      log.info('multi', 'count', 3, { ok: true });
      expect(allLines().join('\n')).toContain('multi  count 3 {"ok":true}');
    });
  });
});
