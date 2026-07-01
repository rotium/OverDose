import type { MachineState, MachineSubstate } from './snapshot';
import type { ShotSettingsSnapshot } from './snapshot';
import { gatewayHttpOrigin } from './gateway';
import { log } from './debugLog';

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
 * Gateway build identity from `GET /api/v1/info` — the reaprime gateway's own
 * version/commit, distinct from OverDose's (`buildInfo.ts`) and the machine's
 * firmware (`MachineInfo`). `localIp` is the gateway's LAN address (empty when
 * unavailable), exposed for phone hand-off / QR use.
 */
export interface GatewayInfo {
  commit: string;
  commitShort: string;
  branch: string;
  buildTime: string;
  version: string;
  buildNumber: string;
  appStore: boolean;
  fullVersion: string;
  localIp: string;
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
    /** Per-sample setpoints (what the profile asked for), for the dashed
     *  target overlays on the shot chart. Optional: absent on older records. */
    targetFlow?: number;
    targetPressure?: number;
    targetMixTemperature?: number;
    /** Active profile-step index at this sample. The gateway persists it
     *  per sample; we use it to window volume by step (counted volume).
     *  Optional: absent on older records and on the optimistic in-memory
     *  record when its frames weren't captured. */
    profileFrame?: number;
    /** Machine state/substate at this sample. Used to exclude the post-stop
     *  pump ramp-down from counted volume (only `pouring`/`preinfusion`
     *  count). Optional: absent on older records / the optimistic record. */
    state?: { state?: MachineState; substate?: MachineSubstate };
  };
  scale?: { weight: number; weightFlow?: number };
  volume?: number | null;
}

export interface GatewayShotRecord extends GatewayShotSummary {
  measurements: GatewayShotMeasurement[];
}

