import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { MachineSnapshot, ShotSettingsSnapshot } from './snapshot';
import type { SteamAutoFlavor, SteamMode } from './prefs';
import { STEAM_ON_MIN_C } from './steam';

/**
 * What the steam prep / Explore-steam reports while a steam intent is open: the
 * temperature it wants (the pitcher's, or the recipe default) and whether a
 * steam context is currently active. The controller treats `active` as the
 * Smart-flavour warm trigger and uses `targetTemp` as the warm target, but it
 * never turns steam on by itself — see the per-mode rules below.
 */
export interface SteamContext {
  active: boolean;
  targetTemp: number | null;
}

export interface SteamControllerDeps {
  /** User steam mode (persisted pref). */
  mode: () => SteamMode;
  /** Global desired "on" temp — the warm target when no steam context is open. */
  desiredTemp: () => number;
  /** Idle/"off" temp Auto falls back to (0 = cold). */
  idleTemp: () => number;
  /** Auto warm-up flavour. */
  flavor: () => SteamAutoFlavor;
  /** Auto-off timeout in minutes. */
  timeoutMin: () => number;
  machine: () => MachineSnapshot | null;
  shotSettings: () => ShotSettingsSnapshot | null;
  /** Writes the full shotSettings body with the controller's target temp. */
  write: (body: ShotSettingsSnapshot) => void;
}

export interface SteamController {
  /** Steam prep reports its open/closed state + warm target here. */
  setSteamContext: (ctx: SteamContext) => void;
  /** Eco-flavour user interaction (a tap) — a warm trigger. */
  noteActivity: () => void;
  /** 'warm' when Auto is heating to the on-temp; 'idle' when cooling/cooled. */
  phase: () => 'warm' | 'idle';
  /** Derived real on/off (machine target ≥ threshold). */
  actualOn: () => boolean;
  /** Intent-based status for the Home steam readout. */
  status: () => SteamStatus;
}

/**
 * What the steam is doing, by intent (not just the raw temperature):
 *  - `off`     — steam mode is Off.
 *  - `heating` — driving to a steam target, not there yet.
 *  - `ready`   — at the steam target (within the readiness band).
 *  - `idle`    — Auto holding at its idle baseline (cooled or warm-hold).
 * `direction` marks where the live temp is heading: `up` warming, `down`
 * cooling, `null` settled.
 */
export interface SteamStatus {
  state: 'off' | 'heating' | 'ready' | 'idle';
  direction: 'up' | 'down' | null;
}

/** Live temp within this fraction of the target reads as "ready" (matches the
 *  steam-prep readiness lock); also the band within which no direction arrow
 *  shows (you're effectively at target). */
const READY_FRACTION = 0.1;
/** For a 0 target (Off / cold idle), 10% is 0, so use an absolute band: the
 *  boiler reads "settled" (no ↓) once at/under this, vs still cooling above. */
const COOLED_BAND_C = 50;

// Machine states that count as "physical usage" (an Eco warm trigger) and, for
// the steam ones, must not be interrupted by a settings write.
const ACTIVE_OPS = new Set<MachineSnapshot['state']['state']>([
  'espresso',
  'flush',
  'hotWater',
  'steam',
  'steamRinse',
]);

/**
 * The single owner of the steam boiler. Every other place (Home toggle,
 * `applySteam`, focus re-assert) becomes an *input* — they set the mode or the
 * steam context, and this controller is the only writer of `targetSteamTemp`.
 *
 * Rules:
 *  - **off** → target 0. A steam context (a recipe's pitcher temp) is recorded
 *    for the prep's display/lock but never turns the heater on.
 *  - **on**  → target = the warm temp (pitcher temp if a steam context is open,
 *    else the global desired) whenever awake.
 *  - **auto** → warm (same warm temp) while a steam context is open or within
 *    the timeout of a warm trigger; otherwise idle (idle temp). Starts idle.
 *    Eco triggers: any user interaction or machine op. Smart triggers: only a
 *    steam context opening. Asleep cools everything (the controller yields).
 *
 * Writes only when awake and not mid-steam (so it can pre-warm during an
 * espresso shot, but never disrupts a live steam).
 */
