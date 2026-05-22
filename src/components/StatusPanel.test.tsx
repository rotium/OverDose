import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { StatusPanel } from './StatusPanel';
import type {
  MachineSnapshot,
  ScaleMessage,
  ShotSettingsSnapshot,
  WaterLevelsSnapshot,
} from '../snapshot';

const machineSample = (over: Partial<MachineSnapshot> = {}): MachineSnapshot => ({
  timestamp: '2026-05-22T08:00:00Z',
  state: { state: 'idle', substate: 'idle' },
  flow: 0,
  pressure: 0,
  targetFlow: 0,
  targetPressure: 0,
  mixTemperature: 92,
  groupTemperature: 93,
  targetMixTemperature: 93,
  targetGroupTemperature: 93,
  profileFrame: 0,
  steamTemperature: 145,
  ...over,
});

const settingsSample = (over: Partial<ShotSettingsSnapshot> = {}): ShotSettingsSnapshot => ({
  steamSetting: 1,
  targetSteamTemp: 145,
  targetSteamDuration: 30,
  targetHotWaterTemp: 95,
  targetHotWaterVolume: 120,
  targetHotWaterDuration: 30,
  targetShotVolume: 36,
  groupTemp: 93,
  ...over,
});

interface Inputs {
  machine?: MachineSnapshot | null;
  scale?: ScaleMessage | null;
  shotSettings?: ShotSettingsSnapshot | null;
  waterLevels?: WaterLevelsSnapshot | null;
  onSteamToggle?: (next: boolean) => void;
}

const setup = (init: Inputs = {}) => {
  const [machine, setMachine] = createSignal<MachineSnapshot | null>(init.machine ?? null);
  const [scale, setScale] = createSignal<ScaleMessage | null>(init.scale ?? null);
  const [shotSettings, setShotSettings] = createSignal<ShotSettingsSnapshot | null>(
    init.shotSettings ?? null,
  );
  const [waterLevels, setWaterLevels] = createSignal<WaterLevelsSnapshot | null>(
    init.waterLevels ?? null,
  );
  const onSteamToggle = init.onSteamToggle ?? vi.fn();
  render(() => (
    <StatusPanel
      machine={machine}
      scale={scale}
      shotSettings={shotSettings}
      waterLevels={waterLevels}
      onSteamToggle={onSteamToggle}
    />
  ));
  return {
    setMachine,
    setScale,
    setShotSettings,
    setWaterLevels,
    onSteamToggle,
  };
};

describe('StatusPanel', () => {
  describe('rendering', () => {
    it('shows em-dashes when streams are empty', () => {
      setup();
      expect(screen.getByTestId('status-state')).toHaveTextContent('—');
      expect(screen.getByTestId('status-group-temp')).toHaveTextContent('—');
      expect(screen.getByTestId('status-water')).toHaveTextContent('—');
      expect(screen.getByTestId('status-scale')).toHaveTextContent('—');
    });

    it('renders machine state and group temp from snapshot', () => {
      setup({ machine: machineSample({ groupTemperature: 92.3 }) });
      expect(screen.getByTestId('status-state')).toHaveTextContent('idle');
      expect(screen.getByTestId('status-group-temp')).toHaveTextContent('92.3 °C');
    });

    it('renders scale weight and battery from a data frame', () => {
      setup({
        scale: { timestamp: 't', weight: 18.42, batteryLevel: 87 },
      });
      const cell = screen.getByTestId('status-scale');
      expect(cell).toHaveTextContent('18.4 g');
      expect(cell).toHaveTextContent('87%');
    });

    it('ignores scale status frames (does not show weight)', () => {
      setup({ scale: { status: 'disconnected' } });
      expect(screen.getByTestId('status-scale')).toHaveTextContent('—');
    });

    it('renders water level in mm with a bar', () => {
      setup({ waterLevels: { currentLevel: 100, refillLevel: 25 } });
      const cell = screen.getByTestId('status-water');
      expect(cell).toHaveTextContent('100 mm');
      const fill = cell.querySelector('.bar__fill') as HTMLElement;
      expect(fill).toBeInTheDocument();
      expect(fill.style.width).toBe('50%');
    });
  });

  describe('steam toggle', () => {
    it('is disabled until shotSettings arrive', () => {
      setup();
      const btn = screen.getByRole('button', { name: 'Toggle steam heater' });
      expect(btn).toBeDisabled();
    });

    it('reflects current steamSetting > 0 as "on"', () => {
      setup({ shotSettings: settingsSample({ steamSetting: 1 }) });
      const btn = screen.getByRole('button', { name: 'Toggle steam heater' });
      expect(btn).toHaveAttribute('aria-pressed', 'true');
      expect(btn).toHaveTextContent('on');
    });

    it('reflects steamSetting === 0 as "off"', () => {
      setup({ shotSettings: settingsSample({ steamSetting: 0 }) });
      const btn = screen.getByRole('button', { name: 'Toggle steam heater' });
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(btn).toHaveTextContent('off');
    });

    it('invokes onSteamToggle(true) when off → on', () => {
      const onSteamToggle = vi.fn();
      setup({ shotSettings: settingsSample({ steamSetting: 0 }), onSteamToggle });
      fireEvent.click(screen.getByRole('button', { name: 'Toggle steam heater' }));
      expect(onSteamToggle).toHaveBeenCalledWith(true);
    });

    it('invokes onSteamToggle(false) when on → off', () => {
      const onSteamToggle = vi.fn();
      setup({ shotSettings: settingsSample({ steamSetting: 1 }), onSteamToggle });
      fireEvent.click(screen.getByRole('button', { name: 'Toggle steam heater' }));
      expect(onSteamToggle).toHaveBeenCalledWith(false);
    });
  });

  describe('reactivity', () => {
    it('updates when the machine signal changes', () => {
      const { setMachine } = setup();
      expect(screen.getByTestId('status-state')).toHaveTextContent('—');
      setMachine(machineSample({ state: { state: 'heating', substate: 'idle' } }));
      expect(screen.getByTestId('status-state')).toHaveTextContent('heating');
    });
  });
});
