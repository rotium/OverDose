import {
  createContext,
  createEffect,
  useContext,
  type Component,
  type JSX,
} from 'solid-js';
import type { WorkflowSnapshot } from './api';
import {
  createLiveShotAccumulator,
  type LiveShotAccumulator,
} from './liveShot';
import { isScaleStatusFrame, type MachineSnapshot, type ScaleMessage } from './snapshot';
import type { WsStream } from './streams';

/**
 * Streams + side-effects the context needs in order to drive the
 * accumulator without dragging in the network layer. App.tsx wires real
 * implementations; tests inject fakes.
 */
export interface LiveShotProviderProps {
  machineStream: WsStream<MachineSnapshot>;
  scaleStream: WsStream<ScaleMessage>;
  fetchWorkflow: () => Promise<WorkflowSnapshot>;
  /** Force-stop the brew (PUT /api/v1/machine/state/idle). */
  onStop: () => Promise<void>;
  children?: JSX.Element;
}

export interface LiveShotContextValue {
  accumulator: LiveShotAccumulator;
  stop: () => Promise<void>;
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

  // Tracking state from the previous effect run. Plain `let` — these are
  // not signals; we only read them to detect transitions.
  let prevSubstate: string | undefined;
  let prevState: string | undefined;
  let shotStartMs = 0;

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

  const value: LiveShotContextValue = {
    accumulator,
    stop: () => p.onStop(),
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
