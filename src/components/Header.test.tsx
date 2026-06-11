import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { Header } from './Header';
import type { WsStatus } from '../streams';
import type { WaterSeverity } from '../water';
import type { Cleaning } from '../domain';

const setup = (
  initial: {
    machine?: WsStatus;
    scale?: WsStatus;
    waterSeverity?: WaterSeverity;
    isSleeping?: boolean;
    isWarming?: boolean;
    isHeaterOff?: boolean;
    showScale?: boolean;
    dueCleanings?: Cleaning[];
  } = {},
  handlers: Partial<{
    onMenu: () => void;
    onToggleSleep: () => void;
    onCleaningPill: (c: Cleaning) => void;
  }> = {},
) => {
  const [machine, setMachine] = createSignal<WsStatus>(initial.machine ?? 'connecting');
  const [scale, setScale] = createSignal<WsStatus>(initial.scale ?? 'connecting');
  const [waterSev, setWaterSev] = createSignal<WaterSeverity>(
    initial.waterSeverity ?? 'normal',
  );
  const [sleeping, setSleeping] = createSignal<boolean>(initial.isSleeping ?? false);
  const [warming, setWarming] = createSignal<boolean>(initial.isWarming ?? false);
  const [heaterOff, setHeaterOff] = createSignal<boolean>(
    initial.isHeaterOff ?? false,
  );
  const [showScale] = createSignal<boolean>(initial.showScale ?? true);
  const [due, setDue] = createSignal<Cleaning[]>(initial.dueCleanings ?? []);
  const onMenu = handlers.onMenu ?? vi.fn();
  const onToggleSleep = handlers.onToggleSleep ?? vi.fn();
  const onCleaningPill = handlers.onCleaningPill ?? vi.fn();
  render(() => (
    <Header
      machineStatus={machine}
      scaleStatus={scale}
      showScale={showScale}
      waterSeverity={waterSev}
      isSleeping={sleeping}
      isWarming={warming}
      isHeaterOff={heaterOff}
      onMenu={onMenu}
      dueCleanings={due}
      onCleaningPill={onCleaningPill}
      onToggleSleep={onToggleSleep}
    />
  ));
  return {
    setMachine,
    setScale,
    setWaterSev,
    setSleeping,
    setWarming,
    setHeaterOff,
    setDue,
    onMenu,
    onToggleSleep,
    onCleaningPill,
  };
};

const cleaning = (id: string, name: string): Cleaning => ({
  id,
  name,
  operation: { kind: 'clean', steps: [] },
});

