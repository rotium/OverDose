import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import { render } from '@solidjs/testing-library';
import { UserPrefsProvider, useUserPrefs } from './UserPrefsContext';
import { MemoryStorage } from './test/memoryStorage';
import { WATER_BLOCK_MM, WATER_WARN_MM } from './water';
import {
  DEFAULT_CHART_SMOOTHING,
  DEFAULT_TRACE_VISIBILITY,
  DEFAULT_WATER_UNIT,
} from './prefs';

const STORAGE_KEY = 'starter-skin.prefs.v1';

const withProvider = <T,>(storage: Storage, body: () => T): T => {
  let result!: T;
  render(() => (
    <UserPrefsProvider storage={storage}>
      {(() => {
        result = body();
        return null;
      })()}
    </UserPrefsProvider>
  ));
  return result;
};

describe('UserPrefsContext', () => {
  describe('defaults', () => {
    it('falls back to module defaults when storage is empty', () => {
      const storage = new MemoryStorage();
      const prefs = withProvider(storage, () => useUserPrefs());

      expect(prefs.waterUnit()).toBe(DEFAULT_WATER_UNIT);
      expect(prefs.waterWarnMm()).toBe(WATER_WARN_MM);
      expect(prefs.waterBlockMm()).toBe(WATER_BLOCK_MM);
      expect(prefs.chartSmoothing()).toBe(DEFAULT_CHART_SMOOTHING);
      expect(prefs.traceVisibility()).toEqual(DEFAULT_TRACE_VISIBILITY);
    });

    it('falls back to defaults when storage contains corrupt JSON', () => {
      const storage = new MemoryStorage();
      storage.setItem(STORAGE_KEY, '{not json');
      const prefs = withProvider(storage, () => useUserPrefs());
      expect(prefs.waterUnit()).toBe(DEFAULT_WATER_UNIT);
    });
  });

  describe('hydration', () => {
    it('reads all keys from a previously-persisted blob', () => {
      const storage = new MemoryStorage();
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          waterUnit: 'both',
          waterWarnMm: 7,
          waterBlockMm: 2,
          chartSmoothing: 'linear',
          traceVisibility: {
            pressure: false,
            flow: true,
            weightFlow: false,
            weight: true,
            mixTemp: false,
            targets: true,
          },
        }),
      );

      const prefs = withProvider(storage, () => useUserPrefs());

      expect(prefs.waterUnit()).toBe('both');
      expect(prefs.waterWarnMm()).toBe(7);
      expect(prefs.waterBlockMm()).toBe(2);
      expect(prefs.chartSmoothing()).toBe('linear');
      expect(prefs.traceVisibility().pressure).toBe(false);
      expect(prefs.traceVisibility().targets).toBe(true);
    });

    it('mixes stored keys with defaults for missing ones', () => {
      const storage = new MemoryStorage();
      storage.setItem(STORAGE_KEY, JSON.stringify({ waterUnit: 'mm' }));
      const prefs = withProvider(storage, () => useUserPrefs());
      expect(prefs.waterUnit()).toBe('mm');
      // Unspecified fields still come from module defaults.
      expect(prefs.chartSmoothing()).toBe(DEFAULT_CHART_SMOOTHING);
    });
  });

  describe('persistence', () => {
    it('writes the full blob on any single change', () => {
      const storage = new MemoryStorage();
      const prefs = withProvider(storage, () => useUserPrefs());

      prefs.setWaterUnit('mm');

      const raw = storage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.waterUnit).toBe('mm');
      expect(parsed.chartSmoothing).toBe(DEFAULT_CHART_SMOOTHING);
    });

    it('round-trips through a fresh provider on the same storage', () => {
      const storage = new MemoryStorage();

      createRoot((dispose) => {
        const prefs = withProvider(storage, () => useUserPrefs());
        prefs.setWaterWarnMm(8);
        prefs.setChartSmoothing('spline');
        dispose();
      });

      // New provider, same storage — values should hydrate.
      const next = withProvider(storage, () => useUserPrefs());
      expect(next.waterWarnMm()).toBe(8);
      expect(next.chartSmoothing()).toBe('spline');
    });
  });

  describe('setTraceVisible helper', () => {
    it('updates a single flag without disturbing the others', () => {
      const storage = new MemoryStorage();
      const prefs = withProvider(storage, () => useUserPrefs());

      prefs.setTraceVisible('mixTemp', false);

      const v = prefs.traceVisibility();
      expect(v.mixTemp).toBe(false);
      expect(v.pressure).toBe(true);
      expect(v.flow).toBe(true);
      expect(v.targets).toBe(true);
    });
  });

  describe('useUserPrefs outside provider', () => {
    it('throws a clear error', () => {
      expect(() =>
        createRoot((dispose) => {
          try {
            useUserPrefs();
          } finally {
            dispose();
          }
        }),
      ).toThrow(/UserPrefsProvider/);
    });
  });
});
