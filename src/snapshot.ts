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
  | 'cleaningSteam';

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
