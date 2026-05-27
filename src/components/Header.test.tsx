import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { Header } from './Header';
import type { WsStatus } from '../streams';
import type { WaterSeverity } from '../water';

const setup = (
  initial: {
    machine?: WsStatus;
    scale?: WsStatus;
    waterSeverity?: WaterSeverity;
    isSleeping?: boolean;
  } = {},
  handlers: Partial<{ onMenu: () => void; onToggleSleep: () => void }> = {},
) => {
  const [machine, setMachine] = createSignal<WsStatus>(initial.machine ?? 'connecting');
  const [scale, setScale] = createSignal<WsStatus>(initial.scale ?? 'connecting');
  const [waterSev, setWaterSev] = createSignal<WaterSeverity>(
    initial.waterSeverity ?? 'normal',
  );
  const [sleeping, setSleeping] = createSignal<boolean>(initial.isSleeping ?? false);
  const onMenu = handlers.onMenu ?? vi.fn();
  const onToggleSleep = handlers.onToggleSleep ?? vi.fn();
  render(() => (
    <Header
      machineStatus={machine}
      scaleStatus={scale}
      waterSeverity={waterSev}
      isSleeping={sleeping}
      onMenu={onMenu}
      onToggleSleep={onToggleSleep}
    />
  ));
  return { setMachine, setScale, setWaterSev, setSleeping, onMenu, onToggleSleep };
};

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

  it('reacts to status signal updates', () => {
    const { setMachine } = setup({ machine: 'connecting' });
    expect(screen.getByText(/machine · …/)).toBeInTheDocument();
    setMachine('open');
    expect(screen.getByText(/machine · online/)).toBeInTheDocument();
  });

  it('invokes onMenu when the menu button is pressed', () => {
    const onMenu = vi.fn();
    setup({}, { onMenu });
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
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
});