export const createSteamController = (
  deps: SteamControllerDeps,
): SteamController => {
  const [context, setContext] = createSignal<SteamContext>({
    active: false,
    targetTemp: null,
  });
  // True after a warm trigger, cleared by the idle timer. Combined with an open
  // steam context to decide "warm" in Auto.
  const [recentlyActive, setRecentlyActive] = createSignal(false);

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdleTimer = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };
  const armIdleTimer = () => {
    clearIdleTimer();
    // A held-open steam context keeps it warm with no countdown.
    if (context().active) return;
    const ms = Math.max(1, deps.timeoutMin()) * 60_000;
    idleTimer = setTimeout(() => setRecentlyActive(false), ms);
  };

  // A warm event happened (only meaningful in Auto): mark active + (re)arm the
  // cool-down countdown.
  const trigger = () => {
    if (deps.mode() !== 'auto') return;
    setRecentlyActive(true);
    armIdleTimer();
  };

  const setSteamContext = (ctx: SteamContext) => setContext(ctx);
  const noteActivity = () => {
    if (deps.flavor() === 'eco') trigger();
  };

  // Steam context open/close. Open → held warm (no countdown). Close → start
  // the countdown from now. (setContext replaces the object each call, so guard
  // on the actual active transition.)
  let prevActive = false;
  createEffect(() => {
    const active = context().active;
    if (active === prevActive) return;
    prevActive = active;
    if (deps.mode() !== 'auto') return;
    if (active) {
      setRecentlyActive(true);
      clearIdleTimer();
    } else {
      // Just closed — begin cooling after the timeout.
      trigger();
    }
  });

  // Machine entering an active op is an Eco warm trigger (fires on transition).
  let prevOp = false;
  createEffect(() => {
    const st = deps.machine()?.state.state;
    const op = st !== undefined && ACTIVE_OPS.has(st);
    if (op && !prevOp && deps.flavor() === 'eco') trigger();
    prevOp = op;
  });

  // Entering Auto starts idle; leaving Auto stops the timer.
  createEffect(() => {
    if (deps.mode() === 'auto') {
      setRecentlyActive(false);
      clearIdleTimer();
    } else {
      clearIdleTimer();
    }
  });

  // Sleep cools everything — reset to idle so waking starts cold until activity.
  createEffect(() => {
    if (deps.machine()?.state.state === 'sleeping') {
      setRecentlyActive(false);
      clearIdleTimer();
    }
  });

  // The warm target: a held steam context's temp wins, else the global desired.
  const onTemp = createMemo(() => {
    const c = context();
    return c.active && c.targetTemp != null ? c.targetTemp : deps.desiredTemp();
  });
  const warm = createMemo(() => context().active || recentlyActive());
  const desiredTarget = createMemo<number>(() => {
    switch (deps.mode()) {
      case 'off':
        return 0;
      case 'on':
        return onTemp();
      case 'auto':
        return warm() ? onTemp() : deps.idleTemp();
    }
  });

  // The single write. React to the desired target, the machine *state* (not
  // every snapshot frame), and the shotSettings base (so an external change is
  // re-asserted). Skip while asleep or mid-steam.
  const machineState = createMemo(() => deps.machine()?.state.state);
  createEffect(() => {
    const st = machineState();
    const want = desiredTarget();
    if (st === 'sleeping' || st === 'steam' || st === 'steamRinse') return;
    const cur = deps.shotSettings();
    if (!cur) return;
    if (cur.targetSteamTemp === want) return;
    deps.write({ ...cur, targetSteamTemp: want });
  });

  const phase = (): 'warm' | 'idle' => (warm() ? 'warm' : 'idle');
  const actualOn = (): boolean =>
    (deps.shotSettings()?.targetSteamTemp ?? 0) >= STEAM_ON_MIN_C;

  const status = (): SteamStatus => {
    const live = deps.machine()?.steamTemperature ?? null;
    const target = desiredTarget();
    // No arrow within the band of the target; above/below it, warming/cooling.
    // The band is 10% of the target (matching readiness), or an absolute
    // "cooled" margin for a 0 target.
    const band = target > 0 ? target * READY_FRACTION : COOLED_BAND_C;
    const direction: SteamStatus['direction'] =
      live == null
        ? null
        : live < target - band
          ? 'up'
          : live > target + band
            ? 'down'
            : null;
    if (deps.mode() === 'off') return { state: 'off', direction };
    // Auto resting at its idle baseline — not driving to a steam target.
    if (deps.mode() === 'auto' && phase() === 'idle') {
      return { state: 'idle', direction };
    }
    // On, or Auto warming: the target is a steam temp. One-sided — at or above
    // the target (within the band below) is ready. Steam can't actively cool,
    // so a hotter boiler is usable, not "heating"; it just shows a ↓ as it
    // settles back toward the setpoint.
    const ready =
      live != null && target > 0 && live >= target - target * READY_FRACTION;
    return ready
      ? { state: 'ready', direction }
      : { state: 'heating', direction: direction ?? 'up' };
  };

  onCleanup(clearIdleTimer);

  return { setSteamContext, noteActivity, phase, actualOn, status };
};
