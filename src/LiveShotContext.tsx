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
  type ScaleMessage,
  type ShotSettingsSnapshot,
} from './snapshot';
import type { WsStream } from './streams';
import { dlog } from './debugLog';

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
  children?: JSX.Element;
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
  /** Epoch ms of the first snapshot of the operation. 0 when idle. */
  startedAtMs: Accessor<number>;
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

  const scaleWeight = (): number => {
    const msg = p.scaleStream.latest();
    if (!msg || isScaleStatusFrame(msg)) return NaN;
    return msg.weight;
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
        .catch((e) => console.warn('fetch machineSettings failed', e));
    };

    if (inSession && !wasInSession) {
      // Session start. Steam always starts on `steam` in practice —
      // `airPurge` without a preceding `steam` would be unusual, but we still
      // cover it so a cold subscribe (page-load mid-purge) renders sensibly.
      setOpStartedAtMs(Date.parse(snap.timestamp));
      setOpStatus('active');
      setOpKind(op);
      setOpPhase(op === 'steam' ? (state === 'steam' ? 'steaming' : 'purging') : 'idle');
      // Steam-only: snapshot the saved duration before any mid-session edits,
      // so we can restore it on session-end. `null` if shotSettings hasn't
      // arrived yet — restore is then skipped (nothing to put back).
      if (op === 'steam') {
        originalSteamDurationSec =
          p.shotSettingsStream?.latest()?.targetSteamDuration ?? null;
      }
      fetchMachineSettings();
    } else if (inSession && wasInSession) {
      if (op !== prevOp) {
        // Operation changed without passing through idle — unexpected on real
        // hardware (the machine returns to idle between operations), but
        // restart the session cleanly so the view + `startedAtMs` match.
        setOpStartedAtMs(Date.parse(snap.timestamp));
        setOpKind(op);
        setOpPhase(op === 'steam' ? 'steaming' : 'idle');
        originalSteamDurationSec =
          op === 'steam'
            ? (p.shotSettingsStream?.latest()?.targetSteamDuration ?? null)
            : null;
        fetchMachineSettings();
      } else if (op === 'steam') {
        // Within steam: the only interesting transition is `steam` →
        // `airPurge` (start of the firmware purge). Flip phase without
        // resetting `startedAtMs` — the readouts TIME counter keeps running
        // through the purge, which honestly reflects how long we've been open.
        if (state === 'airPurge' && prevState !== 'airPurge') {
          setOpPhase('purging');
        } else if (state === 'steam' && prevState === 'airPurge') {
          // Defensive — if the firmware ever bounced back to steam. Not
          // expected on real hardware.
          setOpPhase('steaming');
        }
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
              console.warn('restore steam duration failed', e),
            );
          }
        } catch (e) {
          console.warn('restore steam duration failed', e);
        }
      }
      originalSteamDurationSec = null;
      setOpStatus('idle');
      setOpKind(null);
      setOpPhase('idle');
      setOpStartedAtMs(0);
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
  let steamStopFired = false;
  createEffect(() => {
    const snap = p.machineStream.latest();
    const steaming =
      opStatus() === 'active' && opKind() === 'steam' && opPhase() !== 'purging';
    if (!steaming) {
      // Reset once the steam session is fully over (not merely purging).
      if (opStatus() !== 'active' || opKind() !== 'steam') {
        steamStopFired = false;
      }
      return;
    }
    if (!snap || steamStopFired) return;
    const dur = p.shotSettingsStream?.latest()?.targetSteamDuration ?? 0;
    const startMs = opStartedAtMs();
    if (dur <= 0 || startMs === 0) return;
    const elapsedSec = (Date.parse(snap.timestamp) - startMs) / 1000;
    if (Number.isNaN(elapsedSec) || elapsedSec < dur) return;
    steamStopFired = true;
    dlog('steam.autostop', `elapsed=${elapsedSec.toFixed(1)}s ≥ dur=${dur}s → stop`);
    void p.onStop().catch((e) => console.warn('steam auto-stop failed', e));
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
    },
    machineStream: p.machineStream,
    scaleStream: p.scaleStream,
    shotSettingsStream: p.shotSettingsStream ?? null,
    stop: () => p.onStop(),
    extendSteam,
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
