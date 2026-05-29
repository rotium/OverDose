import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDebugLog,
  debugLogSize,
  dlog,
  getDebugLog,
  isDebugLogging,
  setDebugLogging,
} from './debugLog';

describe('debugLog', () => {
  beforeEach(() => {
    clearDebugLog();
    setDebugLogging(false);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearDebugLog();
    setDebugLogging(false);
  });

  it('is a no-op while disabled', () => {
    dlog('tag', 'message');
    expect(debugLogSize()).toBe(0);
    expect(getDebugLog()).toBe('');
  });

  it('buffers tagged lines while enabled', () => {
    setDebugLogging(true);
    expect(isDebugLogging()).toBe(true);
    dlog('state', 'idle/idle');
    dlog('steamDur', 30);
    expect(debugLogSize()).toBe(2);
    expect(getDebugLog()).toContain('state  idle/idle');
    expect(getDebugLog()).toContain('steamDur  30');
  });

  it('clears the buffer', () => {
    setDebugLogging(true);
    dlog('a', '1');
    clearDebugLog();
    expect(debugLogSize()).toBe(0);
  });
});