/** A page of shot summaries from `GET /api/v1/shots` (no measurements). */
export interface GatewayShotsPage {
  items: GatewayShotSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Query for the paginated shots list. The gateway sorts by `timestamp` only;
 * the name-based filters (`coffeeName`/`profileTitle`/`grinderModel`) and the
 * free-text `search` are what OverDose's history filters map onto — no UUID
 * resolution needed. Omitted fields are left unset (no filter).
 */
export interface ShotListParams {
  limit?: number;
  offset?: number;
  search?: string;
  coffeeName?: string;
  coffeeRoaster?: string;
  profileTitle?: string;
  grinderModel?: string;
  order?: 'asc' | 'desc';
}

/**
 * Workflow context as the gateway returns it from `GET /api/v1/workflow`.
 * Mirrors reaprime's `WorkflowContext`; we type only what the live brew UI
 * actually reads. `targetYield` is the value `ShotSequencer` watches to
 * auto-stop the shot — for our progress bar, it's the canonical source.
 */
export interface WorkflowContextSnapshot {
  coffeeName?: string;
  coffeeRoaster?: string;
  grinderModel?: string;
  grinderSetting?: number;
  targetDoseWeight?: number;
  /** Final-stop weight in grams. 0 (or missing) means no auto-stop. */
  targetYield?: number;
  /** Who the beverage is for (free text). */
  drinkerName?: string;
  /** Free-form bag; OverDose stashes the live `beanId` here. */
  extras?: Record<string, unknown> | null;
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
  /** "espresso" | "filter" | … — used as the row's brew label for ad-hoc
   *  shots that have no recipe/profile title. */
  beverage_type?: string;
  steps?: ProfileStepSnapshot[];
  /** Volume stop target (mL) baked into the profile. Surfaced on the
   *  post-brew summary as the target alongside the actual dispensed
   *  volume. May be absent on older payloads. */
  target_volume?: number;
  /** Step index from which volume counting starts (excludes pre-infusion
   *  from the volume figure). Drives the "counted volume" readout. */
  target_volume_count_start?: number;
}

/** Gateway's current workflow envelope. */
export interface WorkflowSnapshot {
  name?: string;
  description?: string;
  context?: WorkflowContextSnapshot;
  profile?: ProfileSnapshot;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  const t0 = performance.now();
  const res = await fetch(`${gatewayHttpOrigin()}${path}`, init);
  log.debug('api', `${method} ${path} → ${res.status} (${Math.round(performance.now() - t0)}ms)`);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchEmpty(path: string, init?: RequestInit): Promise<void> {
  const method = init?.method ?? 'GET';
  const t0 = performance.now();
  const res = await fetch(`${gatewayHttpOrigin()}${path}`, init);
  log.debug('api', `${method} ${path} → ${res.status} (${Math.round(performance.now() - t0)}ms)`);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
}

/** The gateway KV store namespace OverDose owns. See docs/storage-sync.md. */
const STORE_NAMESPACE = 'overdose';

/** GET a KV-store value, resolving to null on 404 (key absent) or empty body. */
async function fetchStore<T>(key: string): Promise<T | null> {
  const t0 = performance.now();
  const res = await fetch(
    `${gatewayHttpOrigin()}/api/v1/store/${STORE_NAMESPACE}/${encodeURIComponent(key)}`,
  );
  log.debug('api', `GET store/${key} → ${res.status} (${Math.round(performance.now() - t0)}ms)`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET store/${key} → ${res.status}`);
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

export const api = {
  devices: () => fetchJson<Device[]>('/api/v1/devices'),
  machineInfo: () => fetchJson<MachineInfo>('/api/v1/machine/info'),

  /** Gateway build identity (version / commit / build time / LAN IP). */
  gatewayInfo: () => fetchJson<GatewayInfo>('/api/v1/info'),

  /**
   * The gateway's captured WebView console log — i.e. this skin's `console.*`
   * output, which the InAppWebView host tees into `webview_console.log`.
   * Plain text, newest entries first; the whole file (up to ~1 MB of the
   * current gateway session). Only meaningful on a real gateway: in dev the
   * skin runs in a browser, not the gateway's WebView, so there's nothing to
   * capture. See docs and the `debugLog` module.
   */
  webviewLogs: async (): Promise<string> => {
    const res = await fetch(`${gatewayHttpOrigin()}/api/v1/webview/logs`);
    if (!res.ok) throw new Error(`GET /api/v1/webview/logs → ${res.status}`);
    return res.text();
  },

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
    log.debug('cmd', `→ requestState(${state})`);
    return fetchEmpty(`/api/v1/machine/state/${encodeURIComponent(state)}`, {
      method: 'PUT',
    }).then(
      () => log.debug('cmd', `✓ requestState(${state}) acked`),
      (e) => {
        log.error('cmd', `✗ requestState(${state}) failed`, e);
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

  /**
   * Paginated shot history (`GET /api/v1/shots`). Summaries only (no
   * measurements) so a page stays light. Sorted by timestamp; `order`
   * defaults to newest-first. Filters map straight to query params.
   */
  shotsList: (params: ShotListParams = {}) => {
    const q = new URLSearchParams();
    q.set('limit', String(params.limit ?? 20));
    q.set('offset', String(params.offset ?? 0));
    q.set('order', params.order ?? 'desc');
    if (params.search) q.set('search', params.search);
    if (params.coffeeName) q.set('coffeeName', params.coffeeName);
    if (params.coffeeRoaster) q.set('coffeeRoaster', params.coffeeRoaster);
    if (params.profileTitle) q.set('profileTitle', params.profileTitle);
    if (params.grinderModel) q.set('grinderModel', params.grinderModel);
    return fetchJson<GatewayShotsPage>(`/api/v1/shots?${q.toString()}`);
  },

  /** Distinct drinker names from recent shots — for the "For" field's
   *  autocomplete. Light (summaries only); resolves to [] on failure. */
  recentDrinkers: async (): Promise<string[]> => {
    try {
      const page = await api.shotsList({ limit: 100 });
      const names = page.items
        .map((s) => s.workflow?.context?.drinkerName?.trim())
        .filter((n): n is string => !!n);
      return [...new Set(names)].sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  },

  /** Permanently delete a recorded shot (`DELETE /api/v1/shots/{id}`). */
  deleteShot: (id: string) =>
    fetchEmpty(`/api/v1/shots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

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
   * Partial shot update — deep-merged by the gateway. Beyond annotations this
   * can also patch `workflow.context` (coffee/bean/grind), which the
   * shots-history detail uses to re-associate a bean or fix the grind on a
   * recorded shot. Other context/measurement fields are preserved.
   */
  updateShot: (id: string, patch: ShotPatch) =>
    fetchEmpty(`/api/v1/shots/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
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

  /** Permanently delete a bean (and its batches, gateway-side). Irreversible
   *  — the UI keeps Archive as the reversible default. Past shots keep their
   *  denormalized coffeeName/coffeeRoaster so they still read; only the
   *  extras.beanId live-resolve goes stale. */
  deleteBean: (id: string) =>
    fetchEmpty(`/api/v1/beans/${encodeURIComponent(id)}`, {
      method: 'DELETE',
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
  /** Who the beverage is for. `null` clears. */
  drinkerName?: string | null;
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

/** Partial body for `PUT /api/v1/shots/{id}` (deep-merged by the gateway). */
export interface ShotPatch {
  annotations?: ShotAnnotationsPatch;
  workflow?: WorkflowUpdate;
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
  /** Step index (0-based) from which volume counting starts toward
   *  `target_volume` — lets a profile exclude pre-infusion water from the
   *  volume stop. Only meaningful on the no-scale volume-stop path. */
  target_volume_count_start?: number;
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
