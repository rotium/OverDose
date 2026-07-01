import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import { log, type LogLevel } from './debugLog';
import {
  DEFAULT_AUTO_STOP_MODE,
  DEFAULT_CHART_SMOOTHING,
  DEFAULT_HAS_SCALE,
  DEFAULT_LOG_LEVEL,
  DEFAULT_SOUND_CUES,
  DEFAULT_STEAM_AUTO_FLAVOR,
  DEFAULT_STEAM_AUTO_FLUSH_SEC,
  DEFAULT_STEAM_AUTO_TIMEOUT_MIN,
  DEFAULT_STEAM_IDLE_TEMP,
  DEFAULT_STEAM_MODE,
  DEFAULT_STEAM_PURGE_STRATEGY,
  DEFAULT_STEAM_TARGET_TEMP,
  DEFAULT_TRACE_VISIBILITY,
  DEFAULT_WATER_INTAKE_OFFSET,
  DEFAULT_WATER_UNIT,
  type AutoStopMode,
  type ChartSmoothing,
  type SteamAutoFlavor,
  type SteamMode,
  type SteamPurgeStrategy,
  type TraceVisibility,
  type WaterUnit,
} from './prefs';
import { WATER_WARN_MM } from './water';

const STORAGE_KEY = 'starter-skin.prefs.v1';

/**
 * Gateway KV key for the shared wand-purge config. The strategy + dwell are
 * machine-scoped (they drive the firmware `steamPurgeMode`), so they live on
 * the gateway and are shared across every client of that gateway — the
 * localStorage blob is just a cold-start / offline mirror. Gateway is
 * canonical: a value found there on startup overrides the local mirror. See
 * docs/storage-sync.md. (Dedicated key rather than the full `prefs` blob — the
 * broader prefs sync is a separate effort.)
 */
const STEAM_PURGE_STORE_KEY = 'steamPurge';

/** The subset of prefs persisted to the gateway under STEAM_PURGE_STORE_KEY. */
interface SteamPurgeConfig {
  strategy: SteamPurgeStrategy;
  autoFlushSec: number;
}

/** Minimal gateway KV accessor surface (a subset of `api`), injected so the
 *  provider stays testable and so non-gateway contexts (tests) opt out simply
 *  by not passing it — in which case the prefs are localStorage-only. */
export interface GatewayStore {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<void>;
}

const STEAM_PURGE_STRATEGIES: readonly SteamPurgeStrategy[] = [
  'firmware',
  'autoFlush',
  'manual',
];

/**
 * Shape persisted to localStorage. All fields optional so a future field
 * addition is forward-compatible with stored blobs from older versions —
 * missing keys fall back to defaults.
 */
interface PersistedPrefs {
  waterUnit?: WaterUnit;
  waterWarnMm?: number;
  waterIntakeOffset?: boolean;
  chartSmoothing?: ChartSmoothing;
  traceVisibility?: TraceVisibility;
  showSteamFlowSlider?: boolean;
  showWaterFlowSlider?: boolean;
  showFlushFlowSlider?: boolean;
  hasScale?: boolean;
  logLevel?: LogLevel;
  soundCues?: boolean;
  steamPurgeStrategy?: SteamPurgeStrategy;
  steamAutoFlushSec?: number;
  autoStopMode?: AutoStopMode;
  steamTargetTemp?: number;
  steamMode?: SteamMode;
  steamAutoFlavor?: SteamAutoFlavor;
  steamIdleTemp?: number;
  steamAutoTimeoutMin?: number;
}

