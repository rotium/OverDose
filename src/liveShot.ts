import { batch, createSignal, type Accessor } from 'solid-js';
import type {
  GatewayShotMeasurement,
  ProfileSnapshot,
  WorkflowSnapshot,
} from './api';
import type { MachineSubstate } from './snapshot';
import { dlog } from './debugLog';

/** One captured tick of brew telemetry — what the accumulator stores per frame. */
export interface LiveShotFrame {
  /** ms since shot start. Easier to chart than absolute timestamps. */
  tMs: number;
  pressure: number;          // bar
  flow: number;              // mL/s — machine flow (sensed at group)
  /** Scale-derived flow in g/s. NaN when no scale is connected. Diverges
   *  from `flow` at the end of a shot (puck stops but residual water still
   *  lands on the scale) — that's the most useful place to read it. */
  weightFlow: number;
  weight: number;            // g (NaN if no scale connected)
  mixTemperature: number;    // °C
  targetPressure: number;    // bar
  targetFlow: number;        // mL/s
  targetMixTemperature: number; // °C
  /** ISO timestamp from the source machine snapshot (kept for GatewayShotMeasurement reuse). */
  machineTimestamp: string;
  substate: MachineSubstate;
  /** Active profile-step index (`MachineSnapshot.profileFrame`). Used by the
   *  live view to render the current step's name from the captured profile. */
  profileFrame: number;
}

/** Live readouts row — what the UI shows below the chart, raw units. */
export interface LiveShotReadouts {
  pressure: number;          // bar
  flow: number;              // mL/s
  weight: number;            // g (NaN allowed; UI renders em-dash)
  mixTemperature: number;    // °C
  /** Dispensed volume so far (mL) — flow integrated over time. The live WS
   *  stream has no volume field, so we integrate it client-side exactly
   *  like the gateway does for the persisted record (flow × Δt, summed). */
  volumeMl: number;
  /** Volume integrated only over frames at/after the profile's
   *  `target_volume_count_start` (pre-infusion excluded). Equals `volumeMl`
   *  when count-start is 0; the live view shows it separately only when the
   *  active profile sets a non-zero count-start. */
  countedVolumeMl: number;
  elapsedSec: number;
  substate: MachineSubstate;
  profileFrame: number;
}

/** Status drives the drawer's visibility + chart's record/freeze state. */
export type LiveShotStatus =
  | 'idle'        // no brew in progress; drawer closed; buffers empty
  | 'recording'   // appending frames
  | 'frozen';     // accumulator captured a final shot; drawer may still be visible while animating out

/**
 * Capacity: 10 Hz × 10 min = 6000 frames. 8 × Float64Array(6000) ≈ 384 KB.
 * Easily fits any realistic brew with deep headroom for slow profiles.
 */
export const LIVE_SHOT_BUFFER_CAPACITY = 6000;

/**
 * Frozen shot — same shape as `GatewayShotRecord.measurements` so a frozen
 * accumulator can flow directly into `ShotMiniChart` / `LastShotCard` once
 * we wire the hand-off (task #7).
 */
export interface FrozenLiveShot {
  /** First-frame timestamp; used later to reconcile with the gateway's `/shots/latest` id. */
  startedAt: string;
  /** Last-frame timestamp; useful for "happened just now" UI hints. */
  endedAt: string;
  measurements: GatewayShotMeasurement[];
  /**
   * Full workflow envelope captured at shot start (name + context + profile)
   * — not just the context, so the optimistic LastShotCard can render the
   * profile title as the headline and pull dose/yield from the same place
   * the gateway stores them (`workflow.context.target*`).
   */
  workflow: WorkflowSnapshot | null;
}

/**
 * Public surface of the accumulator. Six typed-array buffers live as
 * non-reactive fields — the chart reads them directly. The four signals
 * are low-frequency surface state (status, frame count, readouts, frozen
 * snapshot) — per-frame data never touches Solid's tracking machinery.
 */
export interface LiveShotAccumulator {
  // Reactive (low-frequency)
  status: Accessor<LiveShotStatus>;
  /** Increments on every append — chart subscribes to this only. */
  frameCount: Accessor<number>;
  readouts: Accessor<LiveShotReadouts | null>;
  /** Set when status transitions to 'frozen'; cleared by reset(). */
  frozenShot: Accessor<FrozenLiveShot | null>;
  /** Target weight from workflow context captured at shot start. 0 = no target. */
  targetYieldG: Accessor<number>;
  /** Active profile captured at shot start; used to render the current
   *  step's name in the live view. Null when the workflow fetch failed or
   *  no workflow is active. */
  currentProfile: Accessor<ProfileSnapshot | null>;

  // Hot-path arrays — chart slices these on each frameCount tick.
  readonly buffers: LiveShotBuffers;

