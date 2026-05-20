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
  batteryLevel: number;
}

export interface ScaleStatusFrame {
  status: 'connected' | 'disconnected';
}

export type ScaleMessage = ScaleSnapshot | ScaleStatusFrame;

export function isScaleStatusFrame(m: ScaleMessage): m is ScaleStatusFrame {
  return (m as ScaleStatusFrame).status !== undefined;
}