describe('Header', () => {
  it('renders the title', () => {
    setup();
    expect(screen.getByText('OverDose')).toBeInTheDocument();
  });

  it('renders both connection pills with status data attributes', () => {
    setup({ machine: 'open', scale: 'closed' });
    const machinePill = screen.getByText(/machine ·/);
    const scalePill = screen.getByText(/scale ·/);
    expect(machinePill).toHaveAttribute('data-state', 'open');
    expect(scalePill).toHaveAttribute('data-state', 'closed');
  });

  it('hides the scale pill when showScale is false', () => {
    setup({ scale: 'closed', showScale: false });
    expect(screen.getByText(/machine ·/)).toBeInTheDocument();
    expect(screen.queryByText(/scale ·/)).not.toBeInTheDocument();
  });

  it('reacts to status signal updates', () => {
    const { setMachine } = setup({ machine: 'connecting' });
    expect(screen.getByText(/machine · …/)).toBeInTheDocument();
    setMachine('open');
    expect(screen.getByText(/machine · online/)).toBeInTheDocument();
  });

  it('invokes onMenu when the Settings button is pressed', () => {
    const onMenu = vi.fn();
    setup({}, { onMenu });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  describe('sleep/wake toggle', () => {
    it('shows "Sleep" label and aria-pressed=false when machine is awake', () => {
      setup();
      const btn = screen.getByRole('button', { name: 'Sleep' });
      expect(btn).toHaveTextContent('Sleep');
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(btn).toHaveAttribute('data-state', 'awake');
    });

    it('flips to "Awake" label + aria-pressed=true when sleeping', () => {
      setup({ isSleeping: true });
      const btn = screen.getByRole('button', { name: 'Wake machine' });
      expect(btn).toHaveTextContent('Awake');
      expect(btn).toHaveAttribute('aria-pressed', 'true');
      expect(btn).toHaveAttribute('data-state', 'sleeping');
    });

    it('invokes onToggleSleep on click regardless of current state', () => {
      const onToggleSleep = vi.fn();
      const { setSleeping } = setup({}, { onToggleSleep });
      fireEvent.click(screen.getByRole('button', { name: 'Sleep' }));
      expect(onToggleSleep).toHaveBeenCalledTimes(1);
      setSleeping(true);
      fireEvent.click(screen.getByRole('button', { name: 'Wake machine' }));
      expect(onToggleSleep).toHaveBeenCalledTimes(2);
    });

    it('reactively swaps label and icon when sleeping state flips', () => {
      const { setSleeping } = setup();
      expect(screen.getByRole('button', { name: 'Sleep' })).toBeInTheDocument();
      setSleeping(true);
      expect(screen.getByRole('button', { name: 'Wake machine' })).toBeInTheDocument();
      setSleeping(false);
      expect(screen.getByRole('button', { name: 'Sleep' })).toBeInTheDocument();
    });

    it('keeps the sleep/wake button as the rightmost action', () => {
      setup();
      const buttons = screen.getAllByRole('button');
      expect(buttons[buttons.length - 1]).toHaveAccessibleName('Sleep');
    });
  });

  describe('low-water alert pill', () => {
    it('is hidden when severity is normal', () => {
      setup();
      expect(screen.queryByTestId('header-water-pill')).not.toBeInTheDocument();
    });

    it('renders a warn pill at warn severity', () => {
      setup({ waterSeverity: 'warn' });
      const pill = screen.getByTestId('header-water-pill');
      expect(pill).toHaveAttribute('data-severity', 'warn');
      expect(pill).toHaveTextContent(/low water/i);
    });

    it('renders a critical pill at critical severity', () => {
      setup({ waterSeverity: 'critical' });
      const pill = screen.getByTestId('header-water-pill');
      expect(pill).toHaveAttribute('data-severity', 'critical');
      expect(pill).toHaveTextContent(/refill water/i);
    });

    it('appears and disappears reactively as severity changes', () => {
      const { setWaterSev } = setup();
      expect(screen.queryByTestId('header-water-pill')).not.toBeInTheDocument();
      setWaterSev('critical');
      expect(screen.getByTestId('header-water-pill')).toBeInTheDocument();
      setWaterSev('normal');
      expect(screen.queryByTestId('header-water-pill')).not.toBeInTheDocument();
    });
  });

  describe('warming-up pill', () => {
    it('is hidden when the machine is not warming', () => {
      setup();
      expect(screen.queryByTestId('header-warming-pill')).not.toBeInTheDocument();
    });

    it('renders the amber pill while warming', () => {
      setup({ isWarming: true });
      const pill = screen.getByTestId('header-warming-pill');
      expect(pill).toHaveAttribute('data-severity', 'warming');
      expect(pill).toHaveTextContent(/warming up/i);
    });

    it('appears and disappears reactively as warming state changes', () => {
      const { setWarming } = setup();
      expect(screen.queryByTestId('header-warming-pill')).not.toBeInTheDocument();
      setWarming(true);
      expect(screen.getByTestId('header-warming-pill')).toBeInTheDocument();
      setWarming(false);
      expect(screen.queryByTestId('header-warming-pill')).not.toBeInTheDocument();
    });
  });

  describe('heater-off pill', () => {
    it('is hidden when the heater is on', () => {
      setup();
      expect(
        screen.queryByTestId('header-heater-off-pill'),
      ).not.toBeInTheDocument();
    });

    it('renders the red pill when isHeaterOff is true', () => {
      setup({ isHeaterOff: true });
      const pill = screen.getByTestId('header-heater-off-pill');
      expect(pill).toHaveAttribute('data-severity', 'heater-off');
      expect(pill).toHaveTextContent(/heater off/i);
    });

    it('hides the warming pill when heater-off and warming both apply', () => {
      // Belt-and-suspenders: at the firmware level the substates are
      // mutually exclusive (errorNoAC vs preparingForShot), but the
      // Header should still resolve the priority correctly if both
      // accessors return true.
      setup({ isHeaterOff: true, isWarming: true });
      expect(screen.getByTestId('header-heater-off-pill')).toBeInTheDocument();
      expect(
        screen.queryByTestId('header-warming-pill'),
      ).not.toBeInTheDocument();
    });

    it('appears and disappears reactively as heater state changes', () => {
      const { setHeaterOff } = setup();
      expect(
        screen.queryByTestId('header-heater-off-pill'),
      ).not.toBeInTheDocument();
      setHeaterOff(true);
      expect(screen.getByTestId('header-heater-off-pill')).toBeInTheDocument();
      setHeaterOff(false);
      expect(
        screen.queryByTestId('header-heater-off-pill'),
      ).not.toBeInTheDocument();
    });
  });

  describe('cleaning-due pills', () => {
    it('renders no pills when nothing is due', () => {
      setup();
      expect(
        screen.queryByTestId('header-cleaning-pill-c1'),
      ).not.toBeInTheDocument();
    });

    it('renders a pill per due cleaning, carrying its name', () => {
      setup({ dueCleanings: [cleaning('c1', 'Weekly Clean')] });
      const pill = screen.getByTestId('header-cleaning-pill-c1');
      expect(pill).toHaveAttribute('data-severity', 'cleaning');
      expect(pill).toHaveTextContent('Weekly Clean');
    });

    it('invokes onCleaningPill with the cleaning when tapped', () => {
      const { onCleaningPill } = setup({
        dueCleanings: [cleaning('c1', 'Weekly Clean')],
      });
      fireEvent.click(screen.getByTestId('header-cleaning-pill-c1'));
      expect(onCleaningPill).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
      );
    });

    it('appears and disappears reactively as the due list changes', () => {
      const { setDue } = setup();
      expect(
        screen.queryByTestId('header-cleaning-pill-c1'),
      ).not.toBeInTheDocument();
      setDue([cleaning('c1', 'Weekly Clean')]);
      expect(screen.getByTestId('header-cleaning-pill-c1')).toBeInTheDocument();
      setDue([]);
      expect(
        screen.queryByTestId('header-cleaning-pill-c1'),
      ).not.toBeInTheDocument();
    });
  });
});
