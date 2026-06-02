import type { MachineState } from './snapshot';
import type { ShotSettingsSnapshot } from './snapshot';
import { gatewayHttpOrigin } from './gateway';
import { dlog } from './debugLog';

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
    /** 0–100 enjoyment rating (de1app's `espresso_enjoyment` scale). */
    enjoyment?: number | null;
    espressoNotes?: string | null;
  };
}

/**
 * Partial post-shot annotations written back via `PUT /api/v1/shots/{id}`.
 * The gateway deep-merges this onto the stored record's `annotations`, so
 * only the included fields change — omit a field to leave it untouched.
 */
export interface ShotAnnotationsPatch {
  enjoyment?: number;
  espressoNotes?: string;
  actualDoseWeight?: number;
  actualYield?: number;
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
  /** Volume stop target (mL) baked into the profile. Surfaced on the
   *  post-brew summary as the target alongside the actual dispensed
   *  volume. May be absent on older payloads. */
  target_volume?: number;
}

/** Gateway's current workflow envelope. */
export interface WorkflowSnapshot {
  name?: string;
  description?: string;
  context?: WorkflowContextSnapshot;
  profile?: ProfileSnapshot;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${gatewayHttpOrigin()}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchEmpty(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${gatewayHttpOrigin()}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
}

/** The gateway KV store namespace OverDose owns. See docs/storage-sync.md. */
const STORE_NAMESPACE = 'overdose';

/** GET a KV-store value, resolving to null on 404 (key absent) or empty body. */
async function fetchStore<T>(key: string): Promise<T | null> {
  const res = await fetch(
    `${gatewayHttpOrigin()}/api/v1/store/${STORE_NAMESPACE}/${encodeURIComponent(key)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET store/${key} → ${res.status}`);
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

export const api = {
  devices: () => fetchJson<Device[]>('/api/v1/devices'),
  machineInfo: () => fetchJson<MachineInfo>('/api/v1/machine/info'),

  /** Read a value from the gateway KV store (namespace `overdose`). Resolves
   *  to null when the key doesn't exist. Backs the library sync — see
   *  docs/storage-sync.md and src/librarySync.ts. */
  storeGet: <T>(key: string): Promise<T | null> => fetchStore<T>(key),
  /** Write a JSON value to the gateway KV store (namespace `overdose`). */
  storeSet: (key: string, value: unknown): Promise<void> =>
    fetchEmpty(`/api/v1/store/${STORE_NAMESPACE}/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }),

  requestState: (state: MachineState) => {
    // Log every outgoing state command so a steam/purge trace can tell apart
    // "we asked for idle and the firmware purged" from "it purged/parked on
    // its own" (no preceding cmd line) — the crux of the steam-stuck bug.
    dlog('cmd', `→ requestState(${state})`);
    return fetchEmpty(`/api/v1/machine/state/${encodeURIComponent(state)}`, {
      method: 'PUT',
    }).then(
      () => dlog('cmd', `✓ requestState(${state}) acked`),
      (e) => {
        dlog('cmd', `✗ requestState(${state}) failed: ${e}`);
        throw e;
      },
    );
  },
  sleep: () => api.requestState('sleeping'),

  /**
   * Set screen brightness 0–100 (100 = OS-managed / auto-brightness). Drives
   * the gateway's display brightness; no-ops server-side on platforms without
   * brightness control. Used to actually darken the panel on sleep — see
   * SleepOverlay + App's screen-off effect.
   */
  setBrightness: (brightness: number) =>
    fetchEmpty('/api/v1/display/brightness', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightness }),
    }),

  /**
   * Set the machine's water refill threshold (mm) — the level at which the DE1
   * considers the tank critically low. This is the single source of truth for
   * "critical water": the skin reads it from the waterLevels stream and writes
   * it here. The gateway only reads `refillLevel` from the body.
   */
  setRefillLevel: (refillLevel: number) =>
    fetchEmpty('/api/v1/machine/waterLevels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refillLevel }),
    }),

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
   * Write post-shot annotations (rating, notes, corrected dose) back to a
   * recorded shot. Sent as a partial `{ annotations }` body — the gateway
   * deep-merges, preserving annotation fields not included here.
   */
  updateShotAnnotations: (id: string, annotations: ShotAnnotationsPatch) =>
    fetchEmpty(`/api/v1/shots/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations }),
    }),

  /**
   * Current workflow context — used by the live brew drawer to read the
   * weight target (`context.targetYield`) so it can render a progress bar.
   * Snapshotted once when the drawer opens; the WS streams don't expose it.
   */
  workflow: () => fetchJson<WorkflowSnapshot>('/api/v1/workflow'),

  /**
   * Machine-level settings (the firmware MMR values: steam flow, fan, USB,
   * flush flow/temp/timeout, hot water flow, tank temp, steam purge mode).
   * These live on a different endpoint from `shotSettings` — they're
   * persisted in the DE1's firmware register, not per-shot.
   *
   * The POST handler accepts sparse JSON: any key present is applied, the
   * rest are left alone. So `updateMachineSettings({ steamFlow: 1.6 })` is
   * the right shape for a single-knob change. No GET required first.
   */
  machineSettings: () =>
    fetchJson<MachineSettingsSnapshot>('/api/v1/machine/settings'),
  updateMachineSettings: (partial: Partial<MachineSettingsSnapshot>) =>
    fetchEmpty('/api/v1/machine/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    }),

  /**
   * List profile records from the gateway. Defaults to `visibility=visible`
   * — hidden / soft-deleted profiles are kept on the gateway but not
   * surfaced to the picker. The library view will eventually offer a
   * "show hidden" toggle (Phase B), but v1 only browses the visible set.
   */
  profiles: (params: { visibility?: ProfileVisibility } = {}) => {
    const v = params.visibility ?? 'visible';
    return fetchJson<ProfileRecord[]>(
      `/api/v1/profiles?visibility=${encodeURIComponent(v)}`,
    );
  },

  /** Get a single profile record by id (the content-based hash). */
  profileById: (id: string) =>
    fetchJson<ProfileRecord>(
      `/api/v1/profiles/${encodeURIComponent(id)}`,
    ),

  /**
   * Update the current workflow (`PUT /api/v1/workflow`). The gateway
   * deep-merges the partial body into the current workflow and uploads
   * the profile to the machine if it changed (see reaprime
   * `workflow_handler.dart`). This is the recommended way to load a
   * profile + shot context for brewing — it keeps the persisted workflow
   * (and thus the shot record + live UI) in sync, unlike POST
   * /machine/profile which only touches the firmware.
   *
   * Send a partial: omitted top-level keys and omitted context fields are
   * preserved by the deep-merge. Send `null` in a context field to
   * explicitly clear it.
   */
  setWorkflow: (body: WorkflowUpdate) =>
    fetchEmpty('/api/v1/workflow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /**
   * List coffee beans from the gateway's BeanStorageService. Beans are
   * gateway-owned (like profiles), not part of OverDose's local library —
   * they're a shared resource the gateway models first-class and other
   * clients (e.g. the DYE2 plugin) also manage. `includeArchived` defaults
   * to false; archived beans are soft-deleted and hidden by default.
   */
  beans: (params: { includeArchived?: boolean } = {}) =>
    fetchJson<Bean[]>(
      `/api/v1/beans?includeArchived=${params.includeArchived ? 'true' : 'false'}`,
    ),

  /** Get a single bean by id (UUID). Rejects with 404 if it's gone. */
  beanById: (id: string) =>
    fetchJson<Bean>(`/api/v1/beans/${encodeURIComponent(id)}`),

  /**
   * Create a bean. Only `roaster` + `name` are required; the gateway assigns
   * the id and timestamps and returns the full record (we need the id to open
   * the editor on it).
   */
  createBean: (input: BeanCreate) =>
    fetchJson<Bean>('/api/v1/beans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  /**
   * Update a bean. The gateway PUT is sparse — send only the changed fields.
   * Archiving is just `{ archived: true }` (soft-delete; preferred over hard
   * DELETE so shot history keeps resolving the bean).
   */
  updateBean: (id: string, patch: BeanPatch) =>
    fetchEmpty(`/api/v1/beans/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
};

/**
 * Subset of the gateway's `WorkflowContext` we set from a Recipe/draft.
 * `null` explicitly clears a field; omitting it preserves the gateway's
 * existing value (deep-merge). Grinder setting is a string on the gateway.
 */
export interface WorkflowContextUpdate {
  targetDoseWeight?: number | null;
  targetYield?: number | null;
  grinderSetting?: string | null;
  /** Denormalized coffee display strings stamped onto the shot. Write the
   *  whole coffee trio (name + roaster + extras.beanId) together from one
   *  resolved bean — see the bean shot-binding rule. `null` clears. */
  coffeeName?: string | null;
  coffeeRoaster?: string | null;
  /** Free-form context bag. OverDose stashes `beanId` here so its own shot
   *  history can resolve the live bean (rename-safe), since the gateway has
   *  no beanId field on WorkflowContext (only beanBatchId). */
  extras?: Record<string, unknown> | null;
}

/** Partial workflow body for `PUT /api/v1/workflow`. */
export interface WorkflowUpdate {
  name?: string;
  profile?: Profile;
  context?: WorkflowContextUpdate;
}

/**
 * Shape returned by `GET /api/v1/machine/settings` (see `de1handler.dart`).
 * All fields are optional on POST — a sparse partial is the supported
 * mutation pattern. Typed as required on GET because the gateway always
 * returns every key.
 */
/**
 * Profile, mirrored from reaprime's `/api/v1/profiles` schema. The gateway
 * is authoritative for profile storage (Hive-backed); the skin only
 * consumes records here. Fields beyond what the UI renders are kept loose
 * to avoid coupling to the full v2 profile spec (Jeff Kletsky / DE1).
 *
 * See reaprime/assets/api/rest_v1.yml#/components/schemas/Profile and
 * .../ProfileRecord — and reaprime/doc/Profiles.md for the architecture.
 */
export interface Profile {
  /** Display title — what the user picks by. Always present in practice. */
  title?: string;
  author?: string;
  notes?: string;
  /** "espresso" / "pourover" / "cleaning". For DE1 the picker is effectively
   *  espresso-only, so we don't filter; surface it as a chip when non-empty. */
  beverage_type?: string;
  /** Target weight in grams (Recipe metadata overrides this at brew time). */
  target_weight?: number;
  /** Target volume in mL. */
  target_volume?: number;
  /** Group-head water tank target temp in °C. */
  tank_temperature?: number;
  /** Profile step list. Each step is an opaque object in the spec; we
   *  only count + iterate for the curve preview (deferred). */
  steps?: unknown[];
  /** v2 spec version string. */
  version?: string;
}

export type ProfileVisibility = 'visible' | 'hidden' | 'deleted';

/** Envelope around `Profile` with gateway-managed metadata. */
export interface ProfileRecord {
  /** Content-based hash. Stable across devices for identical profile content. */
  id: string;
  profile: Profile;
  metadataHash: string;
  compoundHash: string;
  parentId?: string | null;
  visibility: ProfileVisibility;
  /** True for bundled defaults — UI surfaces a badge and we never allow
   *  hard-delete (the gateway already enforces this; the badge is just a
   *  cue so the user understands why "Delete" might not apply). */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Coffee bean, mirrored from reaprime's `/api/v1/beans` schema
 * (BeanStorageService, SQLite-backed). The gateway is authoritative; OverDose
 * reads and writes records here rather than keeping a local copy. A `Bean` is
 * the durable *identity* (roaster + name + origin metadata); quantity and
 * freshness live on its `BeanBatch`es (deferred — v1 is Bean-level only).
 *
 * See reaprime/assets/api/rest_v1.yml#/components/schemas/Bean.
 */
export interface Bean {
  id: string;
  roaster: string;
  name: string;
  species?: string | null;
  decaf: boolean;
  decafProcess?: string | null;
  country?: string | null;
  region?: string | null;
  producer?: string | null;
  variety?: string[] | null;
  /** Altitude range `[min, max]` in metres. */
  altitude?: number[] | null;
  processing?: string | null;
  notes?: string | null;
  /** Soft-delete. Archived beans stay on the gateway (and keep resolving for
   *  historical shots) but are hidden from the default list. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  extras?: Record<string, unknown> | null;
}

/** POST body — only roaster + name are required; the gateway fills the rest. */
export interface BeanCreate {
  roaster: string;
  name: string;
}

/**
 * PUT body — sparse: include only the fields to change (the gateway
 * deep-merges). `id`/`createdAt`/`updatedAt` are gateway-owned and omitted.
 */
export type BeanPatch = Partial<Omit<Bean, 'id' | 'createdAt' | 'updatedAt'>>;

export interface MachineSettingsSnapshot {
  fan: number;
  usb: 'enable' | 'disable';
  flushTemp: number;
  flushTimeout: number;
  flushFlow: number;
  hotWaterFlow: number;
  /** Target steam flow in mL/s. Decent.app's slider exposes 0.4-2.0. */
  steamFlow: number;
  tankTemp: number;
  /** 0 = normal, 1 = two-tap stop (per mock_de1.dart:469). */
  steamPurgeMode: number;
}
