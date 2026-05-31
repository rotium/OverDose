import {
  createContext,
  createEffect,
  createSignal,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import {
  DEFAULT_CHART_SMOOTHING,
  DEFAULT_DEBUG_LOGGING,
  DEFAULT_HAS_SCALE,
  DEFAULT_STEAM_AUTO_FLUSH_SEC,
  DEFAULT_STEAM_PURGE_STRATEGY,
  DEFAULT_TRACE_VISIBILITY,
  DEFAULT_WATER_UNIT,
  type ChartSmoothing,
  type SteamPurgeStrategy,
  type TraceVisibility,
  type WaterUnit,
} from './prefs';
import { WATER_WARN_MM } from './water';

const STORAGE_KEY = 'starter-skin.prefs.v1';

/**
 * Shape persisted to localStorage. All fields optional so a future field
 * addition is forward-compatible with stored blobs from older versions —
 * missing keys fall back to defaults.
 */
interface PersistedPrefs {
  waterUnit?: WaterUnit;
  waterWarnMm?: number;
  chartSmoothing?: ChartSmoothing;
  traceVisibility?: TraceVisibility;
  showSteamFlowSlider?: boolean;
  showWaterFlowSlider?: boolean;
  showFlushFlowSlider?: boolean;
  hasScale?: boolean;
  debugLogging?: boolean;
  steamPurgeStrategy?: SteamPurgeStrategy;
  steamAutoFlushSec?: number;
}

export interface UserPrefsContextValue {
  waterUnit: Accessor<WaterUnit>;
  setWaterUnit: (u: WaterUnit) => void;
  waterWarnMm: Accessor<number>;
  setWaterWarnMm: (mm: number) => void;
  chartSmoothing: Accessor<ChartSmoothing>;
  setChartSmoothing: (s: ChartSmoothing) => void;
  traceVisibility: Accessor<TraceVisibility>;
  setTraceVisibility: (v: TraceVisibility) => void;
  /** Update a single trace flag without rebuilding the whole object inline. */
  setTraceVisible: (k: keyof TraceVisibility, v: boolean) => void;
  /**
   * Whether the live steam view exposes an in-session steam-flow slider.
   * Default off — the value is still shown in the readouts row regardless;
   * the toggle is purely about whether a slider control appears below the
   * hero so the user can tune mid-session.
   */
  showSteamFlowSlider: Accessor<boolean>;
  setShowSteamFlowSlider: (v: boolean) => void;
  /** Whether the live hot-water view exposes a mid-pour flow slider. Default
   *  off; the flow value always shows in the readouts row regardless. */
  showWaterFlowSlider: Accessor<boolean>;
  setShowWaterFlowSlider: (v: boolean) => void;
  /** Whether the live flush view exposes a mid-flush flow slider. Default
   *  off. */
  showFlushFlowSlider: Accessor<boolean>;
  setShowFlushFlowSlider: (v: boolean) => void;
  /** Whether a scale is part of the setup. Default true. When false the skin
   *  hides scale UI (header pill + dashboard readout). */
  hasScale: Accessor<boolean>;
  setHasScale: (v: boolean) => void;
  /** Developer console/debug logging. Default off. */
  debugLogging: Accessor<boolean>;
  setDebugLogging: (v: boolean) => void;
  /** How the post-steam wand purge is triggered (and the firmware
   *  `steamPurgeMode` it writes through). Default `firmware`. */
  steamPurgeStrategy: Accessor<SteamPurgeStrategy>;
  setSteamPurgeStrategy: (v: SteamPurgeStrategy) => void;
  /** Dwell seconds before `autoFlush` fires the purge. */
  steamAutoFlushSec: Accessor<number>;
  setSteamAutoFlushSec: (v: number) => void;
}

const Ctx = createContext<UserPrefsContextValue>();

const readPersisted = (storage: Storage): PersistedPrefs => {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PersistedPrefs;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

export interface UserPrefsProviderProps {
  /** Injectable for tests; defaults to `globalThis.localStorage`. */
  storage?: Storage;
  children?: JSX.Element;
}

export const UserPrefsProvider: Component<UserPrefsProviderProps> = (p) => {
  const storage = p.storage ?? globalThis.localStorage;
  const initial = readPersisted(storage);

  const [waterUnit, setWaterUnit] = createSignal<WaterUnit>(
    initial.waterUnit ?? DEFAULT_WATER_UNIT,
  );
  const [waterWarnMm, setWaterWarnMm] = createSignal<number>(
    initial.waterWarnMm ?? WATER_WARN_MM,
  );
  const [chartSmoothing, setChartSmoothing] = createSignal<ChartSmoothing>(
    initial.chartSmoothing ?? DEFAULT_CHART_SMOOTHING,
  );
  const [traceVisibility, setTraceVisibility] = createSignal<TraceVisibility>(
    initial.traceVisibility ?? DEFAULT_TRACE_VISIBILITY,
  );
  const [showSteamFlowSlider, setShowSteamFlowSlider] = createSignal<boolean>(
    initial.showSteamFlowSlider ?? false,
  );
  const [showWaterFlowSlider, setShowWaterFlowSlider] = createSignal<boolean>(
    initial.showWaterFlowSlider ?? false,
  );
  const [showFlushFlowSlider, setShowFlushFlowSlider] = createSignal<boolean>(
    initial.showFlushFlowSlider ?? false,
  );
  const [hasScale, setHasScale] = createSignal<boolean>(
    initial.hasScale ?? DEFAULT_HAS_SCALE,
  );
  const [debugLogging, setDebugLogging] = createSignal<boolean>(
    initial.debugLogging ?? DEFAULT_DEBUG_LOGGING,
  );
  const [steamPurgeStrategy, setSteamPurgeStrategy] =
    createSignal<SteamPurgeStrategy>(
      initial.steamPurgeStrategy ?? DEFAULT_STEAM_PURGE_STRATEGY,
    );
  const [steamAutoFlushSec, setSteamAutoFlushSec] = createSignal<number>(
    initial.steamAutoFlushSec ?? DEFAULT_STEAM_AUTO_FLUSH_SEC,
  );

  const setTraceVisible = (k: keyof TraceVisibility, v: boolean) =>
    setTraceVisibility({ ...traceVisibility(), [k]: v });

  // Persist on any change. The first run is a no-op write of the same content
  // we just hydrated — harmless and avoids a special-case "skip first" guard.
  createEffect(() => {
    const shape: PersistedPrefs = {
      waterUnit: waterUnit(),
      waterWarnMm: waterWarnMm(),
      chartSmoothing: chartSmoothing(),
      traceVisibility: traceVisibility(),
      showSteamFlowSlider: showSteamFlowSlider(),
      showWaterFlowSlider: showWaterFlowSlider(),
      showFlushFlowSlider: showFlushFlowSlider(),
      hasScale: hasScale(),
      debugLogging: debugLogging(),
      steamPurgeStrategy: steamPurgeStrategy(),
      steamAutoFlushSec: steamAutoFlushSec(),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(shape));
  });

  const value: UserPrefsContextValue = {
    waterUnit,
    setWaterUnit,
    waterWarnMm,
    setWaterWarnMm,
    chartSmoothing,
    setChartSmoothing,
    traceVisibility,
    setTraceVisibility,
    setTraceVisible,
    showSteamFlowSlider,
    setShowSteamFlowSlider,
    showWaterFlowSlider,
    setShowWaterFlowSlider,
    showFlushFlowSlider,
    setShowFlushFlowSlider,
    hasScale,
    setHasScale,
    debugLogging,
    setDebugLogging,
    steamPurgeStrategy,
    setSteamPurgeStrategy,
    steamAutoFlushSec,
    setSteamAutoFlushSec,
  };

  return <Ctx.Provider value={value}>{p.children}</Ctx.Provider>;
};

export function useUserPrefs(): UserPrefsContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useUserPrefs must be used inside <UserPrefsProvider>');
  }
  return ctx;
}