  // Imperative — driven by LiveShotContext based on snapshot transitions
  /**
   * Begin a new shot. Takes the *whole* workflow envelope (context + profile)
   * so the live view can render the profile title and current step name.
   * Passing `null` is the no-workflow case (ad-hoc brew).
   */
  start(workflow: WorkflowSnapshot | null): void;
  append(frame: LiveShotFrame): void;
  freeze(): void;
  reset(): void;
}

export interface LiveShotBuffers {
  /** Current write cursor — number of valid samples in the buffers. */
  readonly cursor: number;
  readonly tMs: Float64Array;
  readonly pressure: Float64Array;
  readonly flow: Float64Array;
  /** Scale-derived flow in g/s. NaN entries are skipped by uPlot, so a
   *  disconnected scale leaves gaps rather than a flat-zero line. */
  readonly weightFlow: Float64Array;
  readonly weight: Float64Array;
  readonly mixTemperature: Float64Array;
  readonly targetPressure: Float64Array;
  readonly targetFlow: Float64Array;
  readonly targetMixTemperature: Float64Array;
  /** Active profile-step index per frame — used by the chart to draw a
   *  vertical marker at every step transition. Stored as Int32 because the
   *  values are small integers and we never interpolate them. */
  readonly profileFrame: Int32Array;
}

/**
 * Build a fresh accumulator. One instance per app (the LiveShotContext owns
 * it). Keeping the factory pure-TS makes it test-friendly without mounting
 * Solid components.
 *
 * Allocates the typed arrays up front; subsequent brews reuse the same
 * buffers by resetting the cursor.
 */
