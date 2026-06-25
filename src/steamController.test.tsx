import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { createSteamController, type SteamController } from './steamController';
import type { MachineState, MachineSnapshot, ShotSettingsSnapshot } from './snapshot';
import type { SteamAutoFlavor, SteamMode } from './prefs';

const DESIRED = 150;
const TIMEOUT_MIN = 10;
const TIMEOUT_MS = TIMEOUT_MIN * 60_000;

const mkMachine = (
  state: MachineState,
  steamTemperature = 0,
): MachineSnapshot =>
  ({
    timestamp: 't',
    state: { state, substate: 'idle' },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 0,
    groupTemperature: 0,
    targetMixTemperature: 0,
    targetGroupTemperature: 0,
    profileFrame: 0,
    steamTemperature,
  }) as MachineSnapshot;

const mkShot = (targetSteamTemp: number): ShotSettingsSnapshot => ({
  steamSetting: 0,
  targetSteamTemp,
  targetSteamDuration: 30,
  targetHotWaterTemp: 85,
  targetHotWaterVolume: 100,
  targetHotWaterDuration: 35,
  targetShotVolume: 36,
  groupTemp: 94,
});

interface Init {
  mode?: SteamMode;
  flavor?: SteamAutoFlavor;
  state?: MachineState;
  idleTemp?: number;
  shotTemp?: number;
  /** Live steam-boiler temperature reported by the machine. */
  steamTemp?: number;
}

const setup = (init: Init = {}) => {
  const [mode, setMode] = createSignal<SteamMode>(init.mode ?? 'auto');
  const [flavor, setFlavor] = createSignal<SteamAutoFlavor>(init.flavor ?? 'eco');
  const [state, setState] = createSignal<MachineState>(init.state ?? 'idle');
  const [steamTemp, setSteamTemp] = createSignal<number>(init.steamTemp ?? 0);
  const [shot, setShot] = createSignal<ShotSettingsSnapshot | null>(
    mkShot(init.shotTemp ?? 0),
  );
  // The write mimics the gateway echo: the new target becomes the live value,
  // so the controller's "already in sync" guard holds after a write.
  const write = vi.fn((b: ShotSettingsSnapshot) => setShot(b));
  let ctl!: SteamController;
  const Probe = () => {
    ctl = createSteamController({
      mode,
      flavor,
      desiredTemp: () => DESIRED,
      idleTemp: () => init.idleTemp ?? 0,
      timeoutMin: () => TIMEOUT_MIN,
      machine: () => mkMachine(state(), steamTemp()),
      shotSettings: shot,
      write,
    });
    return null;
  };
  render(() => <Probe />);
  const target = () => shot()!.targetSteamTemp;
  return {
    ctl: () => ctl,
    setMode,
    setFlavor,
    setState,
    setShot,
    setSteamTemp,
    write,
    target,
  };
};

