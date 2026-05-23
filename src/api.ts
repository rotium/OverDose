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
  /**
   * Full workflow envelope captured at shot start. Same shape as the live
   * `/workflow` payload — reaprime persists this verbatim with each shot
   * so the historical record carries profile, context, and recipe name.
   */
  workflow?: WorkflowSnapshot;
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
  scale?: { weight: number; weightFlow?: number };
  volume?: number | null;
}

export interface GatewayShotRecord extends GatewayShotSummary {
  measurements: GatewayShotMeasurement[];
}

/**
 * Workflow context as the gateway returns it from `GET /api/v1/workflow`.
 * Mirrors reaprime's `WorkflowContext`; we type only what the live brew UI
 * actually reads. `targetYield` is the value `ShotSequencer` watches to
 * auto-stop the shot — for our progress bar, it's the canonical source.
 */
export interface WorkflowContextSnapshot {
  coffeeName?: string;
  grinderModel?: string;
  grinderSetting?: number;
  targetDoseWeight?: number;
  /** Final-stop weight in grams. 0 (or missing) means no auto-stop. */
  targetYield?: number;
}

/**
 * Profile step — name for the live view, plus seconds so we can compute the
 * profile's natural-end time (sum across steps) as the time-based auto-stop
 * trigger for the STOP-button progress fill.
 */
export interface ProfileStepSnapshot {
  name: string;
  /** Step duration in seconds. Summed across steps to estimate the
   *  profile's natural end-of-shot time. May be absent on older payloads. */
  seconds?: number;
}

/** Profile envelope from the current workflow. */
export interface ProfileSnapshot {
  title: string;
  steps?: ProfileStepSnapshot[];
}

/** Gateway's current workflow envelope. */
export interface WorkflowSnapshot {
  name?: string;
  description?: string;
  context?: WorkflowContextSnapshot;
  profile?: ProfileSnapshot;
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

  /**
   * Current workflow context — used by the live brew drawer to read the
   * weight target (`context.targetYield`) so it can render a progress bar.
   * Snapshotted once when the drawer opens; the WS streams don't expose it.
   */
  workflow: () => fetchJson<WorkflowSnapshot>('/api/v1/workflow'),
};