export interface UserPrefsContextValue {
  waterUnit: Accessor<WaterUnit>;
  setWaterUnit: (u: WaterUnit) => void;
  waterWarnMm: Accessor<number>;
  setWaterWarnMm: (mm: number) => void;
  /**
   * TEMPORARY debug toggle — add the DE1 intake-tube offset (~5mm) to the
   * displayed water level before mm/mL/fill conversion. Default on. See
   * DEFAULT_WATER_INTAKE_OFFSET / WATER_INTAKE_OFFSET_MM.
   */
  waterIntakeOffset: Accessor<boolean>;
  setWaterIntakeOffset: (v: boolean) => void;
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
  /** Developer log verbosity. Default `info`. See `debugLog.ts`. */
  logLevel: Accessor<LogLevel>;
  setLogLevel: (v: LogLevel) => void;
  /** Play a short audio cue on the sleep/wake transition. Default on. */
  soundCues: Accessor<boolean>;
  setSoundCues: (v: boolean) => void;
  /** How the post-steam wand purge is triggered (and the firmware
   *  `steamPurgeMode` it writes through). Default `firmware`. */
  steamPurgeStrategy: Accessor<SteamPurgeStrategy>;
  setSteamPurgeStrategy: (v: SteamPurgeStrategy) => void;
  /** Dwell seconds before `autoFlush` fires the purge. */
  steamAutoFlushSec: Accessor<number>;
  setSteamAutoFlushSec: (v: number) => void;
  /** Global default auto-stop mode; overridable per shot in the prep card. */
  autoStopMode: Accessor<AutoStopMode>;
  setAutoStopMode: (v: AutoStopMode) => void;
  /**
   * Desired steam-boiler target temp (°C) — the skin owns this. The status
   * steam toggle pushes it to the machine (on) or 0 (off), and the machine is
   * re-synced to it on focus; only the on/off state is read back. Default 170.
   */
  steamTargetTemp: Accessor<number>;
  setSteamTargetTemp: (v: number) => void;
  /**
   * Steam mode (Off / Auto / On) chosen from the Home steam toggle. On/Off are
   * wired now; Auto's runtime behaviour lands in a later phase.
   */
  steamMode: Accessor<SteamMode>;
  setSteamMode: (v: SteamMode) => void;
  /** Auto-mode config: warm-up trigger flavour (Eco / Smart). */
  steamAutoFlavor: Accessor<SteamAutoFlavor>;
  setSteamAutoFlavor: (v: SteamAutoFlavor) => void;
  /** Auto-mode config: idle/"off" temperature the boiler drops to (°C). */
  steamIdleTemp: Accessor<number>;
  setSteamIdleTemp: (v: number) => void;
  /** Auto-mode config: minutes before dropping to the idle temperature. */
  steamAutoTimeoutMin: Accessor<number>;
  setSteamAutoTimeoutMin: (v: number) => void;
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
  /** Gateway KV accessor for shared (cross-client) prefs. When provided, the
   *  wand-purge config is read from the gateway on mount + window focus and
   *  written back on change. When absent (most tests), prefs are
   *  localStorage-only — no network. */
  gatewayStore?: GatewayStore;
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
  const [waterIntakeOffset, setWaterIntakeOffset] = createSignal<boolean>(
    initial.waterIntakeOffset ?? DEFAULT_WATER_INTAKE_OFFSET,
  );
  const [chartSmoothing, setChartSmoothing] = createSignal<ChartSmoothing>(
    initial.chartSmoothing ?? DEFAULT_CHART_SMOOTHING,
  );
  const [traceVisibility, setTraceVisibility] = createSignal<TraceVisibility>(
    // Merge over the defaults so keys added after a user's prefs were saved
    // (e.g. `steps`) take their default rather than reading as undefined/off.
    { ...DEFAULT_TRACE_VISIBILITY, ...initial.traceVisibility },
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
  const [logLevel, setLogLevel] = createSignal<LogLevel>(
    initial.logLevel ?? DEFAULT_LOG_LEVEL,
  );
  const [soundCues, setSoundCues] = createSignal<boolean>(
    initial.soundCues ?? DEFAULT_SOUND_CUES,
  );
  const [steamPurgeStrategy, setSteamPurgeStrategy] =
    createSignal<SteamPurgeStrategy>(
      initial.steamPurgeStrategy ?? DEFAULT_STEAM_PURGE_STRATEGY,
    );
  const [steamAutoFlushSec, setSteamAutoFlushSec] = createSignal<number>(
    initial.steamAutoFlushSec ?? DEFAULT_STEAM_AUTO_FLUSH_SEC,
  );
  const [autoStopMode, setAutoStopMode] = createSignal<AutoStopMode>(
    initial.autoStopMode ?? DEFAULT_AUTO_STOP_MODE,
  );
  const [steamTargetTemp, setSteamTargetTemp] = createSignal<number>(
    initial.steamTargetTemp ?? DEFAULT_STEAM_TARGET_TEMP,
  );
  const [steamMode, setSteamMode] = createSignal<SteamMode>(
    initial.steamMode ?? DEFAULT_STEAM_MODE,
  );
  const [steamAutoFlavor, setSteamAutoFlavor] = createSignal<SteamAutoFlavor>(
    initial.steamAutoFlavor ?? DEFAULT_STEAM_AUTO_FLAVOR,
  );
  const [steamIdleTemp, setSteamIdleTemp] = createSignal<number>(
    initial.steamIdleTemp ?? DEFAULT_STEAM_IDLE_TEMP,
  );
  const [steamAutoTimeoutMin, setSteamAutoTimeoutMin] = createSignal<number>(
    initial.steamAutoTimeoutMin ?? DEFAULT_STEAM_AUTO_TIMEOUT_MIN,
  );

  const setTraceVisible = (k: keyof TraceVisibility, v: boolean) =>
    setTraceVisibility({ ...traceVisibility(), [k]: v });

  // Persist on any change. The first run is a no-op write of the same content
  // we just hydrated — harmless and avoids a special-case "skip first" guard.
  createEffect(() => {
    const shape: PersistedPrefs = {
      waterUnit: waterUnit(),
      waterWarnMm: waterWarnMm(),
      waterIntakeOffset: waterIntakeOffset(),
      chartSmoothing: chartSmoothing(),
      traceVisibility: traceVisibility(),
      showSteamFlowSlider: showSteamFlowSlider(),
      showWaterFlowSlider: showWaterFlowSlider(),
      showFlushFlowSlider: showFlushFlowSlider(),
      hasScale: hasScale(),
      logLevel: logLevel(),
      soundCues: soundCues(),
      steamPurgeStrategy: steamPurgeStrategy(),
      steamAutoFlushSec: steamAutoFlushSec(),
      autoStopMode: autoStopMode(),
      steamTargetTemp: steamTargetTemp(),
      steamMode: steamMode(),
      steamAutoFlavor: steamAutoFlavor(),
      steamIdleTemp: steamIdleTemp(),
      steamAutoTimeoutMin: steamAutoTimeoutMin(),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(shape));
  });

  // ── Gateway sync for the shared wand-purge config (Option A) ──
  // Gateway is canonical; localStorage (above) is the cold-start mirror. We
  // pull on mount + on focus, and push (debounced) on change — but only after
  // the initial pull resolves, so the locally-hydrated value can't clobber a
  // newer gateway value before we've read it. No-op without a gatewayStore.
  const gw = p.gatewayStore;
  if (gw) {
    let hydrated = false;
    let pushTimer: ReturnType<typeof setTimeout> | undefined;

    const pull = async (): Promise<void> => {
      try {
        const remote = await gw.get<SteamPurgeConfig>(STEAM_PURGE_STORE_KEY);
        if (remote) {
          if (STEAM_PURGE_STRATEGIES.includes(remote.strategy)) {
            setSteamPurgeStrategy(remote.strategy);
          }
          if (typeof remote.autoFlushSec === 'number') {
            setSteamAutoFlushSec(remote.autoFlushSec);
          }
        }
      } catch (e) {
        // Offline / first run — keep the local mirror value.
        log.warn('steam', 'steamPurge gateway pull failed', e);
      }
    };

    onMount(() => {
      void pull().finally(() => {
        hydrated = true;
      });
      const onVisible = (): void => {
        if (document.visibilityState === 'visible') void pull();
      };
      document.addEventListener('visibilitychange', onVisible);
      onCleanup(() => document.removeEventListener('visibilitychange', onVisible));
    });

    // Push on change. Reads both signals so it tracks them; bails until the
    // initial pull has resolved (a pre-hydration run would be the local value).
    createEffect(() => {
      const cfg: SteamPurgeConfig = {
        strategy: steamPurgeStrategy(),
        autoFlushSec: steamAutoFlushSec(),
      };
      if (!hydrated) return;
      if (pushTimer !== undefined) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        pushTimer = undefined;
        void gw.set(STEAM_PURGE_STORE_KEY, cfg).catch((e) =>
          log.warn('steam', 'steamPurge gateway push failed', e),
        );
      }, 400);
    });
    onCleanup(() => {
      if (pushTimer !== undefined) clearTimeout(pushTimer);
    });
  }

  const value: UserPrefsContextValue = {
    waterUnit,
    setWaterUnit,
    waterWarnMm,
    setWaterWarnMm,
    waterIntakeOffset,
    setWaterIntakeOffset,
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
    logLevel,
    setLogLevel,
    soundCues,
    setSoundCues,
    steamPurgeStrategy,
    setSteamPurgeStrategy,
    steamAutoFlushSec,
    setSteamAutoFlushSec,
    autoStopMode,
    setAutoStopMode,
    steamTargetTemp,
    setSteamTargetTemp,
    steamMode,
    setSteamMode,
    steamAutoFlavor,
    setSteamAutoFlavor,
    steamIdleTemp,
    setSteamIdleTemp,
    steamAutoTimeoutMin,
    setSteamAutoTimeoutMin,
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
