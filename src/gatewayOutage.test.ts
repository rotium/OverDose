import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGatewayOutage } from './gatewayOutage';
import type { WsStatus } from './streams';

/** Drive the outage tracker from a controllable socket status. */
const harness = (initial: WsStatus = 'connecting') => {
  const [status, setStatus] = createSignal<WsStatus>(initial);
  let dispose = () => {};
  const outage = createRoot((d) => {
    dispose = d;
    return createGatewayOutage(status, 1_000);
  });
  return { ...outage, setStatus, dispose };
};

describe('createGatewayOutage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not report an outage before the grace window elapses', () => {
    const h = harness('open');
    h.setStatus('closed');
    vi.advanceTimersByTime(999);
    expect(h.lost()).toBe(false);
    h.dispose();
  });

  it('reports an outage once the grace window elapses', () => {
    const h = harness('open');
    h.setStatus('closed');
    vi.advanceTimersByTime(1_000);
    expect(h.lost()).toBe(true);
    h.dispose();
  });

  it('rides out a drop that recovers inside the grace window', () => {
    // A gateway restart or a tablet deploy — nothing should ever be shown.
    const h = harness('open');
    h.setStatus('closed');
    vi.advanceTimersByTime(600);
    h.setStatus('open');
    vi.advanceTimersByTime(5_000);
    expect(h.lost()).toBe(false);
    h.dispose();
  });

  it('clears itself when the gateway comes back', () => {
    const h = harness('open');
    h.setStatus('closed');
    vi.advanceTimersByTime(1_000);
    expect(h.lost()).toBe(true);
    h.setStatus('open');
    expect(h.lost()).toBe(false); // auto-dismiss, no user action needed
    h.dispose();
  });

  it('records when the gateway was last reachable', () => {
    vi.setSystemTime(new Date('2026-08-30T09:00:00Z'));
    const h = harness('connecting');
    expect(h.lastConnected()).toBeNull();
    h.setStatus('open');
    const at = h.lastConnected();
    expect(at).toBe(Date.parse('2026-08-30T09:00:00Z'));
    h.setStatus('closed');
    vi.advanceTimersByTime(60_000);
    expect(h.lastConnected()).toBe(at); // frozen at the drop, not moving
    h.dispose();
  });

  it('does not arm a timer that outlives the owner', () => {
    const h = harness('open');
    h.setStatus('closed');
    h.dispose();
    vi.advanceTimersByTime(10_000);
    expect(h.lost()).toBe(false);
  });
});
