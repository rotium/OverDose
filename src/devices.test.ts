import { describe, expect, it } from 'vitest';
import { deviceStatus, isDeviceConnected, type DevicesFrame } from './devices';

const frame = (...devices: DevicesFrame['devices']): DevicesFrame => ({
  timestamp: '2026-08-29T19:38:27.105Z',
  devices,
  scanning: false,
});

const de1 = { id: 'D3:E2', name: 'DE1', type: 'machine' as const, state: 'connected' as const };
const scale = { id: 'MockScale', name: 'Mock Scale', type: 'scale' as const, state: 'connected' as const };

describe('deviceStatus', () => {
  describe('with the gateway reachable', () => {
    it('reports a connected device as open', () => {
      expect(deviceStatus('open', frame(de1, scale), 'machine')).toBe('open');
      expect(deviceStatus('open', frame(de1, scale), 'scale')).toBe('open');
    });

    it('reports a device missing from the list as closed', () => {
      // A scale that was never paired simply isn't in the inventory.
      expect(deviceStatus('open', frame(de1), 'scale')).toBe('closed');
    });

    it('reports a remembered-but-absent device as closed', () => {
      const remembered = { ...scale, state: 'disconnected' as const, available: false };
      expect(deviceStatus('open', frame(de1, remembered), 'scale')).toBe('closed');
    });

    it('does not count a device that is mid-connect', () => {
      expect(
        deviceStatus('open', frame({ ...de1, state: 'connecting' }), 'machine'),
      ).toBe('closed');
    });

    it('finds a connected device even when a stale entry of the same kind is listed first', () => {
      const stale = { ...scale, id: 'old', state: 'disconnected' as const };
      expect(deviceStatus('open', frame(stale, scale), 'scale')).toBe('open');
    });

    it('waits rather than reporting offline before the first frame lands', () => {
      // The gateway replays state on connect, so this window is brief; showing
      // "offline" here would flash a red pill on every page load.
      expect(deviceStatus('open', null, 'machine')).toBe('connecting');
    });
  });

  describe('with the gateway unreachable', () => {
    it('reports closed regardless of what the last frame said', () => {
      // The critical case: the frame still claims both devices are connected,
      // but we can no longer reach the gateway, so it proves nothing.
      expect(deviceStatus('closed', frame(de1, scale), 'machine')).toBe('closed');
      expect(deviceStatus('closed', frame(de1, scale), 'scale')).toBe('closed');
    });

    it('passes through the connecting state', () => {
      expect(deviceStatus('connecting', null, 'machine')).toBe('connecting');
    });
  });
});

describe('isDeviceConnected', () => {
  it('is true only for the open status', () => {
    expect(isDeviceConnected('open', frame(de1), 'machine')).toBe(true);
    expect(isDeviceConnected('open', frame(de1), 'scale')).toBe(false);
    expect(isDeviceConnected('connecting', null, 'machine')).toBe(false);
    expect(isDeviceConnected('closed', frame(de1), 'machine')).toBe(false);
  });
});