export function createLiveShotAccumulator(): LiveShotAccumulator {
  const cap = LIVE_SHOT_BUFFER_CAPACITY;

  // Hot-path storage. Mutable cursor lives on a wrapper so the public
  // `buffers` object can expose a stable reference whose `cursor` reads
  // back the latest value via a getter.
  const tMs = new Float64Array(cap);
  const pressure = new Float64Array(cap);
  const flow = new Float64Array(cap);
  const weightFlow = new Float64Array(cap);
  const weight = new Float64Array(cap);
  const mixTemperature = new Float64Array(cap);
  const targetPressure = new Float64Array(cap);
  const targetFlow = new Float64Array(cap);
  const targetMixTemperature = new Float64Array(cap);
  const profileFrame = new Int32Array(cap);

  let cursor = 0;
  let startedAt = '';
  let endedAt = '';
  let workflow: WorkflowSnapshot | null = null;
  // Running flow-integral (mL). Matches reaprime's ShotSequencer left-Riemann
  // sum (`flow × timeSinceLastSample`); the live WS stream carries flow but
  // not accumulated volume.
  let volumeMl = 0;
  // Same integral, but only accumulated once the shot reaches the profile's
  // volume count-start step — mirrors the gateway's volume-stop window.
  let countedVolumeMl = 0;
  let volumeCountStart = 0;

  const buffers: LiveShotBuffers = {
    get cursor() {
      return cursor;
    },
    tMs,
    pressure,
    flow,
    weightFlow,
    weight,
    mixTemperature,
    targetPressure,
    targetFlow,
    targetMixTemperature,
    profileFrame,
  };

  const [status, setStatus] = createSignal<LiveShotStatus>('idle');
  const [frameCount, setFrameCount] = createSignal(0);
  const [readouts, setReadouts] = createSignal<LiveShotReadouts | null>(null);
  const [frozenShot, setFrozenShot] = createSignal<FrozenLiveShot | null>(null);
  const [targetYieldG, setTargetYieldG] = createSignal(0);
  const [currentProfile, setCurrentProfile] = createSignal<ProfileSnapshot | null>(null);

  /**
   * Build a frozen snapshot of the current buffer state. Reconstructs the
   * GatewayShotMeasurement shape so downstream consumers (ShotMiniChart,
   * LastShotCard) can render an in-memory frozen shot identically to a
   * gateway-persisted one — see task #7.
   */
  const buildFrozenShot = (): FrozenLiveShot => {
    const measurements: GatewayShotMeasurement[] = new Array(cursor);
    for (let i = 0; i < cursor; i++) {
      const w = weight[i]!;
      const wf = weightFlow[i]!;
      measurements[i] = {
        machine: {
          timestamp: '', // filled below from the per-frame timestamp store
          flow: flow[i]!,
          pressure: pressure[i]!,
          mixTemperature: mixTemperature[i]!,
          // groupTemperature isn't recorded in the live buffers today —
          // the WS frame has it but mini-chart doesn't use it. Add a
          // dedicated buffer later if a downstream consumer wants it.
          groupTemperature: 0,
          profileFrame: profileFrame[i]!,
        },
        scale: Number.isNaN(w)
          ? undefined
          : Number.isNaN(wf)
            ? { weight: w }
            : { weight: w, weightFlow: wf },
      };
    }
    // machineTimestamp is recorded out-of-band on append() into a parallel
    // array to keep the typed buffers all numeric. Re-attach here.
    for (let i = 0; i < cursor; i++) {
      measurements[i]!.machine.timestamp = machineTimestamps[i] ?? '';
    }
    return {
      startedAt,
      endedAt,
      measurements,
      workflow,
    };
  };

  // Parallel string array for ISO timestamps — kept separately from the
  // numeric buffers so the hot path stays in typed arrays. One string per
  // frame is cheap; only inflates when a shot is frozen.
  const machineTimestamps: string[] = new Array(cap);

  const accumulator: LiveShotAccumulator = {
    status,
    frameCount,
    readouts,
    frozenShot,
    targetYieldG,
    currentProfile,
    buffers,

    start(wf) {
      cursor = 0;
      startedAt = '';
      endedAt = '';
      volumeMl = 0;
      countedVolumeMl = 0;
      volumeCountStart = wf?.profile?.target_volume_count_start ?? 0;
      workflow = wf ?? null;
      setTargetYieldG(wf?.context?.targetYield ?? 0);
      setCurrentProfile(wf?.profile ?? null);
      setFrozenShot(null);
      setReadouts(null);
      setFrameCount(0);
      setStatus('recording');
    },

    append(frame) {
      if (cursor >= cap) {
        // Out of room — silently drop. Six thousand 10 Hz frames is 10
        // minutes; if we hit this in practice the cap is wrong, not the
        // caller. Don't grow at runtime: keeps the hot path allocation-free.
        return;
      }
      if (cursor === 0) startedAt = frame.machineTimestamp;
      else {
        // Integrate flow since the previous sample. Left-Riemann (current
        // flow × elapsed) — same as the gateway, so the live readout tracks
        // the value that ends up in the persisted shot record.
        const dVol = frame.flow * ((frame.tMs - tMs[cursor - 1]!) / 1000);
        volumeMl += dVol;
        // Counted volume only accrues from the count-start step onward.
        if (frame.profileFrame >= volumeCountStart) countedVolumeMl += dVol;
      }
      endedAt = frame.machineTimestamp;

      tMs[cursor] = frame.tMs;
      pressure[cursor] = frame.pressure;
      flow[cursor] = frame.flow;
      weightFlow[cursor] = frame.weightFlow;
      weight[cursor] = frame.weight;
      mixTemperature[cursor] = frame.mixTemperature;
      targetPressure[cursor] = frame.targetPressure;
      targetFlow[cursor] = frame.targetFlow;
      targetMixTemperature[cursor] = frame.targetMixTemperature;
      profileFrame[cursor] = frame.profileFrame;
      machineTimestamps[cursor] = frame.machineTimestamp;
      cursor += 1;

      // Batch so consumers (chart bindings, readouts, etc.) only re-run
      // *once* with the new state of BOTH signals visible. Without
      // batching, frameCount fires first and a binding that also reads
      // `readouts()` would see the previous frame's readouts — which is
      // how the cooldown-frame substate hide-from-the-chart logic
      // upstream got off by one.
      batch(() => {
        setReadouts({
          pressure: frame.pressure,
          flow: frame.flow,
          weight: frame.weight,
          mixTemperature: frame.mixTemperature,
          volumeMl,
          countedVolumeMl,
          elapsedSec: frame.tMs / 1000,
          substate: frame.substate,
          profileFrame: frame.profileFrame,
        });
        setFrameCount(cursor);
      });
    },

    freeze() {
      if (status() === 'idle') return; // nothing to freeze
      // Debug: summarise the volume accounting at shot end. Comparing
      // `counted` vs `vol` reveals whether the count-start window actually
      // excluded pre-infusion (counted < vol) or counted everything
      // (counted ≈ vol — frame numbering didn't line up). `frames` shows the
      // observed profileFrame range; if its min is already ≥ countStart the
      // window never excluded anything.
      let minF = Infinity;
      let maxF = -Infinity;
      for (let i = 0; i < cursor; i++) {
        const f = profileFrame[i]!;
        if (f < minF) minF = f;
        if (f > maxF) maxF = f;
      }
      dlog(
        'shot',
        `end: vol=${volumeMl.toFixed(1)}mL counted=${countedVolumeMl.toFixed(1)}mL ` +
          `countStart=${volumeCountStart} frames=${minF}..${maxF} samples=${cursor}`,
      );
      setFrozenShot(buildFrozenShot());
      setStatus('frozen');
    },

    reset() {
      cursor = 0;
      startedAt = '';
      endedAt = '';
      volumeMl = 0;
      countedVolumeMl = 0;
      volumeCountStart = 0;
      workflow = null;
      setFrameCount(0);
      setReadouts(null);
      setFrozenShot(null);
      setTargetYieldG(0);
      setCurrentProfile(null);
      setStatus('idle');
    },
  };

  return accumulator;
}
