import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { Header } from './Header';
import type { WsStatus } from '../streams';

const setup = (
  initial: { machine?: WsStatus; scale?: WsStatus } = {},
  handlers: Partial<{ onMenu: () => void; onSleep: () => void }> = {},
) => {
  const [machine, setMachine] = createSignal<WsStatus>(initial.machine ?? 'connecting');
  const [scale, setScale] = createSignal<WsStatus>(initial.scale ?? 'connecting');
  const onMenu = handlers.onMenu ?? vi.fn();
  const onSleep = handlers.onSleep ?? vi.fn();
  render(() => (
    <Header
      machineStatus={machine}
      scaleStatus={scale}
      onMenu={onMenu}
      onSleep={onSleep}
    />
  ));
  return { setMachine, setScale, onMenu, onSleep };
};

describe('Header', () => {
  it('renders the title', () => {
    setup();
    expect(screen.getByText('Decent.app')).toBeInTheDocument();
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

  it('invokes onSleep when the sleep button is pressed', () => {
    const onSleep = vi.fn();
    setup({}, { onSleep });
    fireEvent.click(screen.getByRole('button', { name: 'Sleep' }));
    expect(onSleep).toHaveBeenCalledTimes(1);
  });

  it('invokes onMenu when the menu button is pressed', () => {
    const onMenu = vi.fn();
    setup({}, { onMenu });
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('places sleep as the rightmost button', () => {
    setup();
    const buttons = screen.getAllByRole('button');
    expect(buttons[buttons.length - 1]).toHaveAccessibleName('Sleep');
  });
});
