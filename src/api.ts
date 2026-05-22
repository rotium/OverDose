import type { MachineState } from './snapshot';
import type { ShotSettingsSnapshot } from './snapshot';

export interface Device {
  name: string;
  id: string;
  state: string;
  type: string;
}

export interface MachineInfo {
  version: string;
  model: string;
  serialNumber: string;
  GHC: boolean;
  extra: Record<string, unknown>;
}

/**
 * Gateway shot-record summary. Mirrors the relevant fields from reaprime's
 * ShotRecordSummary schema — we type only what the UI consumes. The gateway's
 * `workflow` field is reaprime's own Workflow concept (bean/grinder/dose
 * metadata for one shot), NOT starter-skin's Workflow (Pipeline + config).
 * See [[starter-skin-vocabulary]] for the collision rationale.
 */
export interface GatewayShotSummary {
  id: string;
  timestamp: string;
  workflow?: {
    name?: string;
    description?: string;
    context?: {
      coffeeName?: string;
      grinderModel?: string;
      grinderSetting?: number;
      dose?: number;
    };
  };
  annotations?: {
    actualDoseWeight?: number | null;
    actualYield?: number | null;
    espressoNotes?: string | null;
  };
}

export interface GatewayShotMeasurement {
  machine: {
    timestamp: string;
    flow: number;
    pressure: number;
    mixTemperature: number;
    groupTemperature: number;
  };
  scale?: { weight: number };
  volume?: number | null;
}

export interface GatewayShotRecord extends GatewayShotSummary {
  measurements: GatewayShotMeasurement[];
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchEmpty(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
}

export const api = {
  devices: () => fetchJson<Device[]>('/api/v1/devices'),
  machineInfo: () => fetchJson<MachineInfo>('/api/v1/machine/info'),

  requestState: (state: MachineState) =>
    fetchEmpty(`/api/v1/machine/state/${encodeURIComponent(state)}`, {
      method: 'PUT',
    }),
  sleep: () => api.requestState('sleeping'),

  tareScale: () => fetchEmpty('/api/v1/scale/tare', { method: 'PUT' }),

  /**
   * Update shot settings. Reaprime's endpoint is POST and accepts the full
   * ShotSettings body (no PATCH semantics). For partial updates the UI must
   * carry the current snapshot from the WS stream and overlay the change.
   */
  updateShotSettings: (settings: ShotSettingsSnapshot) =>
    fetchEmpty('/api/v1/machine/shotSettings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  /** Latest shot summary (no measurements — fast). */
  shotsLatest: () => fetchJson<GatewayShotSummary>('/api/v1/shots/latest'),

  /** Full shot record including measurements (for the mini chart). */
  shotById: (id: string) =>
    fetchJson<GatewayShotRecord>(`/api/v1/shots/${encodeURIComponent(id)}`),
};
