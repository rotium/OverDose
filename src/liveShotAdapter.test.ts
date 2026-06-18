import { describe, it, expect } from 'vitest';
import { gatewayCaughtUp, HANDOFF_WINDOW_MS } from './liveShotAdapter';
import type { GatewayShotSummary } from './api';

const sum = (timestamp: string): GatewayShotSummary =>
  ({ timestamp }) as unknown as GatewayShotSummary;

describe('gatewayCaughtUp', () => {
  const opt = '2026-05-22T08:00:00.000Z';

  it('is false while there is no gateway summary yet', () => {
    expect(gatewayCaughtUp(null, opt)).toBe(false);
    expect(gatewayCaughtUp(undefined, opt)).toBe(false);
  });

  it('flips true when the gateway start is slightly EARLIER than ours', () => {
    // The real-hardware case the strict `>=` test never handled: the gateway
    // records the same shot starting a touch before our first captured frame.
    expect(gatewayCaughtUp(sum('2026-05-22T07:59:58.000Z'), opt)).toBe(true);
  });

  it('is true when the gateway start is later than ours', () => {
    expect(gatewayCaughtUp(sum('2026-05-22T08:00:05.000Z'), opt)).toBe(true);
  });

  it('is false for the far-older previous shot', () => {
    // A whole shot-cycle earlier — must stay optimistic / keep polling.
    expect(gatewayCaughtUp(sum('2026-05-22T07:58:00.000Z'), opt)).toBe(false);
  });

  it('uses HANDOFF_WINDOW_MS as the boundary', () => {
    const justInside = new Date(Date.parse(opt) - HANDOFF_WINDOW_MS).toISOString();
    const justOutside = new Date(Date.parse(opt) - HANDOFF_WINDOW_MS - 1).toISOString();
    expect(gatewayCaughtUp(sum(justInside), opt)).toBe(true);
    expect(gatewayCaughtUp(sum(justOutside), opt)).toBe(false);
  });
});
