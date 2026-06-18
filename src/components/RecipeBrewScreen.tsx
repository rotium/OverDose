import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
  type Component,
} from 'solid-js';
import {
  formatStepType,
  type Pitcher,
  type Routine,
  type RoutineStep,
  type Recipe,
  type StepType,
} from '../domain';
import { useRepositories } from '../RepositoriesContext';
import {
  isHeaterOff,
  isWarmingUp,
  type MachineSnapshot,
  type MachineState,
  type ShotSettingsSnapshot,
} from '../snapshot';
import { PowerIcon, ThermometerIcon, WaterDropIcon } from './icons';
import type { WsStream } from '../streams';
import {
  api,
  type Bean,
  type GatewayShotRecord,
  type GatewayShotSummary,
  type ProfileRecord,
  type ShotAnnotationsPatch,
  type ShotPatch,
  type WorkflowUpdate,
} from '../api';
import { buildProfileCurve } from '../profile/curve';
import { deriveShotStats } from '../shotStats';
import { ShotReview } from './ShotReview';
import { type AutoStopMode, type TraceVisibility } from '../prefs';
import {
  autoStopLabel,
  autoStopUnavailableReason,
  computeStopTargets,
  isStopModeApplicable,
} from '../autoStop';
import { ProfileCurveChart } from './settings/sections/library/ProfileCurveChart';
import { ProfilePicker } from './settings/sections/library/ProfilePicker';
import { BeanPicker } from './settings/sections/library/BeanPicker';
import { PickerDialog } from './PickerDialog';
import { DebouncedNumberField } from './settings/sections/library/DebouncedNumberField';
import { DebouncedSliderField } from './settings/DebouncedSliderField';
import { dlog } from '../debugLog';

/**
 * Recipe-driven brewing runtime — full-screen replacement for Home that
 * walks the user through a Recipe's steps one at a time. The screen owns
 * step orchestration (prep + start request); the live in-progress UI is
 * still handled by the existing LiveBrewDrawer overlay (per the agreed
 * scope — see [[starter-skin-brew-runtime]]).
 *
 * State machine per step:
 *
 *   pending   — not yet attempted; the prep card + Start button is shown
 *               for the *current* one of these.
 *   requested — user tapped Start; we called requestState() and are
 *               waiting for the gateway to enter the matching machine
 *               state. Brief — usually flips to running within a frame.
 *   running   — machine is in the requested state; we're waiting for it
 *               to leave (back to idle / something else).
 *   done      — machine left the requested state. Step is complete.
 *   skipped   — user clicked a later step in the step bar, skipping past
 *               this one.
 *
 * Step → gateway-state map: brew→espresso, steam→steam, water→hotWater,
 * flush→flush. (Reaprime's MachineState type — see `snapshot.ts`.)
 *
 * Auto-mode is deliberately not implemented yet — manual only. See
 * [[starter-skin-brew-auto-mode]] for the failure-detection and config
 * surface considerations that need to be resolved first.
 */
export type StepStatus =
  | 'pending'
  | 'requested'
  | 'running'
  | 'done'
  | 'skipped';

export const stepToGatewayState = (t: StepType): MachineState => {
  switch (t) {
    case 'brew':
      return 'espresso';
    case 'steam':
      return 'steam';
    case 'water':
      return 'hotWater';
    case 'flush':
      return 'flush';
  }
};

export interface RecipeBrewScreenProps {
  recipeId: string;
  /** Ad-hoc bundle override — when provided, the screen uses this
   *  recipe+routine directly instead of looking `recipeId` up in the
   *  repositories. Used by the Explore "Brew" flow, which builds a one-off
   *  brew from the gateway's current workflow (no saved Recipe). */
  bundleOverride?: BrewBundle;
  /** Returns the user to Home; called by the back arrow and Done. */
  onExit: () => void;
  /** Streams the machine snapshot — used to detect step-end transitions. */
  machineStream: () => WsStream<MachineSnapshot>;
  /** True when the water tank is below the brewing-block threshold.
   *  Optional — when omitted (e.g. unit tests that don't care), water
   *  gating is off. App.tsx supplies the real signal. */
  isWaterCritical?: Accessor<boolean>;
  /** Fires a gateway state request (typically `api.requestState`). */
  requestState: (state: MachineState) => Promise<void>;
  /** Live scale-connection state — gates which auto-stop modes the prep card
   *  offers (weight needs a scale, volume needs none). Optional; defaults to
   *  "no scale" when omitted (tests). */
  scaleConnected?: Accessor<boolean>;
  /** Global default auto-stop mode (from prefs). Seeds the per-shot choice;
   *  the prep card can override it. Optional; defaults to `auto`. */
  autoStopMode?: Accessor<AutoStopMode>;
  /** Live shotSettings stream — needed to build the full-body shotSettings
   *  POST that applies the chosen pitcher's steam temp + duration when a
   *  steam step starts. Optional: when absent (tests) the write is skipped
   *  and the firmware keeps whatever settings it already has. */
  shotSettingsStream?: () => WsStream<ShotSettingsSnapshot>;
  /** Persists shotSettings (full body). Defaults to `api.updateShotSettings`. */
  updateShotSettings?: (settings: ShotSettingsSnapshot) => Promise<void>;
  /** Sparse machine-settings update — used to apply the steam flow (which
   *  lives on machineSettings, not shotSettings). Defaults to
   *  `api.updateMachineSettings`. */
  updateMachineSettings?: (partial: { steamFlow: number }) => Promise<void>;
  /** One-shot machine-settings fetch — seeds the steam-flow slider from the
   *  machine's current value when no pitcher is preselected. Only `steamFlow`
   *  is read. Defaults to `api.machineSettings` (null on failure). */
  loadMachineSettings?: () => Promise<{ steamFlow: number } | null>;
  /** Pitcher-list fetcher for the steam step's pitcher picker. Defaults to
   *  the repository (`repos.pitchers.list`). */
  loadPitchers?: () => Promise<Pitcher[]>;
  /** Whether the steam-flow slider is shown in steam prep — mirrors the
   *  "Show steam-flow slider during steaming" pref. Default false; flow is
   *  still applied from the pitcher either way, just not editable here. */
  showFlowSlider?: () => boolean;
  /** Saved default trace visibility (Settings), seeding the post-brew chart. */
  traceVisibility?: Accessor<TraceVisibility>;
  /** Recent drinker names for the post-brew "For" autocomplete. */
  fetchDrinkers?: () => Promise<string[]>;
  /** Single-profile fetcher used to render the brew step's prep card.
   *  Resolves to `null` on any failure (deleted, hidden, gateway offline)
   *  so the prep card degrades to a graceful "(missing profile)" hint
   *  instead of crashing the resource. Default mirrors that contract. */
  loadProfileById?: (id: string) => Promise<ProfileRecord | null>;
  /** Profile-list fetcher for the "Change profile" picker dialog. Defaults
   *  to `api.profiles({})`. */
  loadProfiles?: () => Promise<ProfileRecord[]>;
  /** Single-bean fetcher for the prep card's bean row. Null-on-error like
   *  the profile one. Defaults to `api.beanById`. */
  loadBeanById?: (id: string) => Promise<Bean | null>;
  /** Bean-list fetcher for the "Change bean" picker. Defaults to
   *  `api.beans({})` (active beans only). */
  loadBeans?: () => Promise<Bean[]>;
  /** Pushes the brew workflow (profile + shot context) to the gateway.
   *  Defaults to `api.setWorkflow`. Injected so tests can capture the
   *  payload without hitting the network. */
  onApplyWorkflow?: (body: WorkflowUpdate) => Promise<void> | void;
  /** Latest shot summary fetcher for the post-brew result (defaults to
   *  `api.shotsLatest`). */
  fetchLatestShot?: () => Promise<GatewayShotSummary>;
  /** Full shot record fetcher (measurements) for the result chart +
   *  stats (defaults to `api.shotById`). */
  fetchShot?: (id: string) => Promise<GatewayShotRecord>;
  /** In-memory optimistic shot from the live accumulator — paints the
   *  result instantly while `/shots/latest` catches up. */
  optimisticShot?: Accessor<GatewayShotRecord | null>;
  /** Persists post-shot edits (annotations + drinker context) from the
   *  result screen. Defaults to `api.updateShot`. */
  updateShot?: (id: string, patch: ShotPatch) => Promise<void>;
  /** Auto-save debounce for the annotation capture (ms). Default 700;
   *  tests pass 0 for synchronous saves. */
  saveDebounceMs?: number;
}