describe('createSteamController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('off', () => {
    it('forces the target to 0 and a steam context never turns it on', () => {
      const h = setup({ mode: 'off', shotTemp: 150 });
      expect(h.target()).toBe(0); // cooled from 150 → 0
      h.ctl().setSteamContext({ active: true, targetTemp: 165 });
      expect(h.target()).toBe(0); // pushing a temp does not enable steam
    });
  });

  describe('on', () => {
    it('holds the desired temp, and warms to the pitcher temp while a context is open', () => {
      const h = setup({ mode: 'on', shotTemp: 0 });
      expect(h.target()).toBe(DESIRED);
      h.ctl().setSteamContext({ active: true, targetTemp: 165 });
      expect(h.target()).toBe(165);
      h.ctl().setSteamContext({ active: false, targetTemp: null });
      expect(h.target()).toBe(DESIRED);
    });

    it('re-asserts the desired temp after an external change', () => {
      const h = setup({ mode: 'on', shotTemp: DESIRED });
      expect(h.write).not.toHaveBeenCalled(); // already in sync
      h.setShot(mkShot(160)); // external skin changed it
      expect(h.target()).toBe(DESIRED); // re-asserted
    });
  });

  describe('auto — common', () => {
    it('starts idle (idle temp) when entering Auto', () => {
      const h = setup({ mode: 'on', shotTemp: 0 });
      expect(h.target()).toBe(DESIRED);
      h.setMode('auto');
      expect(h.target()).toBe(0); // idle temp (default 0)
    });

    it('holds a warm idle temp when configured', () => {
      const h = setup({ mode: 'auto', idleTemp: 135, shotTemp: 0 });
      expect(h.target()).toBe(135);
    });

    it('does not write while asleep, then settles on wake', () => {
      const h = setup({ mode: 'on', state: 'sleeping', shotTemp: 0 });
      expect(h.write).not.toHaveBeenCalled();
      h.setState('idle');
      expect(h.target()).toBe(DESIRED);
    });

    it('does not write during an active steam op', () => {
      const h = setup({ mode: 'on', state: 'steam', shotTemp: 0 });
      expect(h.write).not.toHaveBeenCalled();
      h.setState('idle');
      expect(h.target()).toBe(DESIRED);
    });
  });

  describe('auto — Eco', () => {
    it('warms on user interaction, then cools after the timeout', () => {
      const h = setup({ mode: 'auto', flavor: 'eco', shotTemp: 0 });
      expect(h.target()).toBe(0);
      h.ctl().noteActivity();
      expect(h.target()).toBe(DESIRED);
      vi.advanceTimersByTime(TIMEOUT_MS);
      expect(h.target()).toBe(0); // idle again
    });

    it('warms on a machine op (e.g. brewing espresso pre-warms steam)', () => {
      const h = setup({ mode: 'auto', flavor: 'eco', shotTemp: 0 });
      h.setState('espresso');
      expect(h.target()).toBe(DESIRED);
    });
  });

  describe('auto — Smart', () => {
    it('ignores plain interaction', () => {
      const h = setup({ mode: 'auto', flavor: 'smart', shotTemp: 0 });
      h.ctl().noteActivity();
      expect(h.target()).toBe(0); // stayed idle
    });

    it('warms while a steam context is open, cools the timeout after it closes', () => {
      const h = setup({ mode: 'auto', flavor: 'smart', shotTemp: 0 });
      h.ctl().setSteamContext({ active: true, targetTemp: 165 });
      expect(h.target()).toBe(165);
      // held warm with no countdown while open
      vi.advanceTimersByTime(TIMEOUT_MS);
      expect(h.target()).toBe(165);
      // close → countdown begins
      h.ctl().setSteamContext({ active: false, targetTemp: null });
      expect(h.target()).toBe(DESIRED); // still warm right after close
      vi.advanceTimersByTime(TIMEOUT_MS);
      expect(h.target()).toBe(0); // cooled to idle
    });
  });

  describe('status', () => {
    it('off when steam mode is off', () => {
      const h = setup({ mode: 'off', steamTemp: 0 });
      expect(h.ctl().status()).toEqual({ state: 'off', direction: null });
    });

    it('off with a cooling arrow while still warm', () => {
      const h = setup({ mode: 'off', steamTemp: 90 });
      expect(h.ctl().status()).toEqual({ state: 'off', direction: 'down' });
    });

    it('heating with an up arrow below the target', () => {
      const h = setup({ mode: 'on', steamTemp: 100 }); // target 150
      expect(h.ctl().status()).toEqual({ state: 'heating', direction: 'up' });
    });

    it('ready (no arrow) at the target', () => {
      const h = setup({ mode: 'on', steamTemp: 150 });
      expect(h.ctl().status()).toEqual({ state: 'ready', direction: null });
    });

    it('ready (cooling arrow) above the target — steam cannot cool on demand', () => {
      const h = setup({ mode: 'on', steamTemp: 170 }); // target 150, >+10%
      expect(h.ctl().status()).toEqual({ state: 'ready', direction: 'down' });
    });

    it('no arrow while within 10% of the target', () => {
      const h = setup({ mode: 'on', steamTemp: 158 }); // target 150, within ±15
      expect(h.ctl().status()).toEqual({ state: 'ready', direction: null });
    });

    it('off + no arrow once cooled near ambient', () => {
      const h = setup({ mode: 'off', steamTemp: 40 }); // within the cooled band
      expect(h.ctl().status()).toEqual({ state: 'off', direction: null });
    });

    it('idle with a cooling arrow when Auto is resting', () => {
      const h = setup({ mode: 'auto', idleTemp: 0, steamTemp: 90 });
      expect(h.ctl().status()).toEqual({ state: 'idle', direction: 'down' });
    });
  });
});
