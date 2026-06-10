import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { CleaningWizard } from './CleaningWizard';
import type { Cleaning } from '../../domain';
import type { MachineSnapshot, MachineState } from '../../snapshot';
import type { WsStream } from '../../streams';

const snap = (state: MachineState): MachineSnapshot =>
  ({
    timestamp: '',
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
    steamTemperature: 0,
  }) as MachineSnapshot;

const fakeStream = () => {
  const [latest, setLatest] = createSignal<MachineSnapshot | null>(null);
  const stream = { latest, status: () => 'open' } as unknown as WsStream<MachineSnapshot>;
  return { stream, setLatest };
};

const flushCleaning = (): Cleaning => ({
  id: 'c1',
  name: 'Quick Flush',
  operation: { kind: 'clean', steps: [{ id: 's1', type: 'flush' }] },
});

describe('CleaningWizard', () => {
  it('runs a flush step: Start → monitors enter/leave → completes', async () => {
    const { stream, setLatest } = fakeStream();
    const requestState = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();

    render(() => (
      <CleaningWizard
        cleaning={flushCleaning()}
        machineStream={() => stream}
        requestState={requestState}
        onComplete={onComplete}
        onExit={vi.fn()}
      />
    ));

    // Run phase shows a Start button.
    fireEvent.click(await waitFor(() => screen.getByTestId('wizard-start')));
    expect(requestState).toHaveBeenCalledWith('flush');

    // Machine enters flush → running.
    setLatest(snap('flush'));
    await waitFor(() => screen.getByTestId('wizard-running'));

    // Machine leaves flush → step done → wizard finished.
    setLatest(snap('idle'));
    await waitFor(() => screen.getByTestId('wizard-done'));

    fireEvent.click(screen.getByTestId('wizard-finish'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('advances instruction phases with Next', async () => {
    const { stream } = fakeStream();
    render(() => (
      <CleaningWizard
        cleaning={{
          id: 'c1',
          name: 'Weekly',
          operation: {
            kind: 'clean',
            steps: [
              { id: 's1', type: 'coffeeSide', withChemical: true }, // instruction (placeholder)
              { id: 's2', type: 'flush' }, // run
            ],
          },
        }}
        machineStream={() => stream}
        requestState={vi.fn().mockResolvedValue(undefined)}
        onComplete={vi.fn()}
        onExit={vi.fn()}
      />
    ));
    await waitFor(() => screen.getByTestId('wizard-instruction'));
    expect(screen.getByTestId('wizard-counter')).toHaveTextContent('1 / 2');
    fireEvent.click(screen.getByTestId('wizard-next'));
    // Advanced to the flush run phase.
    await waitFor(() => screen.getByTestId('wizard-run'));
  });

  it('Close exits without completing', async () => {
    const { stream } = fakeStream();
    const onExit = vi.fn();
    render(() => (
      <CleaningWizard
        cleaning={flushCleaning()}
        machineStream={() => stream}
        requestState={vi.fn().mockResolvedValue(undefined)}
        onComplete={vi.fn()}
        onExit={onExit}
      />
    ));
    fireEvent.click(await waitFor(() => screen.getByTestId('wizard-close')));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
