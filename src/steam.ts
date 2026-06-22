import type { ShotSettingsSnapshot } from './snapshot';

/**
 * Steam on/off on the DE1 is the steam *target temperature*, not a flag: the
 * boiler heats when `targetSteamTemp >= STEAM_ON_MIN_C` and is off at 0. OverDose
 * owns the *desired* temp (a pref) and pushes it to enable; the machine value is
 * only read back for the on/off state.
 */
export const STEAM_ON_MIN_C = 130;

/** Is the steam boiler enabled on the machine (per the current shot settings)? */
export const isSteamOn = (s: ShotSettingsSnapshot | null): boolean =>
  (s?.targetSteamTemp ?? 0) >= STEAM_ON_MIN_C;

/**
 * The ShotSettings body to re-assert the skin's desired steam temp on the
 * machine, or `null` when no write is needed. Used when the app comes back on
 * screen so the machine follows the skin's value after an external change.
 * Conditions (all must hold, else no write):
 *  - the machine is idle — never interrupt a live steam/espresso/water/flush;
 *  - steam is already on (off stays off — never enables steam by itself);
 *  - the machine's temp actually differs from the desired (cheap no-op when in
 *    sync — avoids needless BLE writes).
 */
export const steamReassertShot = (
  current: ShotSettingsSnapshot | null,
  desired: number,
  machineIdle: boolean,
): ShotSettingsSnapshot | null => {
  if (!machineIdle) return null; // don't touch the machine mid-operation
  if (!current) return null;
  if (current.targetSteamTemp < STEAM_ON_MIN_C) return null; // off — leave it
  if (current.targetSteamTemp === desired) return null; // already in sync
  return { ...current, targetSteamTemp: desired };
};
