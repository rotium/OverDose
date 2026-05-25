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
  type ScaleMessage,
  type ShotSettingsSnapshot,
} from './snapshot';
import type { WsStream } from './streams';

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
 * Per-operation session for the non-espresso live views (steam today; water
 * and flush will reuse this). Lightweight on purpose — no ring buffers, just
 * "we're in this state, here's when it started". The drawer's open/close
 * lifecycle is driven by `status`, and the view computes elapsed from
 * `startedAtMs` against the latest machine timestamp.
 *
 * `phase` distinguishes the active-steaming window from the trailing wand
 * purge that the firmware runs autonomously after steam ends. The DE1
 * sequences `steam` → (brief gateway-hidden puffing) → `airPurge` → `idle`;
 * the session stays active across both `steam` and `airPurge` so the drawer
 * keeps showing what the machine is doing for the full ~5s purge. The
 * view swaps its hero copy when phase flips to `'purging'`.
 */
export type SteamSessionStatus = 'idle' | 'active';
export type SteamSessionPhase = 'steaming' | 'purging' | 'idle';

export interface SteamSession {
  status: Accessor<SteamSessionStatus>;
  phase: Accessor<SteamSessionPhase>;
  /** Epoch ms of the first snapshot where state === 'steam'. 0 when idle. */
  startedAtMs: Accessor<number>;
}

export interface LiveShotContextValue {
  accumulator: LiveShotAccumulator;
  steamSession: SteamSession;
  machineStream: WsStream<MachineSnapshot>;
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

  // Steam-session lifecycle — independent of the espresso accumulator. The
  // drawer opens when either is active; the per-op view picks itself based
  // on machine.state.state.
  const [steamStatus, setSteamStatus] = createSignal<SteamSessionStatus>('idle');
  const [steamPhase, setSteamPhase] = createSignal<SteamSessionPhase>('idle');
  const [steamStartedAtMs, setSteamStartedAtMs] = createSignal(0);

  // Cached machine-settings blob. Fetched on each steam-session start; an
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
    if (substate === 'preparingForShot' && prevSubstate !== 'preparingForShot') {
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

    // Steam-session transitions. The session spans the DE1's full end-of-
    // steam sequence: `steam` (active) → `airPurge` (firmware-driven ~5 s
    // wand purge) → idle. Either of those user-visible states keeps the
    // session active and the drawer open; the view distinguishes them via
    // `phase` ('steaming' vs 'purging'). The gateway folds the brief
    // `puffing` substate (between steam-end and airPurge) into
    // `state=steam, substate=idle`, so we don't see it directly — but
    // we're still in 'steam' for the whole window, so no extra handling
    // needed.
    const inSession = state === 'steam' || state === 'airPurge';
    const wasInSession = prevState === 'steam' || prevState === 'airPurge';

    if (inSession && !wasInSession) {
      // Session start. Always starts on `steam` in practice — `airPurge`
      // without a preceding `steam` would be unusual, but we still cover it
      // so a cold subscribe (page-load mid-purge) renders sensibly.
      setSteamStartedAtMs(Date.parse(snap.timestamp));
      setSteamStatus('active');
      setSteamPhase(state === 'steam' ? 'steaming' : 'purging');
      // Snapshot the saved steam duration before any mid-session edits, so
      // we can restore it on session-end. `null` if shotSettings hasn't
      // arrived yet — restore is then skipped (we don't know what to put
      // back).
      const curSettings = p.shotSettingsStream?.latest();
      originalSteamDurationSec = curSettings?.targetSteamDuration ?? null;
      // Fire-and-forget fetch of machine-settings (for steam-flow). If it
      // fails or no fetcher is wired, the live view just doesn't render a
      // value — which is the same outcome as the WS never having pushed it.
      if (p.onFetchMachineSettings) {
        void p
          .onFetchMachineSettings()
          .then((s) => {
            if (s) setMachineSettings(s);
          })
          .catch((e) => console.warn('fetch machineSettings failed', e));
      }
    } else if (inSession && wasInSession) {
      // Within-session transition. The only interesting one is
      // `steam` → `airPurge` (start of the firmware purge). Flip phase
      // without resetting `startedAtMs` — the readouts row keeps its
      // TIME counter running through the purge, which honestly reflects
      // how long the session has been open.
      if (state === 'airPurge' && prevState !== 'airPurge') {
        setSteamPhase('purging');
      } else if (state === 'steam' && prevState === 'airPurge') {
        // Defensive — if the firmware ever bounced back to steam, return
        // to 'steaming'. Not expected on real hardware.
        setSteamPhase('steaming');
      }
    } else if (!inSession && wasInSession) {
      // Session end (purge finished, or steam ended without a purge in the
      // two-tap stop case). Restore the saved steam duration if we (or the
      // user) bumped it during the session. Only writes when the current
      // firmware value differs from what we captured at start — avoids a
      // redundant POST when no extend happened.
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
        // Fire-and-forget — the user has already moved on from the steam
        // session, so we don't gate the UI on the round-trip. If the POST
        // fails the saved value stays bumped; user can fix in Settings.
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
      setSteamStatus('idle');
      setSteamPhase('idle');
      setSteamStartedAtMs(0);
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
    steamSession: {
      status: steamStatus,
      phase: steamPhase,
      startedAtMs: steamStartedAtMs,
    },
    machineStream: p.machineStream,
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