/**
 * Per-shot draft of the brew parameters. Seeded from the Recipe when the
 * screen opens, then edited freely in the prep card — these are ephemeral
 * overrides for *this shot only* and never write back to the saved Recipe
 * (they're the "run-time override" layer of the effective-config chain;
 * see [[starter-skin-vocabulary]]). The eventual gateway push reads from
 * here, not from the Recipe.
 */
interface ShotDraft {
  profileId?: string;
  beanId?: string;
  doseGrams?: number;
  grinderSetting?: number;
  targetYieldGrams?: number;
  targetVolumeMl?: number;
  /** Per-shot auto-stop override. `undefined` = use the global default
   *  (`p.autoStopMode`). Set when the user picks a mode in the prep card. */
  stopMode?: AutoStopMode;
}

export interface BrewBundle {
  recipe: Recipe | null;
  routine: Routine | null;
}

export const RecipeBrewScreen: Component<RecipeBrewScreenProps> = (p) => {
  const repos = useRepositories();
  const machine = p.machineStream();

  // Gates the Start button + tints the current step bar item when the
  // DE1's boiler isn't at target yet. Same `isWarmingUp` heuristic the
  // Header pill uses, so the visual story is consistent across screens.
  const isWarming = (): boolean => isWarmingUp(machine.latest() ?? null);
  // Heater-off (front switch off): substate=errorNoAC. Takes priority
  // over warming when both could apply — the user has to physically
  // flip a switch before any warming can happen.
  const heaterOff = (): boolean => isHeaterOff(machine.latest() ?? null);
  // Water-critical (tank below block threshold). Wins over warming on
  // the Start button — refilling is a precondition for further heating
  // to even matter — but heater-off still trumps water-critical.
  const waterCritical = (): boolean => p.isWaterCritical?.() ?? false;

  // Combined fetch so the header + body don't render a half-loaded state
  // (recipe arrived but routine still pending — the previous two-resource
  // setup was racy in jsdom even though it usually settled fast in browsers).
  const [bundle] = createResource<BrewBundle, string>(
    () => p.recipeId,
    async (id): Promise<BrewBundle> => {
      // Ad-hoc Explore brew: use the injected bundle, skip the repo lookup.
      if (p.bundleOverride) return p.bundleOverride;
      const recipe = await repos.recipes.get(id);
      if (!recipe) return { recipe: null, routine: null };
      const routine = await repos.routines.get(recipe.routineId);
      return { recipe, routine };
    },
  );

  const recipe = (): Recipe | null | undefined =>
    bundle.loading ? undefined : (bundle()?.recipe ?? null);
  const routine = (): Routine | null | undefined =>
    bundle.loading ? undefined : (bundle()?.routine ?? null);

  const steps = (): RoutineStep[] => routine()?.steps ?? [];

  // Per-shot draft — seeded once from the Recipe when it first resolves,
  // then edited in the prep card without touching the stored Recipe.
  const [draft, setDraft] = createSignal<ShotDraft | null>(null);
  createEffect(() => {
    const r = bundle()?.recipe;
    if (r && draft() === null) {
      setDraft({
        profileId: r.profileId,
        beanId: r.beanId,
        doseGrams: r.doseGrams,
        grinderSetting: r.grinderSetting,
        targetYieldGrams: r.targetYieldGrams,
        targetVolumeMl: r.targetVolumeMl,
      });
    }
  });
  const patchDraft = (patch: Partial<ShotDraft>) => {
    const d = draft();
    if (!d) return;
    setDraft({ ...d, ...patch });
  };

  // ── Auto-stop mode resolution ──
  // The per-shot choice (draft.stopMode) overrides the global default
  // (p.autoStopMode). The prep card only offers modes that can fire given the
  // live scale state, so a *picked* mode is always applicable; the inapplicable
  // case is the default (or a stale pick after the scale changed) not matching
  // the current scale — we fall back to `auto` and surface a warning.
  const scaleOn = (): boolean => p.scaleConnected?.() ?? false;
  const globalStopMode = (): AutoStopMode => p.autoStopMode?.() ?? 'auto';
  // Per-shot is just on/off: the draft's mode overrides the global default;
  // `off` = manual, anything else = auto-stop on. When on we push `auto` and
  // let the gateway stop at the scale-relevant target (yield with a scale,
  // volume without) — both target *values* are still sent as shot info.
  const autoStopOn = (): boolean =>
    (draft()?.stopMode ?? globalStopMode()) !== 'off';
  const setAutoStopOn = (on: boolean): void =>
    patchDraft({ stopMode: on ? 'auto' : 'off' });
  // Warn when auto-stop is on but the global *forcing* default can't apply to
  // the current scale (By weight + no scale, or By volume + scale) — so the
  // user knows their configured default isn't being honoured this shot.
  const stopModeWarning = (): string | null => {
    const g = globalStopMode();
    if (!autoStopOn() || isStopModeApplicable(g, scaleOn())) return null;
    return `Default '${autoStopLabel(g)}' ${autoStopUnavailableReason(g, scaleOn())} — auto-stopping by ${scaleOn() ? 'weight' : 'volume'}`;
  };

  // Resolve the draft's profile at the screen level — used both to render
  // the prep card and to build the gateway push. Null-on-error contract.
  const profileLoader = (id: string): Promise<ProfileRecord | null> =>
    (p.loadProfileById ?? ((x) => api.profileById(x).catch(() => null)))(id);
  const [profile] = createResource<ProfileRecord | null, string>(
    () => draft()?.profileId,
    (id) => profileLoader(id),
  );

  // Resolve the draft's bean — drives the prep row and the coffee context we
  // stamp onto the shot. Null-on-error; resolves archived beans too.
  const beanLoader = (id: string): Promise<Bean | null> =>
    (p.loadBeanById ?? ((x) => api.beanById(x).catch(() => null)))(id);
  const [bean] = createResource<Bean | null, string>(
    () => draft()?.beanId,
    (id) => beanLoader(id),
  );

  // Push the brew workflow to the gateway whenever the draft (or its
  // resolved profile) changes. Pushing reactively *during prep* — rather
  // than at the instant of Start — gives the BLE profile upload ample time
  // to complete before the user brews, and keeps the machine in sync with
  // the prep card (WYSIWYG). The gateway deep-merges + debounces, and only
  // re-uploads the profile to the machine when it actually changed.
  const applyWorkflow = (body: WorkflowUpdate): void => {
    try {
      const r = (p.onApplyWorkflow ?? ((b) => api.setWorkflow(b)))(body);
      if (r && typeof (r as Promise<void>).catch === 'function') {
        void (r as Promise<void>).catch((e) =>
          console.warn('apply workflow failed', e),
        );
      }
    } catch (e) {
      console.warn('apply workflow failed', e);
    }
  };
  createEffect(() => {
    const d = draft();
    const rec = bundle()?.recipe;
    const prof = profile();
    if (!d || !rec) return;
    // Only push when we have a resolved profile to load. No profileId (or
    // a profile that failed to resolve) → don't half-configure the machine;
    // the brew step, if reached, runs whatever profile is already loaded.
    if (!prof) return;
    // Stop targets follow the *effective* auto-stop mode (resolved against the
    // live scale state). The mode decides which of yield/volume we send — e.g.
    // "By weight" forces volume to 0, "Manual" zeros both. See autoStop.ts.
    const mode: AutoStopMode = autoStopOn() ? 'auto' : 'off';
    const { targetYield, targetVolume } = computeStopTargets(mode, {
      draftYieldG: d.targetYieldGrams,
      draftVolumeMl: d.targetVolumeMl,
      profileVolumeMl: prof.profile.target_volume,
    });
    // The spread carries every runtime field of the received profile (our TS
    // type is a subset), so the full profile round-trips intact.
    const profileObj = { ...prof.profile, target_volume: targetVolume };
    // Coffee trio is written together from one resolved bean (the binding
    // rule): name + roaster for display/durability, extras.beanId as our
    // rename-safe handle. `?? null` clears all three when no bean is set.
    const b = bean() ?? null;
    // Trace what we push: the resolved mode + the targets it produced, plus
    // the raw draft/profile inputs they were derived from.
    dlog(
      'workflow',
      `apply "${rec.name}": mode=${mode} → yield=${targetYield ?? '–'}g ` +
        `sentVol=${targetVolume}ml ` +
        `(draft y=${d.targetYieldGrams ?? '–'} v=${d.targetVolumeMl ?? '–'}, ` +
        `profileVol=${prof.profile.target_volume ?? '–'}) ` +
        `dose=${d.doseGrams ?? '–'}g profile="${prof.profile.title ?? '?'}"`,
    );
    applyWorkflow({
      name: rec.name,
      profile: profileObj,
      context: {
        // `?? null` syncs the gateway to the draft: a cleared field clears
        // it on the machine rather than leaving a stale value.
        targetDoseWeight: d.doseGrams ?? null,
        targetYield: targetYield,
        grinderSetting:
          d.grinderSetting != null ? String(d.grinderSetting) : null,
        coffeeName: b ? b.name : null,
        coffeeRoaster: b ? b.roaster : null,
        extras: b ? { beanId: b.id } : null,
      },
    });
  });

  // Per-step status — defaults all to 'pending' until the recipe + routine
  // load. Re-seeds whenever the step list arrives (so a different recipe
  // mid-screen doesn't carry over old statuses).
  const [statuses, setStatuses] = createSignal<StepStatus[]>([]);
  createEffect(() => {
    const len = steps().length;
    setStatuses((prev) =>
      prev.length === len ? prev : Array.from({ length: len }, () => 'pending'),
    );
  });

  const currentIdx = createMemo<number>(() => {
    const ss = statuses();
    const idx = ss.findIndex((s) => s !== 'done' && s !== 'skipped');
    return idx === -1 ? ss.length : idx; // ss.length === recipe finished
  });

  const isFinished = (): boolean =>
    statuses().length > 0 && currentIdx() === statuses().length;

  // Detect step start + end via the machine snapshot. The per-step status
  // itself acts as memory — waiting-to-enter the target state ⇒ flip to
  // `running`; `running` ⇒ waiting to leave it — so we don't need to track
  // previous states externally.
  //
  // We adopt `pending` as well as `requested` for the entry transition: on a
  // GHC machine the app's Start request only *arms* the machine, and the user
  // begins the operation with the physical button — so a step can enter its
  // target state without ever passing through `requested`. Keying on the
  // *current* step's `target` means an out-of-order operation (e.g. steam
  // while a brew step is current) won't match and won't advance anything.
  createEffect(() => {
    const snap = machine.latest();
    if (!snap) return;
    const cur = snap.state.state;
    const idx = currentIdx();
    const ss = statuses();
    const step = steps()[idx];
    if (!step) return;
    const target = stepToGatewayState(step.type);
    if ((ss[idx] === 'requested' || ss[idx] === 'pending') && cur === target) {
      dlog('step', `${idx} ${step.type}: running (state=${cur})`);
      updateStatus(idx, 'running');
    } else if (ss[idx] === 'running' && cur !== target) {
      dlog('step', `${idx} ${step.type}: done (state=${cur})`);
      updateStatus(idx, 'done');
    }
  });

  const updateStatus = (idx: number, next: StepStatus) => {
    setStatuses((prev) => {
      if (prev[idx] === next) return prev;
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  };

  // ── Steam: pitcher presets + editable parameters ──
  // Pitchers are presets; the three sliders are the values actually applied.
  // Picking a pitcher loads its values into the sliders; editing a slider
  // detaches from the pitcher (custom values). The recipe's pitcher, if any,
  // seeds the initial selection.
  const [pitchers] = createResource<Pitcher[]>(() =>
    (p.loadPitchers ?? (() => repos.pitchers.list()))(),
  );
  const [machineSettings] = createResource<{ steamFlow: number } | null>(() =>
    (p.loadMachineSettings ?? (() => api.machineSettings().catch(() => null)))(),
  );

  // Selected pitcher chip (null = custom / none). Steam parameters are null
  // until seeded. `steamTouched` tracks whether the user has set anything
  // (picked a pitcher or moved a slider) — when false we apply nothing and
  // the machine keeps its current steam settings.
  const [pitcherId, setPitcherId] = createSignal<string | null>(null);
  const [steamDurationSec, setSteamDurationSec] = createSignal<number | null>(null);
  const [steamTempC, setSteamTempC] = createSignal<number | null>(null);
  const [steamFlow, setSteamFlow] = createSignal<number | null>(null);
  const [steamTouched, setSteamTouched] = createSignal(false);
  const steamReady = (): boolean => steamDurationSec() !== null;

  const loadFromPitcher = (pt: Pitcher) => {
    setSteamDurationSec(pt.steamDurationSec);
    setSteamTempC(pt.steamTempC);
    setSteamFlow(pt.steamFlow);
    setPitcherId(pt.id);
    setSteamTouched(false);
  };

  const selectPitcher = (id: string) => {
    const pt = (pitchers() ?? []).find((x) => x.id === id);
    if (pt) loadFromPitcher(pt);
  };

  // Editing any slider detaches from the pitcher and marks the params custom.
  const editSteam = (set: (v: number) => void, v: number) => {
    set(v);
    setPitcherId(null);
    setSteamTouched(true);
  };

  // Seed once the recipe + data are available. Prefer the recipe's pitcher;
  // otherwise start the sliders from the machine's current steam settings so
  // leaving them untouched is a no-op (machine default). Gated so a slow load
  // doesn't seed from stale/empty values.
  createEffect(() => {
    if (steamReady()) return;
    const list = pitchers();
    if (!list || bundle.loading || machineSettings.loading) return;
    const rec = bundle()?.recipe;
    const pt = rec?.pitcherId
      ? list.find((x) => x.id === rec.pitcherId)
      : undefined;
    if (pt) {
      loadFromPitcher(pt);
      return;
    }
    // No recipe pitcher: seed sliders from the machine's current settings.
    // Needs a shotSettings frame for temp/duration; wait for it.
    const ss = p.shotSettingsStream?.().latest();
    if (!ss) return;
    setSteamDurationSec(ss.targetSteamDuration);
    setSteamTempC(ss.targetSteamTemp);
    setSteamFlow(machineSettings()?.steamFlow ?? 0.8);
    setPitcherId(null);
    setSteamTouched(false);
  });

  // Apply the steam parameters before steaming. Temp + duration ride
  // shotSettings (full-body overlay — no PATCH); flow rides machineSettings
  // (sparse). When nothing was picked or changed, skip entirely so the
  // machine keeps its current settings.
  const applySteam = async (): Promise<void> => {
    if (pitcherId() === null && !steamTouched()) return;
    const dur = steamDurationSec();
    const temp = steamTempC();
    const flow = steamFlow();
    if (dur == null || temp == null || flow == null) return;
    // Read the base snapshot non-reactively: the reactive prep-push effect
    // (below) calls applySteam, and we don't want it re-firing on every
    // shotSettings frame — only on prep-param edits.
    const cur = untrack(() => p.shotSettingsStream?.().latest());
    dlog(
      'steam.apply',
      `pitcher=${pitcherId() ?? 'custom'} dur=${dur}s temp=${temp}°C flow=${flow} (shotSettings ${cur ? 'present' : 'MISSING'})`,
    );
    if (cur) {
      const update =
        p.updateShotSettings ??
        ((s: ShotSettingsSnapshot) => api.updateShotSettings(s));
      await update({
        ...cur,
        targetSteamTemp: temp,
        targetSteamDuration: dur,
      });
    }
    const updateMachine =
      p.updateMachineSettings ??
      ((partial: { steamFlow: number }) => api.updateMachineSettings(partial));
    await updateMachine({ steamFlow: flow });
  };

  // Push the steam params to the gateway reactively *during prep* — mirroring
  // the brew-workflow effect above — so they're in place no matter how steam
  // starts. Without this, the params only reached the firmware via the app's
  // Start button (`startCurrentStep`); a physical GHC steam-button start
  // bypassed it and ran the machine's stale `targetSteamDuration`. Deps are
  // the prep params (the shotSettings base is read untracked inside
  // applySteam, so this doesn't loop on the gateway echo); the guard inside
  // applySteam keeps it a no-op until the user picks a pitcher or edits a
  // value. SteamPrep commits on release, so this fires at edit cadence.
  createEffect(() => {
    // Touch the params so the effect tracks them.
    void steamDurationSec();
    void steamTempC();
    void steamFlow();
    void steamTouched();
    void pitcherId();
    void applySteam().catch((e) => console.warn('prep steam push failed', e));
  });

  const startCurrentStep = async () => {
    const idx = currentIdx();
    const step = steps()[idx];
    if (!step) return;
    updateStatus(idx, 'requested');
    try {
      // Steam: push the params first so they're in place before the machine
      // enters steam. Other steps have nothing to pre-apply.
      if (step.type === 'steam') await applySteam();
      await p.requestState(stepToGatewayState(step.type));
    } catch (e) {
      console.warn('start step failed', e);
      updateStatus(idx, 'pending');
    }
  };

  /** Click a future step in the step bar to skip ahead to it. */
  const jumpToStep = (targetIdx: number) => {
    setStatuses((prev) => {
      const copy = [...prev];
      for (let i = currentIdx(); i < targetIdx; i++) {
        if (copy[i] === 'pending') copy[i] = 'skipped';
      }
      return copy;
    });
  };

  const resetForBrewAgain = () => {
    setStatuses(Array.from({ length: steps().length }, () => 'pending'));
  };

  return (
    <main class="brew-screen" data-testid="recipe-brew-screen">
      <BrewHeader
        recipe={recipe}
        routine={routine}
        profileTitle={() => profile()?.profile?.title}
        onExit={p.onExit}
      />

      <Switch>
        <Match when={bundle.loading}>
          <p class="muted brew-screen__loading">loading recipe…</p>
        </Match>
        <Match when={recipe() === null}>
          <p class="muted brew-screen__loading" role="alert">
            recipe not found
          </p>
        </Match>
        <Match when={routine() === null}>
          <p class="muted brew-screen__loading" role="alert">
            parent routine not found
          </p>
        </Match>
        <Match when={steps().length === 0}>
          <p class="muted brew-screen__loading">
            this routine has no steps yet
          </p>
        </Match>
        <Match when={recipe() && routine() && steps().length > 0}>
          {/* Step bar is a progress indicator for an in-progress recipe —
              hidden on the result screen to give the chart the full height. */}
          <Show when={!isFinished()}>
            <StepBar
              steps={steps}
              statuses={statuses}
              currentIdx={currentIdx}
              isWarming={isWarming}
              isHeaterOff={heaterOff}
              isWaterCritical={waterCritical}
              onJump={jumpToStep}
            />
          </Show>

          <section class="brew-screen__body">
            <Show
              when={!isFinished()}
              fallback={
                <PostBrewView
                  onDone={p.onExit}
                  onBrewAgain={resetForBrewAgain}
                  fetchLatestShot={p.fetchLatestShot}
                  fetchShot={p.fetchShot}
                  optimisticShot={p.optimisticShot}
                  updateShot={p.updateShot}
                  saveDebounceMs={p.saveDebounceMs}
                  traceVisibility={p.traceVisibility}
                  fetchDrinkers={p.fetchDrinkers}
                />
              }
            >
              <PrepCard
                step={() => steps()[currentIdx()]!}
                draft={draft}
                patchDraft={patchDraft}
                status={() => statuses()[currentIdx()]!}
                isWarming={isWarming}
                isHeaterOff={heaterOff}
                isWaterCritical={waterCritical}
                onStart={startCurrentStep}
                autoStopOn={autoStopOn}
                onAutoStop={setAutoStopOn}
                scaleConnected={scaleOn}
                stopModeWarning={stopModeWarning}
                profile={() => profile() ?? null}
                profileLoading={() => profile.loading}
                loadProfiles={p.loadProfiles}
                bean={() => bean() ?? null}
                beanLoading={() => bean.loading}
                loadBeans={p.loadBeans}
                pitchers={() => pitchers() ?? []}
                pitchersLoading={() => pitchers.loading}
                selectedPitcherId={pitcherId}
                onSelectPitcher={selectPitcher}
                steamReady={steamReady}
                steamDuration={steamDurationSec}
                steamFlow={steamFlow}
                showFlowSlider={() => p.showFlowSlider?.() ?? false}
                onChangeSteamDuration={(v) => editSteam(setSteamDurationSec, v)}
                onChangeSteamFlow={(v) => editSteam(setSteamFlow, v)}
              />
            </Show>
          </section>
        </Match>
      </Switch>
    </main>
  );
};

// ─── Subcomponents ──────────────────────────────────────────────────────

const BrewHeader: Component<{
  recipe: Accessor<Recipe | null | undefined>;
  routine: Accessor<Routine | null | undefined>;
  /** Shown when the recipe has no name (ad-hoc Explore brew). */
  profileTitle?: Accessor<string | undefined>;
  onExit: () => void;
}> = (p) => (
  <header class="brew-screen__header">
    <button
      type="button"
      class="icon-btn brew-screen__back"
      aria-label="Back to Home"
      data-testid="brew-back-button"
      onClick={p.onExit}
    >
      ←
    </button>
    <h1 class="brew-screen__title">
      <span
        class="brew-screen__recipe-name"
        data-testid="brew-recipe-name"
      >
        {p.recipe()?.name || p.profileTitle?.() || '…'}
      </span>
      <span
        class="brew-screen__routine-name"
        data-testid="brew-routine-name"
      >
        {p.routine()?.name ?? '…'}
      </span>
    </h1>
  </header>
);

const StepBar: Component<{
  steps: Accessor<RoutineStep[]>;
  statuses: Accessor<StepStatus[]>;
  currentIdx: Accessor<number>;
  isWarming: Accessor<boolean>;
  isHeaterOff: Accessor<boolean>;
  isWaterCritical: Accessor<boolean>;
  onJump: (idx: number) => void;
}> = (p) => (
  <ol class="step-bar" data-testid="step-bar">
    <For each={p.steps()}>
      {(s, i) => {
        const status = () => p.statuses()[i()] ?? 'pending';
        const isCurrent = () => i() === p.currentIdx();
        const variant = (): 'done' | 'current' | 'future' | 'skipped' => {
          const st = status();
          if (st === 'done') return 'done';
          if (st === 'skipped') return 'skipped';
          if (isCurrent()) return 'current';
          return 'future';
        };
        const clickable = () => i() > p.currentIdx();
        // Tint only the current step while the machine isn't ready —
        // future steps stay neutral; the user can still see what's
        // coming. Priority: heater-off > water-critical > warming.
        const heaterOff = () => isCurrent() && p.isHeaterOff();
        const waterCritical = () =>
          isCurrent() && p.isWaterCritical() && !heaterOff();
        const warming = () =>
          isCurrent() && p.isWarming() && !heaterOff() && !waterCritical();
        return (
          <li
            class="step-bar__item"
            data-variant={variant()}
            data-warming={warming() ? 'true' : undefined}
            data-heater-off={heaterOff() ? 'true' : undefined}
            data-water-critical={waterCritical() ? 'true' : undefined}
            data-testid={`step-bar-item-${i()}`}
          >
            <button
              type="button"
              class="step-bar__button"
              data-testid={`step-bar-button-${i()}`}
              disabled={!clickable()}
              aria-current={isCurrent() ? 'step' : undefined}
              onClick={() => clickable() && p.onJump(i())}
            >
              <span class="step-bar__icon" aria-hidden="true">
                <Switch
                  fallback={
                    variant() === 'done'
                      ? '✓'
                      : variant() === 'skipped'
                        ? '–'
                        : i() + 1
                  }
                >
                  <Match when={heaterOff()}>
                    <PowerIcon size={14} />
                  </Match>
                  <Match when={waterCritical()}>
                    <WaterDropIcon size={14} />
                  </Match>
                  <Match when={warming()}>
                    <ThermometerIcon size={14} />
                  </Match>
                </Switch>
              </span>
              <span class="step-bar__label">{formatStepType(s.type)}</span>
            </button>
          </li>
        );
      }}
    </For>
  </ol>
);

const PrepCard: Component<{
  step: Accessor<RoutineStep>;
  draft: Accessor<ShotDraft | null>;
  patchDraft: (patch: Partial<ShotDraft>) => void;
  status: Accessor<StepStatus>;
  isWarming: Accessor<boolean>;
  isHeaterOff: Accessor<boolean>;
  isWaterCritical: Accessor<boolean>;
  onStart: () => void;
  /** Whether auto-stop is on for this shot (the checkbox state). */
  autoStopOn: Accessor<boolean>;
  /** Toggle auto-stop on/off for this shot. */
  onAutoStop: (on: boolean) => void;
  /** Live scale-connection state — decides which target the checkbox sits on. */
  scaleConnected: Accessor<boolean>;
  /** Warning when the global default can't apply to the current scale. */
  stopModeWarning: Accessor<string | null>;
  profile: Accessor<ProfileRecord | null>;
  profileLoading: Accessor<boolean>;
  loadProfiles?: () => Promise<ProfileRecord[]>;
  bean: Accessor<Bean | null>;
  beanLoading: Accessor<boolean>;
  loadBeans?: () => Promise<Bean[]>;
  pitchers: Accessor<Pitcher[]>;
  pitchersLoading: Accessor<boolean>;
  selectedPitcherId: Accessor<string | null>;
  onSelectPitcher: (id: string) => void;
  steamReady: Accessor<boolean>;
  steamDuration: Accessor<number | null>;
  steamFlow: Accessor<number | null>;
  showFlowSlider: Accessor<boolean>;
  onChangeSteamDuration: (v: number) => void;
  onChangeSteamFlow: (v: number) => void;
}> = (p) => (
  <section class="prep" data-testid="prep-card">
    <header class="prep__heading">
      <span class="prep__eyebrow">Prep for</span>
      <h2 class="prep__title">{formatStepType(p.step().type)}</h2>
    </header>

    <div class="prep__body">
      <Switch>
        <Match when={p.step().type === 'brew'}>
          <BrewPrep
            draft={p.draft}
            patchDraft={p.patchDraft}
            autoStopOn={p.autoStopOn}
            onAutoStop={p.onAutoStop}
            scaleConnected={p.scaleConnected}
            stopModeWarning={p.stopModeWarning}
            profile={p.profile}
            profileLoading={p.profileLoading}
            loadProfiles={p.loadProfiles}
            bean={p.bean}
            beanLoading={p.beanLoading}
            loadBeans={p.loadBeans}
          />
        </Match>
        <Match when={p.step().type === 'steam'}>
          <SteamPrep
            pitchers={p.pitchers}
            loading={p.pitchersLoading}
            selectedId={p.selectedPitcherId}
            onSelect={p.onSelectPitcher}
            ready={p.steamReady}
            duration={p.steamDuration}
            flow={p.steamFlow}
            showFlow={p.showFlowSlider}
            onChangeDuration={p.onChangeSteamDuration}
            onChangeFlow={p.onChangeSteamFlow}
          />
        </Match>
        <Match when={p.step().type === 'water' || p.step().type === 'flush'}>
          <p class="prep__no-params">No prep needed.</p>
        </Match>
      </Switch>
    </div>

    <footer class="prep__action">
      <Show
        when={p.status() === 'pending'}
        fallback={
          <p
            class="prep__running"
            data-testid="prep-card-running"
            aria-live="polite"
          >
            {formatStepType(p.step().type)} in progress…
          </p>
        }
      >
        <button
          type="button"
          class="btn btn--primary prep__start"
          data-testid="prep-card-start"
          data-heater-off={p.isHeaterOff() ? 'true' : undefined}
          data-water-critical={
            p.isWaterCritical() && !p.isHeaterOff() ? 'true' : undefined
          }
          data-warming={
            p.isWarming() && !p.isHeaterOff() && !p.isWaterCritical()
              ? 'true'
              : undefined
          }
          disabled={p.isWarming() || p.isHeaterOff() || p.isWaterCritical()}
          aria-disabled={
            p.isWarming() || p.isHeaterOff() || p.isWaterCritical()
          }
          onClick={p.onStart}
        >
          <Switch
            fallback={<>Start {formatStepType(p.step().type).toLowerCase()}</>}
          >
            <Match when={p.isHeaterOff()}>
              <PowerIcon size={18} />
              Heater off
            </Match>
            <Match when={p.isWaterCritical()}>
              <WaterDropIcon size={18} />
              Refill water
            </Match>
            <Match when={p.isWarming()}>
              <ThermometerIcon size={18} />
              Warming up…
            </Match>
          </Switch>
        </button>
      </Show>
    </footer>
  </section>
);

const BrewPrep: Component<{
  draft: Accessor<ShotDraft | null>;
  patchDraft: (patch: Partial<ShotDraft>) => void;
  autoStopOn: Accessor<boolean>;
  onAutoStop: (on: boolean) => void;
  scaleConnected: Accessor<boolean>;
  stopModeWarning: Accessor<string | null>;
  /** Resolved profile for the draft's profileId (fetched by the screen so
   *  it can also build the gateway push). Null = unresolved / missing. */
  profile: Accessor<ProfileRecord | null>;
  profileLoading: Accessor<boolean>;
  loadProfiles?: () => Promise<ProfileRecord[]>;
  bean: Accessor<Bean | null>;
  beanLoading: Accessor<boolean>;
  loadBeans?: () => Promise<Bean[]>;
}> = (p) => {
  const profile = (): ProfileRecord | null => p.profile();
  const curve = createMemo(() => buildProfileCurve(profile()?.profile.steps));
  const hasProfileId = (): boolean => !!p.draft()?.profileId;
  const profileTitle = (): string =>
    (profile()?.profile.title ?? '').trim() || '(untitled)';
  const profileAuthor = (): string =>
    (profile()?.profile.author ?? '').trim();
  const tankTemp = () => profile()?.profile.tank_temperature;

  const [profileDialogOpen, setProfileDialogOpen] = createSignal(false);
  const handleProfileSelect = (id: string) => {
    setProfileDialogOpen(false);
    p.patchDraft({ profileId: id });
  };

  const hasBeanId = (): boolean => !!p.draft()?.beanId;
  const [beanDialogOpen, setBeanDialogOpen] = createSignal(false);
  const handleBeanSelect = (id: string) => {
    setBeanDialogOpen(false);
    p.patchDraft({ beanId: id });
  };

  return (
    // Two-column on a wide tablet (profile | parameters), stacking to one
    // column when narrow. Start lives in the PrepCard footer below. The
    // picker dialogs render via Portal, so they aren't grid items.
    <div class="brew-prep">
      {/* Left column: the brew definition — profile + stop targets (the
          targets shape the brew, so they live with the profile rather than
          among the dose/grind prep values on the right). */}
      <div class="brew-prep__col">
        {/*
          Profile is the headline of the brew step — it determines the whole
          shot. Title + author header, small target-curve thumbnail, plus a
          Change button to swap the profile *for this shot only*. Below: the
          editable dose / grinder / yield / volume overrides.
        */}
        <section class="prep__profile" data-testid="prep-card-profile">
          <div class="prep__profile-toprow">
            <span class="prep__profile-label">Profile</span>
            <button
              type="button"
              class="btn prep__profile-change"
              data-testid="prep-card-profile-change"
              onClick={() => setProfileDialogOpen(true)}
            >
              {hasProfileId() ? 'Change' : 'Choose'}
            </button>
          </div>
          <Show
            when={hasProfileId()}
            fallback={
              <span
                class="prep__profile-value prep__profile-value--muted"
                data-testid="prep-card-profile-empty"
              >
                No profile selected — tap Choose to pick one for this shot.
              </span>
            }
          >
            <Show
              when={profile()}
              fallback={
                <span
                  class="prep__profile-value prep__profile-value--muted"
                  data-testid="prep-card-profile-missing"
                >
                  {p.profileLoading()
                    ? 'Loading…'
                    : `(missing profile — ${p.draft()?.profileId})`}
                </span>
              }
            >
              <div class="prep__profile-header">
                <span
                  class="prep__profile-value"
                  data-testid="prep-card-profile-title"
                >
                  {profileTitle()}
                </span>
                <Show when={profile()!.isDefault}>
                  <span
                    class="profile-row__badge profile-row__badge--default"
                    data-testid="prep-card-profile-default-badge"
                  >
                    default
                  </span>
                </Show>
              </div>
              <div
                class="prep__profile-meta"
                data-testid="prep-card-profile-meta"
              >
                <Show when={profileAuthor()}>
                  <span class="prep__profile-author">by {profileAuthor()}</span>
                </Show>
                <Show
                  when={
                    typeof tankTemp() === 'number' && (tankTemp() as number) > 0
                  }
                >
                  <span class="profile-row__chip">
                    Tank {(tankTemp() as number).toFixed(1)} °C
                  </span>
                </Show>
              </div>
              <Show when={!curve().empty}>
                <div
                  class="prep__profile-chart"
                  data-testid="prep-card-profile-chart-wrap"
                >
                  <ProfileCurveChart
                    curve={curve()}
                    width={320}
                    height={96}
                    compact={true}
                    testId="prep-card-profile-chart"
                  />
                </div>
              </Show>
            </Show>
          </Show>
        </section>

        <PickerDialog
          open={profileDialogOpen()}
          onClose={() => setProfileDialogOpen(false)}
          title="Choose a profile"
          description="Overrides the profile for this shot only."
          testId="prep-card-profile-dialog"
          maxWidthPx={1100}
        >
          <ProfilePicker
            selectedId={p.draft()?.profileId}
            onSelect={handleProfileSelect}
            onCancel={() => setProfileDialogOpen(false)}
            loadProfiles={p.loadProfiles}
          />
        </PickerDialog>

        <PickerDialog
          open={beanDialogOpen()}
          onClose={() => setBeanDialogOpen(false)}
          title="Choose a bean"
          description="Sets the coffee recorded for this shot."
          testId="prep-card-bean-dialog"
        >
          <BeanPicker
            selectedId={p.draft()?.beanId}
            onSelect={handleBeanSelect}
            onCancel={() => setBeanDialogOpen(false)}
            loadBeans={p.loadBeans}
          />
        </PickerDialog>

        {/* Stop targets — below the profile because they shape the brew. Both
            are shown and always editable: each is an auto-stop target AND a
            manual-stop reference (e.g. set 36 g with no scale and stop by hand
            at it). The Auto-stop checkbox sits on whichever target the machine
            can actually enforce — yield with a scale, volume without; the other
            is a plain reference. */}
        <div class="prep__targets" data-testid="prep-card-targets">
          <label class="prep__stat" data-testid="prep-card-target-yield">
            <span class="prep__stat-label">Target yield</span>
            <span class="prep__stat-edit">
              <DebouncedNumberField
                value={p.draft()?.targetYieldGrams}
                onCommit={(v) => p.patchDraft({ targetYieldGrams: v })}
                placeholder="—"
                min={0}
                step={0.1}
                steppers
                unit="g"
                ariaLabel="Target yield (grams)"
                testId="prep-card-target-yield-input"
                class="prep__stat-input"
              />
              <span class="prep__stat-unit">g</span>
              <Show when={p.scaleConnected()}>
                <label class="prep__autostop-check">
                  <input
                    type="checkbox"
                    checked={p.autoStopOn()}
                    onChange={(e) => p.onAutoStop(e.currentTarget.checked)}
                    data-testid="autostop-check"
                  />
                  <span>Auto-stop</span>
                </label>
              </Show>
            </span>
          </label>
          <label class="prep__stat" data-testid="prep-card-target-volume">
            <span class="prep__stat-label">Target volume</span>
            <span class="prep__stat-edit">
              <DebouncedNumberField
                value={p.draft()?.targetVolumeMl}
                onCommit={(v) => p.patchDraft({ targetVolumeMl: v })}
                placeholder="—"
                min={0}
                step={1}
                steppers
                unit="mL"
                ariaLabel="Target volume (millilitres)"
                testId="prep-card-target-volume-input"
                class="prep__stat-input"
              />
              <span class="prep__stat-unit">mL</span>
              <Show when={!p.scaleConnected()}>
                <label class="prep__autostop-check">
                  <input
                    type="checkbox"
                    checked={p.autoStopOn()}
                    onChange={(e) => p.onAutoStop(e.currentTarget.checked)}
                    data-testid="autostop-check"
                  />
                  <span>Auto-stop</span>
                </label>
              </Show>
            </span>
          </label>
        </div>
        <Show when={p.stopModeWarning()}>
          <p
            class="prep__autostop-warning"
            role="status"
            data-testid="autostop-warning"
          >
            {p.stopModeWarning()}
          </p>
        </Show>
      </div>

      <div class="prep__stats">
        {/* Bean reads as a stat card like dose/grind, but its value is a
            button that opens the picker. Spans the full grid width. */}
        <div class="prep__stat prep__bean" data-testid="prep-card-bean">
          <span class="prep__stat-label">Bean</span>
          <button
            type="button"
            class="prep__bean-button"
            data-testid="prep-card-bean-change"
            onClick={() => setBeanDialogOpen(true)}
          >
            <Show
              when={hasBeanId()}
              fallback={
                <span class="prep__bean-empty" data-testid="prep-card-bean-empty">
                  Choose a bean
                </span>
              }
            >
              <Show
                when={p.bean()}
                fallback={
                  <span
                    class="prep__bean-empty"
                    data-testid="prep-card-bean-missing"
                  >
                    {p.beanLoading()
                      ? 'Loading…'
                      : `(missing bean — ${p.draft()?.beanId})`}
                  </span>
                }
              >
                <span class="prep__bean-name" data-testid="prep-card-bean-name">
                  {p.bean()!.roaster} — {p.bean()!.name}
                  <Show when={p.bean()!.decaf}>
                    <span class="bean-tree__badge">decaf</span>
                  </Show>
                  <Show when={p.bean()!.archived}>
                    <span class="bean-tree__badge bean-tree__badge--muted">
                      archived
                    </span>
                  </Show>
                </span>
              </Show>
            </Show>
            <span class="prep__bean-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        </div>
        <label class="prep__stat" data-testid="prep-card-dose">
          <span class="prep__stat-label">Dose</span>
          <span class="prep__stat-edit">
            <DebouncedNumberField
              value={p.draft()?.doseGrams}
              onCommit={(v) => p.patchDraft({ doseGrams: v })}
              placeholder="—"
              min={0}
              step={0.1}
              steppers
              unit="g"
              ariaLabel="Dose (grams)"
              testId="prep-card-dose-input"
              class="prep__stat-input"
            />
            <span class="prep__stat-unit">g</span>
          </span>
        </label>
        <label class="prep__stat" data-testid="prep-card-grinder">
          <span class="prep__stat-label">Grinder setting</span>
          <span class="prep__stat-edit">
            <DebouncedNumberField
              value={p.draft()?.grinderSetting}
              onCommit={(v) => p.patchDraft({ grinderSetting: v })}
              placeholder="—"
              step={0.1}
              steppers
              ariaLabel="Grinder setting"
              testId="prep-card-grinder-input"
              class="prep__stat-input"
            />
          </span>
        </label>
      </div>
    </div>
  );
};

/**
 * Steam-step prep: pick a pitcher (a preset), then fine-tune on the compact
 * sliders. Pitcher chips show name + capacity only; tapping one loads its
 * parameters. Moving a slider detaches from the pitcher (values become
 * custom). Duration is always editable; the flow slider appears only when the
 * "show steam-flow slider" pref is on (flow is still applied from the pitcher
 * either way). Temperature comes from the pitcher and isn't edited here.
 */
const SteamPrep: Component<{
  pitchers: Accessor<Pitcher[]>;
  loading: Accessor<boolean>;
  selectedId: Accessor<string | null>;
  onSelect: (id: string) => void;
  ready: Accessor<boolean>;
  duration: Accessor<number | null>;
  flow: Accessor<number | null>;
  showFlow: Accessor<boolean>;
  onChangeDuration: (v: number) => void;
  onChangeFlow: (v: number) => void;
}> = (p) => (
  <div class="steam-prep" data-testid="steam-prep">
    <span class="prep__field-label">Pitcher</span>
    <Show
      when={!p.loading()}
      fallback={<p class="prep__no-params">loading pitchers…</p>}
    >
      <Show
        when={p.pitchers().length > 0}
        fallback={
          <p class="prep__no-params" data-testid="steam-prep-empty">
            No pitchers yet — add one in Library → Steam.
          </p>
        }
      >
        <div class="pitcher-chips" role="group" aria-label="Pitcher">
          <For each={p.pitchers()}>
            {(pt) => (
              <button
                type="button"
                class="pitcher-chip"
                data-testid={`pitcher-${pt.id}`}
                data-selected={p.selectedId() === pt.id ? 'true' : undefined}
                aria-pressed={p.selectedId() === pt.id}
                onClick={() => p.onSelect(pt.id)}
              >
                <span class="pitcher-chip__name">{pt.name}</span>
                <span class="pitcher-chip__cap">{pt.capacityMl} mL</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </Show>

    {/* Compact parameter sliders — seeded from the pitcher (or the machine's
        current settings). Editing detaches from the pitcher. */}
    <Show when={p.ready()}>
      <div class="steam-params" data-testid="steam-params">
        <SteamParamSlider
          label="Duration"
          testId="steam-param-duration"
          value={p.duration}
          onChange={p.onChangeDuration}
          min={5}
          max={120}
          step={1}
          format={(v) => `${v.toFixed(0)} s`}
        />
        <Show when={p.showFlow()}>
          <SteamParamSlider
            label="Flow"
            testId="steam-param-flow"
            value={p.flow}
            onChange={p.onChangeFlow}
            min={0.4}
            max={2}
            step={0.1}
            format={(v) => `${v.toFixed(1)} mL/s`}
          />
        </Show>
      </div>
    </Show>
  </div>
);

/** One compact labelled steam-parameter slider row. */
const SteamParamSlider: Component<{
  label: string;
  testId: string;
  value: Accessor<number | null>;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}> = (p) => (
  <div class="steam-param">
    <span class="steam-param__label">{p.label}</span>
    <DebouncedSliderField
      class="steam-param__field"
      testId={p.testId}
      value={p.value() ?? undefined}
      onCommit={p.onChange}
      min={p.min}
      max={p.max}
      step={p.step}
      debounceMs={0}
      ariaLabel={p.label}
      formatValue={p.format}
    />
  </div>
);

/**
 * Post-brew result — the shared {@link ShotReview} in its always-editable
 * "live" mode, wired to the optimistic→gateway hand-off and debounced
 * auto-save. The step bar is hidden at this stage (handled by the parent)
 * to give the chart room.
 */
const PostBrewView: Component<{
  onDone: () => void;
  onBrewAgain: () => void;
  fetchLatestShot?: () => Promise<GatewayShotSummary>;
  fetchShot?: (id: string) => Promise<GatewayShotRecord>;
  optimisticShot?: Accessor<GatewayShotRecord | null>;
  updateShot?: (id: string, patch: ShotPatch) => Promise<void>;
  saveDebounceMs?: number;
  traceVisibility?: Accessor<TraceVisibility>;
  fetchDrinkers?: () => Promise<string[]>;
}> = (p) => {
  const [drinkers] = createResource<string[]>(() =>
    (p.fetchDrinkers ?? api.recentDrinkers)(),
  );
  // Fetch the persisted espresso shot. Both fetchers resolve to null on
  // failure so a gateway hiccup degrades to the optimistic record (or an
  // empty state) rather than throwing.
  const [summary, { refetch: refetchSummary }] =
    createResource<GatewayShotSummary | null>(() =>
      (p.fetchLatestShot ?? api.shotsLatest)().catch(() => null),
    );
  const [full] = createResource<GatewayShotRecord | null, string>(
    () => summary()?.id,
    (id) => (p.fetchShot ?? api.shotById)(id).catch(() => null),
  );

  // Prefer the optimistic in-memory record until the gateway summary
  // catches up (timestamp ≥ optimistic). Same hand-off as LastShotCard.
  const usingOptimistic = (): boolean => {
    const opt = p.optimisticShot?.();
    if (!opt) return false;
    const s = summary();
    if (!s) return true;
    return Date.parse(s.timestamp) < Date.parse(opt.timestamp);
  };

  // The gateway persists the shot asynchronously on shot-end, so the
  // mount-time /shots/latest can return the *previous* record. While the
  // optimistic stand-in is still on screen, poll until the gateway catches
  // up — this lands the real shot id (the annotation save target) and the
  // real record for the chart. Bounded so a permanently-stale gateway can't
  // spin forever.
  const SUMMARY_POLL_MS = 600;
  let summaryPolls = 0;
  createEffect(() => {
    if (!usingOptimistic() || summaryPolls >= 8) return;
    const t = setTimeout(() => {
      summaryPolls++;
      void refetchSummary();
    }, SUMMARY_POLL_MS);
    onCleanup(() => clearTimeout(t));
  });
  const displayedSummary = (): GatewayShotSummary | null =>
    usingOptimistic() ? p.optimisticShot!() : (summary() ?? null);
  const displayedFull = (): GatewayShotRecord | null =>
    usingOptimistic() ? p.optimisticShot!() : (full() ?? null);

  const stats = createMemo(() =>
    deriveShotStats(displayedSummary(), displayedFull()),
  );

  // ── Post-shot annotation capture (rating · notes · corrected dose) ──
  const [enjoyment, setEnjoyment] = createSignal<number | null>(null);
  const [notes, setNotes] = createSignal('');
  const [actualDose, setActualDose] = createSignal<number | undefined>();
  const [actualYield, setActualYield] = createSignal<number | undefined>();
  const [drinker, setDrinker] = createSignal('');
  const [saveState, setSaveState] = createSignal<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  // Seed the editable fields once, from whichever record paints first. A
  // just-finished shot carries no annotations, so this mostly just defaults
  // the dose to the derived actual-or-target value.
  let seeded = false;
  createEffect(() => {
    const s = displayedSummary();
    if (!s || seeded) return;
    seeded = true;
    const a = s.annotations;
    setEnjoyment(typeof a?.enjoyment === 'number' ? a.enjoyment : null);
    setNotes(a?.espressoNotes ?? '');
    setActualDose(untrack(() => stats().doseG ?? undefined));
    setActualYield(typeof a?.actualYield === 'number' ? a.actualYield : undefined);
    setDrinker(s.workflow?.context?.drinkerName ?? '');
  });

  // Persist target: the *real* gateway id, and only once the gateway record
  // is the one on screen. While the optimistic record shows, summary() may
  // still point at the PREVIOUS shot — saving then would annotate the wrong
  // record, so edits are held until the hand-off lands.
  const saveTargetId = (): string | null =>
    usingOptimistic() ? null : summary()?.id ?? null;

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  // The dose field is *seeded* from the derived dose (actual ?? target), so
  // only persist it once the user has actually edited it — otherwise a
  // rating-only save would write the target back as the measured actual.
  let doseTouched = false;
  let yieldTouched = false;

  const doSave = async (): Promise<void> => {
    if (!pending) return;
    const id = saveTargetId();
    if (!id) return; // no target yet; stays pending, flushed on hand-off
    pending = false;
    const patch = untrack<ShotPatch>(() => {
      const ann: ShotAnnotationsPatch = { espressoNotes: notes().trim() };
      const e = enjoyment();
      if (e != null) ann.enjoyment = e;
      const d = actualDose();
      if (doseTouched && d != null) ann.actualDoseWeight = d;
      const y = actualYield();
      if (yieldTouched && y != null) ann.actualYield = y;
      const out: ShotPatch = { annotations: ann };
      // Drinker → workflow.context. Only when set (never clear).
      const dn = drinker().trim();
      if (dn) out.workflow = { context: { drinkerName: dn } };
      return out;
    });
    setSaveState('saving');
    try {
      await (p.updateShot ?? api.updateShot)(id, patch);
      setSaveState('saved');
    } catch {
      pending = true; // let a later edit retry
      setSaveState('error');
    }
  };

  const scheduleSave = (): void => {
    pending = true;
    setSaveState('saving');
    clearTimeout(saveTimer);
    const delay = p.saveDebounceMs ?? 700;
    if (delay <= 0) {
      void doSave();
      return;
    }
    saveTimer = setTimeout(() => void doSave(), delay);
  };

  // Flush held edits the instant a real persist target appears (the
  // optimistic→gateway hand-off).
  createEffect(() => {
    if (saveTargetId() && pending) void doSave();
  });
  onCleanup(() => clearTimeout(saveTimer));

  return (
    <ShotReview
      summary={displayedSummary}
      full={displayedFull}
      loading={() => summary.loading}
      editable={() => true}
      defaultVisibility={p.traceVisibility}
      enjoyment={enjoyment}
      onEnjoyment={(v) => {
        setEnjoyment(v);
        scheduleSave();
      }}
      notes={notes}
      onNotes={(v) => {
        setNotes(v);
        scheduleSave();
      }}
      actualDose={actualDose}
      onActualDose={(v) => {
        setActualDose(v);
        doseTouched = true;
        scheduleSave();
      }}
      actualYield={actualYield}
      onActualYield={(v) => {
        setActualYield(v);
        yieldTouched = true;
        scheduleSave();
      }}
      drinker={drinker}
      onDrinker={(v) => {
        setDrinker(v);
        scheduleSave();
      }}
      drinkerSuggestions={() => drinkers() ?? []}
      doseDebounceMs={p.saveDebounceMs}
      headerActions={
        <span
          class="post-brew__save"
          data-testid="post-brew-save-state"
          data-state={saveState()}
          aria-live="polite"
        >
          <Switch>
            <Match when={saveState() === 'saving'}>Saving…</Match>
            <Match when={saveState() === 'saved'}>Saved ✓</Match>
            <Match when={saveState() === 'error'}>Couldn’t save</Match>
          </Switch>
        </span>
      }
      footer={
        <footer class="prep__action prep__action--row post-brew__actions">
          <button
            type="button"
            class="btn prep__secondary"
            data-testid="post-brew-brew-again"
            onClick={p.onBrewAgain}
          >
            Brew again
          </button>
          <button
            type="button"
            class="btn btn--primary prep__start"
            data-testid="post-brew-done"
            onClick={p.onDone}
          >
            Done
          </button>
        </footer>
      }
    />
  );
};

