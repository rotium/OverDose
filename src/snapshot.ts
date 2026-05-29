// `machineActivity` only type-imports this module, so this runtime import
// introduces no cycle. `isWarmingUp`/`isHeaterOff` below delegate to it.
import { deriveActivity } from './machineActivity';

/**
 * Machine state as reported by the gateway (`MachineState` in reaprime's
 * `machine.dart`, serialized by enum name). Mirrors that enum 1:1 so every
 * value the gateway can send is represented.
 *
 * `heating` / `preheating` are part of the gateway enum but the DE1 firmware
 * mapping never actually produces them (warm-up is reported as `idle` +
 * `preparingForShot`); kept here for faithfulness to the wire contract.
 *
 * See `docs/states.md` for the full firmware → gateway → skin map.
 */
export type MachineState =
  | 'booting'
  | 'busy'
  | 'idle'
  | 'schedIdle'
  | 'sleeping'
  | 'heating'
  | 'preheating'
  | 'espresso'
  | 'hotWater'
  | 'flush'
  | 'steam'
  | 'steamRinse'
  | 'skipStep'
  | 'cleaning'
  | 'descaling'
  | 'calibration'
  | 'selfTest'
  | 'airPurge'
  | 'needsWater'
  | 'error'
  | 'fwUpgrade';

/**
 * Machine substate (`MachineSubstate` in reaprime, serialized by enum name).
 * Mirrors that enum 1:1, including every error substate.
 *
 * The gateway collapses several distinct firmware substates into these — e.g.
 * the three warm-up substates → `preparingForShot`, and `pausedSteam` /
 * `puffing` → `idle`. Those collapses are lossy; see `docs/states.md`.
 *
 * `errorNoAC` (front power switch off) is reported as `idle` + `errorNoAC` and
 * is the only error substate the skin acts on today (see `isHeaterOff`); the
 * rest are modelled so a fault arrives as a known value rather than an
 * unmodelled string.
 */
export type MachineSubstate =
  | 'idle'
  | 'preparingForShot'
  | 'preinfusion'
  | 'pouring'
  | 'pouringDone'
  | 'cleaningStart'
  | 'cleaningGroup'
  | 'cleanSoaking'
  | 'cleaningSteam'
  | 'errorNaN'
  | 'errorInf'
  | 'errorGeneric'
  | 'errorAcc'
  | 'errorTSensor'
  | 'errorPSensor'
  | 'errorWLevel'
  | 'errorDip'
  | 'errorAssertion'
  | 'errorUnsafe'
  | 'errorInvalidParam'
  | 'errorFlash'
  | 'errorOOM'
  | 'errorDeadline'
  | 'errorHiCurrent'
  | 'errorLoCurrent'
  | 'errorBootFill'
  | 'errorNoAC';

export interface MachineSnapshot {
  timestamp: string;
  state: { state: MachineState; substate: MachineSubstate };
  flow: number;
  pressure: number;
  targetFlow: number;
  targetPressure: number;
  mixTemperature: number;
  groupTemperature: number;
  targetMixTemperature: number;
  targetGroupTemperature: number;
  profileFrame: number;
  steamTemperature: number;
}

export interface ScaleSnapshot {
  timestamp: string;
  weight: number;
  /**
   * Scale-derived flow in g/s (rate of mass accumulation in the cup),
   * smoothed by reaprime's `FlowCalculator` over a ~600 ms window. Distinct
   * from `MachineSnapshot.flow` (mL/s, sensed at the group head) — see
   * `weight flow` in the live brew chart.
   */
  weightFlow: number;
  batteryLevel: number;
}

export interface ScaleStatusFrame {
  status: 'connected' | 'disconnected';
}

export type ScaleMessage = ScaleSnapshot | ScaleStatusFrame;

export function isScaleStatusFrame(m: ScaleMessage): m is ScaleStatusFrame {
  return (m as ScaleStatusFrame).status !== undefined;
}

/**
 * True when the machine is still warming up and isn't ready to brew/steam —
 * `state === 'booting'`, or the boiler climbing to target (`idle` +
 * `preparingForShot`, the collapsed warm-up substate; see
 * [[starter-skin-de1-substate-leak]]).
 *
 * Thin wrapper over `deriveActivity` so the `(state, substate)` → meaning
 * mapping lives in exactly one place (`machineActivity.ts`).
 */
export function isWarmingUp(snap: MachineSnapshot | null): boolean {
  const a = deriveActivity(snap);
  return a.kind === 'warmingUp' || a.kind === 'booting';
}

/**
 * True when the DE1's brew heater isn't powered — typically the front physical
 * switch is off (reported as `idle` + `errorNoAC`). Distinct from
 * `isWarmingUp` ("heater on and climbing"); this is "flip a switch."
 *
 * Thin wrapper over `deriveActivity` (single source of truth).
 */
export function isHeaterOff(snap: MachineSnapshot | null): boolean {
  return deriveActivity(snap).kind === 'heaterOff';
}

/**
 * Real-time shot settings frame from `ws/v1/machine/shotSettings`. The DE1 has
 * no GET for shotSettings — this stream is the canonical source of truth.
 * `steamSetting` is an integer power level; we treat 0 as "off" for the UI toggle.
 */
export interface ShotSettingsSnapshot {
  steamSetting: number;
  targetSteamTemp: number;
  targetSteamDuration: number;
  targetHotWaterTemp: number;
  targetHotWaterVolume: number;
  targetHotWaterDuration: number;
  targetShotVolume: number;
  groupTemp: number;
}

/**
 * Real-time water-level frame from `ws/v1/machine/waterLevels`. `currentLevel`
 * is reported in millimetres of water height in the tank, not a percentage.
 */
export interface WaterLevelsSnapshot {
  currentLevel: number;
  refillLevel: number;
}
