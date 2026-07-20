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

/**
 * Steam policy shared across every OverDose client of a gateway (same
 * mechanism as {@link STEAM_PURGE_STORE_KEY}). This MUST be shared: the steam
 * controller reconciles `targetSteamTemp` in the background, so two instances
 * holding different desired temps fight over the machine setting. Sharing the
 * policy makes them agree. Display/device prefs deliberately stay local.
 */
const STEAM_POLICY_STORE_KEY = 'steamPolicy';

interface SteamPolicyConfig {
  mode: SteamMode;
  targetTemp: number;
  idleTemp: number;
  autoFlavor: SteamAutoFlavor;
  autoTimeoutMin: number;
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

const STEAM_MODES: readonly SteamMode[] = ['off', 'auto', 'on'];
const STEAM_AUTO_FLAVORS: readonly SteamAutoFlavor[] = ['eco', 'smart'];

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
  /** Re-pull the shared steam policy from the gateway, adopting any change made
   *  by another OverDose instance. Resolves immediately (no-op) without a
   *  gateway. The steam controller calls this before re-asserting against an
   *  external machine change so instances converge instead of fighting. */
  refreshSteamPolicy: () => Promise<void>;
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

  // ── Gateway sync for shared steam config ──
  // The wand-purge config and the steam policy are machine-scoped: they drive
  // the machine and every OverDose client of a gateway must agree on them (two
  // instances with different steam desireds fight over `targetSteamTemp`). So
  // they live on the gateway, keyed separately; localStorage (above) is the
  // cold-start / offline mirror. Gateway is canonical: a value found there on
  // startup overrides the local mirror. Pull on mount + focus; push (debounced)
  // on change, but only after the initial pull resolves so the locally-hydrated
  // value can't clobber a newer gateway value. No-op without a gatewayStore.
  // Display/device prefs are deliberately NOT synced — they stay per-device.
  // `refreshSteamPolicy` re-pulls the shared steam policy on demand (the steam
  // controller calls it to adopt another instance's change before re-asserting).
  // Stays a no-op when there's no gateway.
  let refreshSteamPolicyFn: () => Promise<void> = () => Promise.resolve();

  const gw = p.gatewayStore;
  if (gw) {
    const store = gw;
    const visiblePulls: Array<() => Promise<void>> = [];

    // Sync one KV key ⇄ local signals. `snapshot` reads the signals (so the
    // push effect tracks them); `apply` validates + writes a pulled value.
    // Returns the pull fn so callers can re-pull on demand. A short push
    // debounce (steamPolicy) propagates a change fast enough that a peer's
    // adopt-before-reassert sees fresh data; a longer one (steamPurge) just
    // coalesces edits.
    const registerKvSync = <T,>(
      key: string,
      label: string,
      snapshot: () => T,
      apply: (remote: T) => void,
      debounceMs: number,
    ): (() => Promise<void>) => {
      let hydrated = false;
      let pushTimer: ReturnType<typeof setTimeout> | undefined;
      // A local change is pending upload. While set, a pull must NOT apply the
      // remote value — otherwise an instance can adopt a stale shared value
      // (its own push not landed yet) and revert the user's own change. Cleared
      // once our push has been written to the gateway.
      let dirty = false;

      const pull = async (): Promise<void> => {
        try {
          const remote = await store.get<T>(key);
          if (remote && !dirty) apply(remote);
        } catch (e) {
          // Offline / first run — keep the local mirror value.
          log.warn('steam', `${label} gateway pull failed`, e);
        }
      };

      onMount(() => {
        void pull().finally(() => {
          hydrated = true;
        });
      });
      visiblePulls.push(pull);

      createEffect(() => {
        const cfg = snapshot();
        if (!hydrated) return;
        dirty = true;
        if (pushTimer !== undefined) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
          pushTimer = undefined;
          void store
            .set(key, cfg)
            .catch((e) => log.warn('steam', `${label} gateway push failed`, e))
            .finally(() => {
              dirty = false;
            });
        }, debounceMs);
      });
      onCleanup(() => {
        if (pushTimer !== undefined) clearTimeout(pushTimer);
      });

      return pull;
    };

    registerKvSync<SteamPurgeConfig>(
      STEAM_PURGE_STORE_KEY,
      'steamPurge',
      () => ({
        strategy: steamPurgeStrategy(),
        autoFlushSec: steamAutoFlushSec(),
      }),
      (remote) => {
        if (STEAM_PURGE_STRATEGIES.includes(remote.strategy)) {
          setSteamPurgeStrategy(remote.strategy);
        }
        if (typeof remote.autoFlushSec === 'number') {
          setSteamAutoFlushSec(remote.autoFlushSec);
        }
      },
      400,
    );

    refreshSteamPolicyFn = registerKvSync<SteamPolicyConfig>(
      STEAM_POLICY_STORE_KEY,
      'steamPolicy',
      () => ({
        mode: steamMode(),
        targetTemp: steamTargetTemp(),
        idleTemp: steamIdleTemp(),
        autoFlavor: steamAutoFlavor(),
        autoTimeoutMin: steamAutoTimeoutMin(),
      }),
      (remote) => {
        if (STEAM_MODES.includes(remote.mode)) setSteamMode(remote.mode);
        if (typeof remote.targetTemp === 'number') {
          setSteamTargetTemp(remote.targetTemp);
        }
        if (typeof remote.idleTemp === 'number') setSteamIdleTemp(remote.idleTemp);
        if (STEAM_AUTO_FLAVORS.includes(remote.autoFlavor)) {
          setSteamAutoFlavor(remote.autoFlavor);
        }
        if (typeof remote.autoTimeoutMin === 'number') {
          setSteamAutoTimeoutMin(remote.autoTimeoutMin);
        }
      },
      150,
    );

    onMount(() => {
      const onVisible = (): void => {
        if (document.visibilityState === 'visible') {
          for (const pull of visiblePulls) void pull();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      onCleanup(() =>
        document.removeEventListener('visibilitychange', onVisible),
      );
    });
  }

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
    refreshSteamPolicy: () => refreshSteamPolicyFn(),
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
