export type MachineState =
  | 'idle'
  | 'booting'
  | 'sleeping'
  | 'heating'
  | 'preheating'
  | 'espresso'
  | 'hotWater'
  | 'flush'
  | 'steam'
  | 'steamRinse'
  | 'cleaning'
  | 'descaling'
  | 'airPurge'
  | 'needsWater'
  | 'error';

export type MachineSubstate =
  | 'idle'
  | 'preparingForShot'
  | 'preinfusion'
  | 'pouring'
  | 'pouringDone'
  | 'cleaningStart'
  | 'cleaingGroup'
  | 'cleanSoaking'
  | 'cleaningSteam'
  /** Heater isn't getting AC — happens when the DE1's front power switch
   *  is in the off position. Firmware state stays at `idle`; only the
   *  substate flips. The only "real" error substate we model right now.
   *  Reaprime exposes 17 other error substates (errorNaN, errorTSensor,
   *  …) that we currently leave unmodelled — TypeScript will reject any
   *  snapshot carrying one until they're added. */
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
 * True when the machine is still warming up and isn't ready to brew/steam.
 * Covers two cases:
 *   - `state === 'booting'` — right after a hard power-on, before firmware
 *     comes up.
 *   - `state === 'idle' && substate === 'preparingForShot'` — boiler is
 *     climbing to target. The DE1 firmware emits `heatWaterTank` /
 *     `heatWaterHeater` / `stabilizeMixTemp` substates during any heater
 *     cycle, and reaprime collapses all three into `preparingForShot` (see
 *     [[starter-skin-de1-substate-leak]]). When the boiler reaches target
 *     and substate transitions back to `idle`, the machine is ready.
 */
export function isWarmingUp(snap: MachineSnapshot | null): boolean {
  if (!snap) return false;
  const { state, substate } = snap.state;
  if (state === 'booting') return true;
  if (state === 'idle' && substate === 'preparingForShot') return true;
  return false;
}

/**
 * True when the DE1's brew heater isn't powered — typically the front
 * physical switch is in the off position. The firmware reports
 * `state=idle, substate=errorNoAC` in this case; nothing else in the
 * protocol exposes the front-switch state directly. Distinct from
 * `isWarmingUp` (which is "wait, heater is on and climbing"); this is
 * "the user has to flip a switch."
 */
export function isHeaterOff(snap: MachineSnapshot | null): boolean {
  if (!snap) return false;
  const { state, substate } = snap.state;
  return state === 'idle' && substate === 'errorNoAC';
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
