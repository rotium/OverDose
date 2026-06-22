import { describe, expect, it } from 'vitest';
import { isSteamOn, steamReassertShot, STEAM_ON_MIN_C } from './steam';
import type { ShotSettingsSnapshot } from './snapshot';

const shot = (targetSteamTemp: number): ShotSettingsSnapshot => ({
  steamSetting: 0,
  targetSteamTemp,
  targetSteamDuration: 30,
  targetHotWaterTemp: 95,
  targetHotWaterVolume: 120,
  targetHotWaterDuration: 30,
  targetShotVolume: 36,
  groupTemp: 92,
});

describe('isSteamOn', () => {
  it('is on at/above the threshold, off below', () => {
    expect(isSteamOn(shot(STEAM_ON_MIN_C))).toBe(true);
    expect(isSteamOn(shot(150))).toBe(true);
    expect(isSteamOn(shot(0))).toBe(false);
    expect(isSteamOn(shot(STEAM_ON_MIN_C - 1))).toBe(false);
    expect(isSteamOn(null)).toBe(false);
  });
});

describe('steamReassertShot', () => {
  it('re-pushes the desired when idle, steam is on, and the machine drifted', () => {
    // External app set 140; skin wants 170 → push 170 (machine follows skin).
    expect(steamReassertShot(shot(140), 170, true)).toEqual(shot(170));
  });

  it('does nothing when already in sync', () => {
    expect(steamReassertShot(shot(170), 170, true)).toBeNull();
  });

  it('never enables steam when off (no unexpected heat-up)', () => {
    expect(steamReassertShot(shot(0), 170, true)).toBeNull();
  });

  it('does nothing when the machine is not idle (never interrupts a live op)', () => {
    // Drifted + on, but mid-operation → leave it alone.
    expect(steamReassertShot(shot(140), 170, false)).toBeNull();
  });

  it('returns null without a current snapshot', () => {
    expect(steamReassertShot(null, 170, true)).toBeNull();
  });
});
