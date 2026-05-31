import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { render, waitFor } from '@solidjs/testing-library';
import {
  UserPrefsProvider,
  useUserPrefs,
  type GatewayStore,
} from './UserPrefsContext';
import { MemoryStorage } from './test/memoryStorage';
import { WATER_WARN_MM } from './water';
import {
  DEFAULT_CHART_SMOOTHING,
  DEFAULT_STEAM_AUTO_FLUSH_SEC,
  DEFAULT_TRACE_VISIBILITY,
  DEFAULT_WATER_UNIT,
} from './prefs';

/** In-memory GatewayStore double, optionally seeded. Returns the store plus
 *  the raw mocks for call assertions (the store is cast to the generic
 *  GatewayStore surface, which would otherwise hide the Mock type). */
const fakeGatewayStore = (initial: Record<string, unknown> = {}) => {
  const map = new Map<string, unknown>(Object.entries(initial));
  const getMock = vi.fn((k: string): Promise<unknown> =>
    Promise.resolve(map.has(k) ? map.get(k) : null),
  );
  const setMock = vi.fn((k: string, v: unknown): Promise<void> => {
    map.set(k, v);
    return Promise.resolve();
  });
  const store = { get: getMock, set: setMock } as unknown as GatewayStore;
  return { store, getMock, setMock };
};

const withGatewayProvider = <T,>(store: GatewayStore, body: () => T): T => {
  let result!: T;
  render(() => (
    <UserPrefsProvider storage={new MemoryStorage()} gatewayStore={store}>
      {(() => {
        result = body();
        return null;
      })()}
    </UserPrefsProvider>
  ));
  return result;
};

/** Flush microtasks + a macrotask so the mount-time gateway pull settles. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

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
      expect(prefs.chartSmoothing()).toBe(DEFAULT_CHART_SMOOTHING);
      expect(prefs.traceVisibility()).toEqual(DEFAULT_TRACE_VISIBILITY);
      // Steam-flow slider opts in — hidden by default.
      expect(prefs.showSteamFlowSlider()).toBe(false);
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

  describe('showSteamFlowSlider', () => {
    it('persists when toggled', () => {
      const storage = new MemoryStorage();
      const prefs = withProvider(storage, () => useUserPrefs());
      prefs.setShowSteamFlowSlider(true);
      expect(prefs.showSteamFlowSlider()).toBe(true);
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(parsed.showSteamFlowSlider).toBe(true);
    });

    it('rehydrates from storage', () => {
      const storage = new MemoryStorage();
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ showSteamFlowSlider: true }),
      );
      const prefs = withProvider(storage, () => useUserPrefs());
      expect(prefs.showSteamFlowSlider()).toBe(true);
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

  describe('wand-purge gateway sync', () => {
    it('pulls the shared config from the gateway on mount, overriding local', async () => {
      const { store, getMock } = fakeGatewayStore({
        steamPurge: { strategy: 'manual', autoFlushSec: 7 },
      });
      const prefs = withGatewayProvider(store, () => useUserPrefs());
      expect(getMock).toHaveBeenCalledWith('steamPurge');
      await waitFor(() => expect(prefs.steamPurgeStrategy()).toBe('manual'));
      expect(prefs.steamAutoFlushSec()).toBe(7);
    });

    it('pushes to the gateway when the strategy changes (after hydration)', async () => {
      const { store, setMock } = fakeGatewayStore(); // empty → pull resolves null
      const prefs = withGatewayProvider(store, () => useUserPrefs());
      await tick(); // let the mount pull settle so `hydrated` flips

      prefs.setSteamPurgeStrategy('autoFlush');
      await waitFor(() =>
        expect(setMock).toHaveBeenCalledWith('steamPurge', {
          strategy: 'autoFlush',
          autoFlushSec: DEFAULT_STEAM_AUTO_FLUSH_SEC,
        }),
      );
    });

    it('does not push the locally-hydrated value before the initial pull', async () => {
      // A pull that never resolves keeps `hydrated` false → no push fires even
      // though the signals hold their (local/default) values.
      const setMock = vi.fn(() => Promise.resolve());
      const store = {
        get: vi.fn(() => new Promise<never>(() => {})),
        set: setMock,
      } as unknown as GatewayStore;
      withGatewayProvider(store, () => useUserPrefs());
      await tick();
      expect(setMock).not.toHaveBeenCalled();
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
