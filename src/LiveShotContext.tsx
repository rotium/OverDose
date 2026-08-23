import {
  createContext,
  createSignal,
  createEffect,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import type { MachineSettingsSnapshot, WorkflowSnapshot } from './api';
import {
  createLiveShotAccumulator,
  type LiveShotAccumulator,
} from './liveShot';
import {
  isScaleStatusFrame,
  type MachineSnapshot,
  type MachineState,
  type MachineSubstate,
  type ScaleMessage,
  type ShotSettingsSnapshot,
} from './snapshot';
import type { WsStream } from './streams';
import { log } from './debugLog';
import {
  adjustWaterTarget,
  nextWaterStop,
  WATER_SCALE_FRESH_MS,
  WATER_TARE_CONFIRM_G,
  WATER_TARE_SETTLE_MS,
  type WaterStopSensor,
  type WaterStopState,
} from './hotWater';

/**
 * Streams + side-effects the context needs in order to drive the
 * accumulator without dragging in the network layer. App.tsx wires real
 * implementations; tests inject fakes.
 *
 * `shotSettingsStream` is optional — older tests that only exercise the
 * espresso accumulator don't need it. Per-operation views that consume it
 * (LiveSteamView) tolerate a `null` latest() during the gap.
 */
export interface LiveShotProviderProps {
  machineStream: WsStream<MachineSnapshot>;
  scaleStream: WsStream<ScaleMessage>;
  shotSettingsStream?: WsStream<ShotSettingsSnapshot>;
  fetchWorkflow: () => Promise<WorkflowSnapshot>;
  /** Force-stop the brew (PUT /api/v1/machine/state/idle). */
  onStop: () => Promise<void>;
  /** Persist updated shotSettings. Used by the steam view's +10s extend
   *  button (and any future live-op control that mutates settings). */
  onUpdateShotSettings?: (settings: ShotSettingsSnapshot) => Promise<void> | void;
  /** One-shot fetcher for the firmware machine-settings blob. Called when
   *  the steam session starts so the live view can show the current
   *  `steamFlow` value (which isn't on the shotSettings WS stream). */
  onFetchMachineSettings?: () => Promise<MachineSettingsSnapshot | null>;
  /** Sparse PATCH for the firmware machine-settings blob — used by the
   *  live steam view's in-session flow slider. */
  onUpdateMachineSettings?: (
    partial: Partial<MachineSettingsSnapshot>,
  ) => Promise<void> | void;
  /** Zero the scale (PUT /api/v1/scale/tare). Hot water needs its own tare:
   *  we write `volume = 0` to the machine so the gateway's HotWaterSequencer
   *  never arms, which also means it never tares for us. */
  onTareScale?: () => Promise<void> | void;
  children?: JSX.Element;
}

/**
 * What the prep screen wants from the next hot-water pour. Published
 * continuously rather than handed over on Start, so a pour begun at the group
 * head picks up the same target — the machine itself is carrying `volume = 0`
 * and can't stop on its own.
 */
export interface WaterIntent {
  /** Target amount (mL ≈ g). 0 disables the auto-stop entirely. */
  targetMl: number;
  /** Configured hot-water flow — the lookahead rate until a measured one
   *  becomes trustworthy. */
  flow: number;
  /** Use the scale when one is connected. False → count the water instead. */
  useScale: boolean;
  /** Vessel being poured into, for the live view's header. */
  vesselName?: string | null;
}

/**
 * Per-operation session for the non-espresso live views (steam, hot water,
 * flush). Lightweight on purpose — no ring buffers, just "we're in this
 * operation, here's when it started". The drawer's open/close lifecycle is
 * driven by `status`, the body it shows is driven by `kind`, and each view
 * computes elapsed from `startedAtMs` against the latest machine timestamp.
 *
 * `phase` is steam-specific: it distinguishes the active-steaming window from
 * the trailing wand purge the firmware runs autonomously after steam ends.
 * The DE1 sequences `steam` → (brief gateway-hidden puffing) → `airPurge` →
 * `idle`; the session stays active across both `steam` and `airPurge` so the
 * drawer keeps showing what the machine is doing for the full ~5s purge, and
 * the steam view swaps its hero copy when phase flips to `'purging'`. Water
 * and flush have no purge — their phase stays `'idle'` throughout.
 */
export type LiveOpKind = 'steam' | 'water' | 'flush';
export type OperationSessionStatus = 'idle' | 'active';
export type OperationSessionPhase = 'steaming' | 'purging' | 'idle';

export interface OperationSession {
  status: Accessor<OperationSessionStatus>;
  /** Which operation is live — picks the drawer body. Null when idle. */
  kind: Accessor<LiveOpKind | null>;
  /** Steam-only sub-phase (steaming/purging). Always `'idle'` for water/flush. */
  phase: Accessor<OperationSessionPhase>;
  /** Epoch ms of the first snapshot of the operation. 0 when idle. Counts the
   *  warm-up (`preparingForShot`) too — used for the readouts' open-duration. */
  startedAtMs: Accessor<number>;
  /** Steam-only: epoch ms of the first `steam/pouring` frame — i.e. when steam
   *  actually started flowing, excluding boiler warm-up. 0 until steaming
   *  begins (and for water/flush). Drives the countdown + auto-stop so the
   *  duration reflects real steam time, matching the firmware's own
   *  `TargetSteamLength`. */
  steamingStartedAtMs: Accessor<number>;
}

/** Map a machine state onto the live-operation it represents (or null). The
 *  firmware's trailing `airPurge` folds into the steam session. */
const opKindForState = (s: MachineState | undefined): LiveOpKind | null => {
  if (s === 'steam' || s === 'airPurge') return 'steam';
  if (s === 'hotWater') return 'water';
  if (s === 'flush') return 'flush';
  return null;
};

export interface LiveShotContextValue {
  accumulator: LiveShotAccumulator;
  operationSession: OperationSession;
  machineStream: WsStream<MachineSnapshot>;
  /** Scale frames — the water view reads live cup weight for its hero. */
  scaleStream: WsStream<ScaleMessage>;
  shotSettingsStream: WsStream<ShotSettingsSnapshot> | null;
  stop: () => Promise<void>;
  /**
   * Add `deltaSec` to the current `targetSteamDuration` and persist. No-op
   * when no settings have arrived yet or no updater is wired. Returns the
   * underlying update promise so callers can await it (tests rely on this).
   */
  extendSteam: (deltaSec: number) => Promise<void>;
  /** Publish (or clear, with null) what the next hot-water pour should target.
   *  Called reactively by the prep screen. */
  setWaterIntent: (intent: WaterIntent | null) => void;
  /** Live hot-water target (mL ≈ g). Seeded from the intent when the pour arms,
   *  then mutated by {@link adjustWaterVolume} mid-pour. 0 → no auto-stop. */
  waterTarget: Accessor<number>;
  /** Water counted so far (mL), integrated from group-head flow. Drives the
   *  hero when there's no scale, and the stop on that path. */
  waterPoured: Accessor<number>;
  /** Which reading is driving this pour's stop — so the UI can name it. */
  waterSensor: Accessor<WaterStopSensor>;
  /** Vessel name captured when the pour armed. Null for an unpicked pour. */
  waterVesselName: Accessor<string | null>;
  /** Nudge the live target mid-pour. Dropping it below what's already poured
   *  stops immediately, which is the correct reading of "that's enough". */
  adjustWaterVolume: (deltaMl: number) => void;
  /**
   * Latest firmware machine-settings snapshot, fetched on steam-session
   * start. Null until the fetch resolves (or if no fetcher was injected /
   * the request failed). Stays cached across reset for the next session.
   */
  machineSettings: Accessor<MachineSettingsSnapshot | null>;
  /**
   * Sparse partial update of `machineSettings`. Optimistically merges the
   * partial into the cached snapshot so the slider doesn't bounce while the
   * gateway round-trips.
   */
  updateMachineSettings: (
    partial: Partial<MachineSettingsSnapshot>,
  ) => Promise<void>;
}

const Ctx = createContext<LiveShotContextValue>();

/**
 * Reads the per-frame fields from the machine snapshot stream + latest scale
 * weight and pushes them into the accumulator. Lifecycle transitions are
 * derived from `state.state` + `state.substate`:
 *
 *   substate enters 'preparingForShot'   → start a new shot (also fetches workflow)
 *   while status === 'recording'         → append every machine frame
 *   substate enters 'pouringDone'        → freeze
 *   state leaves 'espresso'              → reset to idle (closes the drawer)
 *
 * The fetchWorkflow promise is non-blocking — frames continue to append
 * while it resolves. If it fails or returns no context the bar just hides;
 * the rest of the live view is unaffected.
 */
export const LiveShotProvider: Component<LiveShotProviderProps> = (p) => {
  const accumulator = createLiveShotAccumulator();

  // Operation-session lifecycle — independent of the espresso accumulator.
  // The drawer opens when either is active; `opKind` picks which per-op view
  // to render. `opPhase` is steam-only (steaming/purging); water/flush leave
  // it at 'idle'.
  const [opStatus, setOpStatus] = createSignal<OperationSessionStatus>('idle');
  const [opKind, setOpKind] = createSignal<LiveOpKind | null>(null);
  const [opPhase, setOpPhase] = createSignal<OperationSessionPhase>('idle');
  const [opStartedAtMs, setOpStartedAtMs] = createSignal(0);
  // Epoch ms of the first `steam/pouring` frame this session — when steam
  // actually started flowing (boiler warm-up excluded). 0 until then.
  const [steamingStartedAtMs, setSteamingStartedAtMs] = createSignal(0);

  // Cached machine-settings blob. Fetched on each operation-session start; an
  // in-flight session can refetch via the optimistic merge in
  // `updateMachineSettings`. Cleared only on provider unmount.
  const [machineSettings, setMachineSettings] =
    createSignal<MachineSettingsSnapshot | null>(null);

  // Tracking state from the previous effect run. Plain `let` — these are
  // not signals; we only read them to detect transitions.
  let prevSubstate: string | undefined;
  let prevState: string | undefined;
  let shotStartMs = 0;

  // `targetSteamDuration` captured at steam-session start. Used to restore
  // the firmware default when the session ends — the +10s extend writes
  // through to firmware so the auto-stop actually fires later, but we don't
  // want that extension to drift the saved default across future sessions.
  // Null when no session is active or when shotSettings hadn't arrived yet.
  let originalSteamDurationSec: number | null = null;

  // Whether this steam session has shown the `pouring` substate yet (steam
  // actually flowing). Distinguishes "warming up / pre-pour" (phase steaming,
  // no countdown) from "stopped & purging" (phase purging) — both of which
  // sit under parent state `steam` with a non-`pouring` substate.
  let steamSawPouring = false;

  // Steam sub-phase from the raw (state, substate) + whether we've seen real
  // steaming this session. The firmware parks under parent `steam` with
  // substate `pouringDone`/`idle` during the wand purge, so "stopped" is "left
  // `pouring` after having steamed", not "parent state changed".
  const steamPhaseFor = (
    state: MachineState | undefined,
    substate: MachineSubstate | undefined,
  ): OperationSessionPhase => {
    if (state === 'airPurge') return 'purging'; // legacy/fallback
    if (substate === 'pouring') return 'steaming';
    if (steamSawPouring) return 'purging';
    return 'steaming'; // warming up / pre-pour
  };

  const scaleWeight = (): number => {
    const msg = p.scaleStream.latest();
    if (!msg || isScaleStatusFrame(msg)) return NaN;
    return msg.weight;
  };

  /** A status frame carries connectedness without a weight; a data frame
   *  implies connected and carries one. Same derivation the header pill uses. */
  const scaleConnectedNow = (): boolean => {
    const msg = p.scaleStream.latest();
    if (!msg) return false;
    return isScaleStatusFrame(msg) ? msg.status === 'connected' : true;
  };

  const scaleWeightFlow = (): number => {
    const msg = p.scaleStream.latest();
    if (!msg || isScaleStatusFrame(msg)) return NaN;
    // weightFlow is required by the latest gateway, but be defensive — an
    // older gateway running the same client should still mostly work, just
    // without the trace.
    return typeof msg.weightFlow === 'number' ? msg.weightFlow : NaN;
  };

  createEffect(() => {
    const snap = p.machineStream.latest();
    if (!snap) return;
    const state = snap.state.state;
    const substate = snap.state.substate;

    // --- Lifecycle transitions (low-frequency) ---
    // Drive transitions BEFORE the append so the very first frame after
    // 'preparingForShot' lands in a fresh buffer rather than the prior shot.
    //
    // Guarded on state==='espresso' because the DE1 firmware emits
    // `preparingForShot` from several heating substates (heatWaterTank,
    // heatWaterHeater, stabilizeMixTemp) during any warm-up — including
    // wake-from-sleep — not just before a real shot. Without the guard,
    // waking the machine would open the brew drawer with no path to close
    // it, since the state never reaches `espresso` and the freeze branch
    // below never fires.
    if (
      substate === 'preparingForShot' &&
      prevSubstate !== 'preparingForShot' &&
      state === 'espresso'
    ) {
      shotStartMs = Date.parse(snap.timestamp);
      // Start with no workflow immediately; replace with the fetched
      // workflow (target + profile + step names) when the request lands.
      accumulator.start(null);
      void p.fetchWorkflow().then((wf) => {
        if (accumulator.status() === 'recording') {
          accumulator.start(wf);
        }
      });
    }

    // Operation-session transitions (steam / hot water / flush). The steam
    // session spans the DE1's full end-of-steam sequence: `steam` (active) →
    // `airPurge` (firmware-driven ~5 s wand purge) → idle. Both map to the
    // 'steam' op so the session stays active across them; the steam view
    // distinguishes them via `phase`. (The gateway folds the brief `puffing`
    // substate into `state=steam`, so we never see it directly.) Water and
    // flush are single-state operations with no purge.
    const op = opKindForState(state);
    const prevOp = opKindForState(prevState as MachineState | undefined);
    const inSession = op !== null;
    const wasInSession = prevOp !== null;

    // Fire-and-forget fetch of machine-settings on any op start — supplies
    // the flow sliders (steamFlow / hotWaterFlow / flushFlow) and flush's
    // countdown target (flushTimeout). If it fails or no fetcher is wired,
    // the views just fall back to em-dashes / count-up.
    const fetchMachineSettings = (): void => {
      if (!p.onFetchMachineSettings) return;
      void p
        .onFetchMachineSettings()
        .then((s) => {
          if (s) setMachineSettings(s);
        })
        .catch((e) => log.warn('machine', 'fetch machineSettings failed', e));
    };

    // Steam-only: register the `pouring` substate (real steam flow). Starts the
    // steaming clock at the first `pouring` frame so warm-up isn't counted.
    const registerSteamPour = (): void => {
      if (substate === 'pouring' && !steamSawPouring) {
        steamSawPouring = true;
        setSteamingStartedAtMs(Date.parse(snap.timestamp));
        log.info('steam', 'steaming started (pouring)');
      }
    };

    if (inSession && !wasInSession) {
      // Session start. Steam always starts on `steam` in practice —
      // `airPurge` without a preceding `steam` would be unusual, but we still
      // cover it so a cold subscribe (page-load mid-purge) renders sensibly.
      setOpStartedAtMs(Date.parse(snap.timestamp));
      setOpStatus('active');
      setOpKind(op);
      if (op === 'steam') {
        steamSawPouring = false;
        setSteamingStartedAtMs(0);
        registerSteamPour(); // cold subscribe already mid-pour
        setOpPhase(steamPhaseFor(state, substate));
        // Snapshot the saved duration before any mid-session edits, so we can
        // restore it on session-end. `null` if shotSettings hasn't arrived
        // yet — restore is then skipped (nothing to put back).
        originalSteamDurationSec =
          p.shotSettingsStream?.latest()?.targetSteamDuration ?? null;
      } else {
        setOpPhase('idle');
      }
      fetchMachineSettings();
    } else if (inSession && wasInSession) {
      if (op !== prevOp) {
        // Operation changed without passing through idle — unexpected on real
        // hardware (the machine returns to idle between operations), but
        // restart the session cleanly so the view + `startedAtMs` match.
        setOpStartedAtMs(Date.parse(snap.timestamp));
        setOpKind(op);
        if (op === 'steam') {
          steamSawPouring = false;
          setSteamingStartedAtMs(0);
          registerSteamPour();
          setOpPhase(steamPhaseFor(state, substate));
          originalSteamDurationSec =
            p.shotSettingsStream?.latest()?.targetSteamDuration ?? null;
        } else {
          setOpPhase('idle');
          originalSteamDurationSec = null;
        }
        fetchMachineSettings();
      } else if (op === 'steam') {
        // Within steam: track real steam flow (`pouring`) and keep the phase
        // in sync. "Stopped/purging" is detected as leaving `pouring` after
        // having steamed — the parent state stays `steam` through the
        // firmware purge (substate `pouringDone`/`idle`), so we can't key off
        // it. `startedAtMs` is untouched: the readouts' open-duration keeps
        // running across the purge.
        registerSteamPour();
        if (prevSubstate === 'pouring' && substate !== 'pouring') {
          log.info('steam', `steam stopped → purging (state=${state}, substate=${substate})`);
        }
        // setOpPhase with an unchanged value is a no-op (Object.is), so this
        // is safe to call every frame without re-triggering subscribers.
        setOpPhase(steamPhaseFor(state, substate));
      }
    } else if (!inSession && wasInSession) {
      // Session end. Steam-only: restore the saved steam duration if we (or
      // the user) bumped it during the session. Only writes when the current
      // firmware value differs from what we captured at start — avoids a
      // redundant POST when no extend happened. (Guarded by
      // `originalSteamDurationSec !== null`, which is only set for steam.)
      const cur = p.shotSettingsStream?.latest();
      if (
        originalSteamDurationSec !== null &&
        cur &&
        cur.targetSteamDuration !== originalSteamDurationSec &&
        p.onUpdateShotSettings
      ) {
        const restored: ShotSettingsSnapshot = {
          ...cur,
          targetSteamDuration: originalSteamDurationSec,
        };
        // Fire-and-forget — the user has already moved on from the session,
        // so we don't gate the UI on the round-trip. If the POST fails the
        // saved value stays bumped; user can fix in Settings.
        try {
          const r = p.onUpdateShotSettings(restored);
          if (r && typeof (r as Promise<void>).catch === 'function') {
            void (r as Promise<void>).catch((e) =>
              log.warn('steam', 'restore steam duration failed', e),
            );
          }
        } catch (e) {
          log.warn('steam', 'restore steam duration failed', e);
        }
      }
      originalSteamDurationSec = null;
      steamSawPouring = false;
      setSteamingStartedAtMs(0);
      setOpStatus('idle');
      setOpKind(null);
      setOpPhase('idle');
      setOpStartedAtMs(0);
      log.info('op', `${prevOp} session end → ${state}`);
    }

    if (prevState === 'espresso' && state !== 'espresso') {
      // Brew ended — freeze immediately so the drawer closes promptly.
      //
      // Trade-off: the gateway's ShotSequencer keeps recording for ~4 s
      // past this point (the scale-settling tail; see
      // `reaprime/lib/src/controllers/shot_sequencer.dart:314-331`), so
      // its persisted record runs a few seconds longer than ours. That
      // shows up as a small "chart extends" moment in LastShotCard when
      // `/shots/latest` finally returns the persisted version (~3-4 s
      // later) and replaces our optimistic record. We accept that brief
      // visual update in exchange for a snappy drawer close — holding
      // the drawer open for those 4 s felt stuck.
      if (accumulator.status() === 'recording') accumulator.freeze();
    }

    // --- Per-frame append (hot path) ---
    if (accumulator.status() === 'recording') {
      accumulator.append({
        tMs: Date.parse(snap.timestamp) - shotStartMs,
        pressure: snap.pressure,
        flow: snap.flow,
        weightFlow: scaleWeightFlow(),
        weight: scaleWeight(),
        mixTemperature: snap.mixTemperature,
        targetPressure: snap.targetPressure,
        targetFlow: snap.targetFlow,
        targetMixTemperature: snap.targetMixTemperature,
        machineTimestamp: snap.timestamp,
        substate: snap.state.substate,
        profileFrame: snap.profileFrame,
      });
    }

    prevState = state;
    prevSubstate = substate;
  });

  // ── Steam time-stop enforcement ──
  // Nothing else reliably stops steam at the target duration: the DE1 firmware
  // doesn't on its own, reaprime's SteamSequencer only does stop-at-temperature
  // (inert today), and the simulator never stops steam. So once a steam session
  // has run for `targetSteamDuration`, request idle — matching the countdown
  // the user sees in LiveSteamView. Fires once per session; skipped during the
  // trailing wand purge and when no duration is set (0 = steam until stopped).
  //
  // The clock is `steamingStartedAtMs` (first `pouring` frame), NOT session
  // start — so boiler warm-up (`preparingForShot`) isn't counted against the
  // duration. This matches the firmware's own `TargetSteamLength`, which also
  // counts from actual steam start. Until steaming begins the clock is 0 and
  // this is a no-op.
  let steamStopFired = false;
  createEffect(() => {
    const snap = p.machineStream.latest();
    const steaming =
      opStatus() === 'active' && opKind() === 'steam' && opPhase() === 'steaming';
    if (!steaming) {
      // Reset once the steam session is fully over (not merely purging).
      if (opStatus() !== 'active' || opKind() !== 'steam') {
        steamStopFired = false;
      }
      return;
    }
    if (!snap || steamStopFired) return;
    const dur = p.shotSettingsStream?.latest()?.targetSteamDuration ?? 0;
    const startMs = steamingStartedAtMs();
    if (dur <= 0 || startMs === 0) return;
    const elapsedSec = (Date.parse(snap.timestamp) - startMs) / 1000;
    if (Number.isNaN(elapsedSec) || elapsedSec < dur) return;
    steamStopFired = true;
    log.info('steam.autostop', `elapsed=${elapsedSec.toFixed(1)}s ≥ dur=${dur}s → stop`);
    void p.onStop().catch((e) => log.warn('steam', 'steam auto-stop failed', e));
  });

  // ── Hot-water stop enforcement ──
  // OverDose owns this stop outright. The gateway's HotWaterSequencer latches
  // its target the moment the machine enters `hotWater` and never re-reads it,
  // so a mid-pour ± could never move it — and its target is the DE1's
  // single-byte volume field, capping vessels at 255 mL. We keep the firmware
  // out of the way by writing `volume = 0` (the DE1's "no volume stop"
  // convention), which also makes the sequencer decline to arm, so we never
  // have to touch its machine-wide `stopHotWaterAtWeight` setting. The derived
  // duration cap remains as the backstop if this code stops watching.
  //
  // Same comparator for both sensors: grams-and-g/s from the scale, or
  // millilitres-and-mL/s integrated from the group head. Water is 1 g per mL.
  const [waterIntent, setWaterIntent] = createSignal<WaterIntent | null>(null);
  const [waterTarget, setWaterTarget] = createSignal(0);
  const [waterPoured, setWaterPoured] = createSignal(0);
  const [waterSensor, setWaterSensor] = createSignal<WaterStopSensor>('flow');
  const [waterVesselName, setWaterVesselName] = createSignal<string | null>(null);

  let waterStop: WaterStopState | null = null;
  let waterArmedAtMs = 0;
  let waterTareAtMs = 0;
  let waterTareConfirmed = false;
  let waterLastFrameMs = 0;

  /** Is the latest scale frame recent enough to stop on? Compared against the
   *  machine clock rather than wall-clock: both timestamps come from the
   *  gateway, so this stays a single-clock delta (and stays testable). */
  const scaleFreshAt = (nowMs: number): boolean => {
    const msg = p.scaleStream.latest();
    if (!msg || isScaleStatusFrame(msg)) return false;
    const t = Date.parse(msg.timestamp);
    if (Number.isNaN(t) || Number.isNaN(nowMs)) return false;
    return Math.abs(nowMs - t) < WATER_SCALE_FRESH_MS;
  };

  const disarmWater = (): void => {
    waterStop = null;
    waterArmedAtMs = 0;
    waterTareAtMs = 0;
    waterTareConfirmed = false;
    waterLastFrameMs = 0;
  };

  const adjustWaterVolume = (deltaMl: number): void => {
    const next = adjustWaterTarget(waterTarget(), deltaMl);
    setWaterTarget(next);
    if (waterStop) waterStop = { ...waterStop, targetAmount: next };
    log.debug('water.adjust', `${deltaMl > 0 ? '+' : ''}${deltaMl} → ${next}`);
  };

  createEffect(() => {
    const snap = p.machineStream.latest();
    if (!snap) return;
    const inHotWater = snap.state.state === 'hotWater';
    const nowMs = Date.parse(snap.timestamp);

    if (!inHotWater && waterStop === null) return;

    // --- arm on the first hotWater frame ---
    if (inHotWater && waterStop === null) {
      const intent = waterIntent();
      const useScale = (intent?.useScale ?? true) && scaleConnectedNow();
      setWaterSensor(useScale ? 'scale' : 'flow');
      setWaterTarget(intent?.targetMl ?? 0);
      setWaterVesselName(intent?.vesselName ?? null);
      setWaterPoured(0);
      waterStop = {
        targetAmount: intent?.targetMl ?? 0,
        configuredFlow: intent?.flow && intent.flow > 0 ? intent.flow : 6,
        activeSeen: false,
        stopRequested: false,
      };
      waterArmedAtMs = Number.isNaN(nowMs) ? 0 : nowMs;
      waterLastFrameMs = waterArmedAtMs;
      waterTareConfirmed = false;
      if (useScale) {
        // Nobody else tares for us — the gateway's sequencer never armed.
        waterTareAtMs = waterArmedAtMs;
        void Promise.resolve(p.onTareScale?.()).catch((e) =>
          log.warn('water', 'tare for hot water failed', e),
        );
      }
      log.info(
        'water.arm',
        `sensor=${useScale ? 'scale' : 'flow'} target=${intent?.targetMl ?? 0}`,
      );
    }

    if (!waterStop) return;

    // --- integrate group-head flow (the counting sensor, and the no-scale hero) ---
    if (inHotWater && !Number.isNaN(nowMs)) {
      const dtSec = Math.max(0, (nowMs - waterLastFrameMs) / 1000);
      waterLastFrameMs = nowMs;
      if (dtSec > 0 && dtSec < 5) setWaterPoured((v) => v + snap.flow * dtSec);
    }

    const onScale = waterSensor() === 'scale';
    const weight = scaleWeight();

    // The tare is trusted only once the scale has been *observed* at or below
    // the confirm threshold — a cup left on the platter with a lagging physical
    // tare otherwise reads as a finished pour and stops instantly.
    if (onScale && !waterTareConfirmed && Number.isFinite(weight)) {
      if (weight <= WATER_TARE_CONFIRM_G) waterTareConfirmed = true;
    }
    const frameMs = Number.isNaN(nowMs) ? waterLastFrameMs : nowMs;
    const measurementReady = onScale
      ? waterTareConfirmed &&
        waterTareAtMs > 0 &&
        frameMs - waterTareAtMs >= WATER_TARE_SETTLE_MS &&
        scaleFreshAt(frameMs)
      : true;

    const decision = nextWaterStop(waterStop, {
      inHotWater,
      sinceArmedMs: frameMs - waterArmedAtMs,
      measurementReady,
      measured: onScale
        ? Number.isFinite(weight)
          ? Math.max(0, weight)
          : undefined
        : waterPoured(),
      rate: onScale ? scaleWeightFlow() : snap.flow,
    });

    if (decision.action === 'clear') {
      disarmWater();
      return;
    }
    waterStop = decision.state;
    if (decision.action === 'stop') {
      log.info(
        'water.autostop',
        `${waterSensor()} ${decision.measured.toFixed(1)} (projected ${decision.projected.toFixed(1)}) ≥ ${waterStop?.targetAmount} → stop`,
      );
      void p.onStop().catch((e) => log.warn('water', 'water auto-stop failed', e));
    }
  });

  const extendSteam = async (deltaSec: number): Promise<void> => {
    const cur = p.shotSettingsStream?.latest();
    if (!cur || !p.onUpdateShotSettings) return;
    // Clamp at 0 — never push the firmware into a negative duration even if
    // a caller passes a wonky delta.
    const next = Math.max(0, cur.targetSteamDuration + deltaSec);
    await p.onUpdateShotSettings({ ...cur, targetSteamDuration: next });
  };

  const updateMachineSettings = async (
    partial: Partial<MachineSettingsSnapshot>,
  ): Promise<void> => {
    // Optimistic local merge first — the slider already shows the new
    // value, but other readers (the readouts row) need it too. The merge
    // also covers the gap when the gateway accepts the write but doesn't
    // round-trip an updated value (machineSettings has no WS stream).
    const cur = machineSettings();
    if (cur) setMachineSettings({ ...cur, ...partial });
    if (!p.onUpdateMachineSettings) return;
    try {
      await p.onUpdateMachineSettings(partial);
    } catch (e) {
      // Roll back the optimistic merge on failure so the UI reflects what
      // the firmware actually has.
      if (cur) setMachineSettings(cur);
      throw e;
    }
  };

  const value: LiveShotContextValue = {
    accumulator,
    operationSession: {
      status: opStatus,
      kind: opKind,
      phase: opPhase,
      startedAtMs: opStartedAtMs,
      steamingStartedAtMs,
    },
    machineStream: p.machineStream,
    scaleStream: p.scaleStream,
    shotSettingsStream: p.shotSettingsStream ?? null,
    stop: () => p.onStop(),
    extendSteam,
    setWaterIntent,
    waterTarget,
    waterPoured,
    waterSensor,
    waterVesselName,
    adjustWaterVolume,
    machineSettings,
    updateMachineSettings,
  };

  return <Ctx.Provider value={value}>{p.children}</Ctx.Provider>;
};

export function useLiveShot(): LiveShotContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useLiveShot must be used inside <LiveShotProvider>');
  }
  return ctx;
}
