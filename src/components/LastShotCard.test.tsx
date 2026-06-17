import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

// Stub the chart: jsdom has no canvas, and the chart's rendering is not what
// these tests cover. We still surface the `visibility` prop (as JSON) and tag
// the overlay's instance (it's the one passed `cursorFlags`) so the tests can
// assert the tile chart and the full-mode overlay carry independent traces.
vi.mock('./ShotMiniChart', () => ({
  ShotMiniChart: (props: { visibility?: () => unknown; cursorFlags?: unknown }) => (
    <div
      data-testid={props.cursorFlags ? 'overlay-mini-chart' : 'tile-mini-chart'}
      data-vis={JSON.stringify(props.visibility?.() ?? null)}
    />
  ),
}));

import { LastShotCard } from './LastShotCard';
import { DEFAULT_TRACE_VISIBILITY } from '../prefs';
import type { GatewayShotRecord, GatewayShotSummary } from '../api';

const summary = (over: Partial<GatewayShotSummary> = {}): GatewayShotSummary => ({
  id: 'shot-1',
  timestamp: new Date(Date.now() - 16 * 60_000).toISOString(),
  workflow: { name: 'Cappuccino' },
  annotations: { actualDoseWeight: 18, actualYield: 36 },
  ...over,
});

const fullRecord = (overrides: Partial<GatewayShotRecord> = {}): GatewayShotRecord => {
  const start = Date.parse('2026-05-22T08:00:00Z');
  const measurements = Array.from({ length: 30 }, (_, i) => ({
    machine: {
      timestamp: new Date(start + i * 1000).toISOString(),
      flow: 1 + i * 0.05,
      pressure: i < 5 ? i * 0.5 : 9 - (i - 5) * 0.05,
      mixTemperature: 92,
      groupTemperature: 93,
    },
    scale: { weight: i * 1.2 },
  }));
  return { ...summary(), measurements, ...overrides };
};

describe('LastShotCard', () => {
  it('shows loading state while fetching the summary', () => {
    render(() => (
      <LastShotCard
        fetchSummary={() => new Promise(() => {})}
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the routine name and dose → yield once the summary arrives', async () => {
    render(() => (
      <LastShotCard
        fetchSummary={() => Promise.resolve(summary())}
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => expect(screen.getByText('Cappuccino')).toBeInTheDocument());
    expect(screen.getByTestId('last-shot-stats')).toHaveTextContent('18.0g → 36.0g');
  });

  it('renders duration once the full record arrives (peak pressure intentionally dropped)', async () => {
    render(() => (
      <LastShotCard
        fetchSummary={() => Promise.resolve(summary())}
        fetchFull={() => Promise.resolve(fullRecord())}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => {
      expect(screen.getByTestId('last-shot-stats')).toHaveTextContent(/29s/);
    });
    expect(screen.getByTestId('last-shot-stats')).not.toHaveTextContent(/bar peak/);
  });

  it('shows an error state when no shot is available', async () => {
    render(() => (
      <LastShotCard
        fetchSummary={() => Promise.reject(new Error('404'))}
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no shot yet/i);
    });
  });

  it('invokes onSeeAll when the "→ all" button is pressed', async () => {
    const onSeeAll = vi.fn();
    render(() => (
      <LastShotCard
        fetchSummary={() => Promise.resolve(summary())}
        fetchFull={() => Promise.resolve(fullRecord())}
        onSeeAll={onSeeAll}
      />
    ));
    await waitFor(() => screen.getByText('Cappuccino'));
    fireEvent.click(screen.getByRole('button', { name: /all/i }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('uses the profile title as the headline + workflow name as subtitle', async () => {
    // The profile title is the headline (how the shot was pulled). The
    // workflow / recipe name "slot" still surfaces as a muted subtitle so
    // the user knows which drink the recorded shot belongs to.
    render(() => (
      <LastShotCard
        fetchSummary={() =>
          Promise.resolve(
            summary({
              workflow: {
                name: 'Cappuccino',
                profile: { title: 'Gentle and Sweet' },
              },
            }),
          )
        }
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => screen.getByText('Gentle and Sweet'));
    const subtitle = screen.getByTestId('last-shot-subtitle');
    expect(subtitle).toHaveTextContent('Cappuccino');
  });

  it('subtitle combines recipe name + bean when both are present', async () => {
    render(() => (
      <LastShotCard
        fetchSummary={() =>
          Promise.resolve(
            summary({
              workflow: {
                name: 'Cappuccino',
                context: { coffeeName: 'Brazil Dark' },
                profile: { title: 'Gentle and Sweet' },
              },
            }),
          )
        }
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    const subtitle = await waitFor(() =>
      screen.getByTestId('last-shot-subtitle'),
    );
    expect(subtitle).toHaveTextContent('Cappuccino · Brazil Dark');
  });

  it('no subtitle rendered when the headline is already the recipe name', async () => {
    // Headline falls back to workflow.name when no profile is set. The
    // subtitle would be redundant in that case, so it's suppressed.
    render(() => (
      <LastShotCard
        fetchSummary={() =>
          Promise.resolve(summary({ workflow: { name: 'Cappuccino' } }))
        }
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => screen.getByText('Cappuccino'));
    expect(
      screen.queryByTestId('last-shot-subtitle'),
    ).not.toBeInTheDocument();
  });

  it('falls back to the workflow name when no profile title is present', async () => {
    render(() => (
      <LastShotCard
        fetchSummary={() =>
          Promise.resolve(summary({ workflow: { name: 'Cappuccino' } }))
        }
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => screen.getByText('Cappuccino'));
  });

  it('falls back to "Shot" when no workflow name is present', async () => {
    render(() => (
      <LastShotCard
        fetchSummary={() => Promise.resolve(summary({ workflow: undefined }))}
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => expect(screen.getByText('Shot')).toBeInTheDocument());
  });

  it('refetches summary + full record when refreshKey changes (auto-refresh on brew complete)', async () => {
    const fetchSummary = vi
      .fn<() => Promise<GatewayShotSummary>>()
      .mockResolvedValueOnce(summary({ id: 'old', workflow: { name: 'Old shot' } }))
      .mockResolvedValueOnce(summary({ id: 'new', workflow: { name: 'New shot' } }));
    const fetchFull = vi
      .fn<(id: string) => Promise<GatewayShotRecord>>()
      .mockImplementation((id) =>
        Promise.resolve(fullRecord({ id, workflow: { name: id } })),
      );

    const [tick, setTick] = createSignal(1);
    render(() => (
      <LastShotCard
        fetchSummary={fetchSummary}
        fetchFull={fetchFull}
        onSeeAll={() => {}}
        refreshKey={tick}
      />
    ));

    await waitFor(() => expect(screen.getByText('Old shot')).toBeInTheDocument());
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    expect(fetchFull).toHaveBeenCalledWith('old');

    setTick(2);

    await waitFor(() => expect(screen.getByText('New shot')).toBeInTheDocument());
    expect(fetchSummary).toHaveBeenCalledTimes(2);
    expect(fetchFull).toHaveBeenCalledWith('new');
  });

  it('updates the relative-time label as time passes (no page reload needed)', async () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date('2026-05-23T10:00:00Z').getTime();
      vi.setSystemTime(t0);

      render(() => (
        <LastShotCard
          fetchSummary={() =>
            Promise.resolve(
              summary({
                timestamp: new Date(t0 - 5_000).toISOString(), // 5s ago
              }),
            )
          }
          fetchFull={() => new Promise(() => {})}
          onSeeAll={() => {}}
        />
      ));
      // Flush microtasks for the resource resolution without firing the
      // setInterval (advanceTimersByTime(0) doesn't progress time).
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/just now/i)).toBeInTheDocument();

      // 2 minutes pass. Step time forward enough for the 30 s tick to fire.
      vi.setSystemTime(t0 + 2 * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(screen.queryByText(/just now/i)).not.toBeInTheDocument();
      expect(screen.getByText(/min ago/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('optimisticShot hand-off', () => {
    it('renders the optimistic record immediately while /shots/latest is still loading', async () => {
      // fetchSummary never resolves so the gateway view never "catches up".
      const optimistic: GatewayShotRecord = {
        id: 'optimistic-1',
        timestamp: '2026-05-22T08:00:00.000Z',
        workflow: { name: 'Optimistic shot' },
        annotations: { actualDoseWeight: 18, actualYield: 36 },
        measurements: fullRecord().measurements,
      };
      render(() => (
        <LastShotCard
          fetchSummary={() => new Promise(() => {})}
          fetchFull={() => new Promise(() => {})}
          onSeeAll={() => {}}
          optimisticShot={() => optimistic}
        />
      ));
      await waitFor(() =>
        expect(screen.getByText('Optimistic shot')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('last-shot-stats')).toHaveTextContent('18.0g → 36.0g');
    });

    it('switches to the gateway version once /shots/latest returns a timestamp ≥ the optimistic one', async () => {
      const optimisticTs = '2026-05-22T08:00:00.000Z';
      const optimistic: GatewayShotRecord = {
        id: 'optimistic-1',
        timestamp: optimisticTs,
        workflow: { name: 'Optimistic shot' },
        annotations: { actualDoseWeight: 18, actualYield: 36 },
        measurements: fullRecord().measurements,
      };

      const [opt, setOpt] = createSignal<GatewayShotRecord | null>(optimistic);
      render(() => (
        <LastShotCard
          fetchSummary={() =>
            Promise.resolve(
              summary({
                id: 'persisted-1',
                timestamp: '2026-05-22T08:00:05.000Z', // 5s later — gateway caught up
                workflow: { name: 'Gateway shot' },
              }),
            )
          }
          fetchFull={() =>
            Promise.resolve(
              fullRecord({ id: 'persisted-1', workflow: { name: 'Gateway shot' } }),
            )
          }
          onSeeAll={() => {}}
          optimisticShot={opt}
        />
      ));

      // Once the summary's timestamp >= the optimistic's, the gateway name shows.
      await waitFor(() =>
        expect(screen.getByText('Gateway shot')).toBeInTheDocument(),
      );

      // Parent can now clear the optimistic — UI should remain on gateway.
      setOpt(null);
      expect(screen.getByText('Gateway shot')).toBeInTheDocument();
    });
  });

  describe('enlarge to full-mode overlay', () => {
    it('opens the overlay from the corner button and closes it', async () => {
      render(() => (
        <LastShotCard
          fetchSummary={() => Promise.resolve(summary())}
          fetchFull={() => Promise.resolve(fullRecord())}
          onSeeAll={() => {}}
        />
      ));
      await waitFor(() => screen.getByText('Cappuccino'));
      expect(screen.queryByTestId('shot-chart-overlay')).toBeNull();

      fireEvent.click(screen.getByTestId('last-shot-chart-expand'));
      expect(screen.getByTestId('shot-chart-overlay')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('shot-chart-overlay-close'));
      await waitFor(() =>
        expect(screen.queryByTestId('shot-chart-overlay')).toBeNull(),
      );
    });

    it('keeps the tile chart at the saved defaults when the overlay toggles a trace', async () => {
      // Independent visibility: toggling a trace in the full-mode overlay must
      // NOT reshape the little tile chart sitting behind it.
      render(() => (
        <LastShotCard
          fetchSummary={() => Promise.resolve(summary())}
          fetchFull={() => Promise.resolve(fullRecord())}
          onSeeAll={() => {}}
          traceVisibility={() => ({ ...DEFAULT_TRACE_VISIBILITY, pressure: true })}
        />
      ));
      await waitFor(() => screen.getByText('Cappuccino'));

      const tileVis = () =>
        JSON.parse(screen.getByTestId('tile-mini-chart').getAttribute('data-vis')!);
      expect(tileVis().pressure).toBe(true);

      fireEvent.click(screen.getByTestId('last-shot-chart-expand'));
      // Overlay seeds from the same defaults…
      const overlayVis = () =>
        JSON.parse(
          screen.getByTestId('overlay-mini-chart').getAttribute('data-vis')!,
        );
      expect(overlayVis().pressure).toBe(true);

      // …toggling it off in the overlay leaves the tile untouched.
      fireEvent.click(screen.getByTestId('shot-full-legend-pressure'));
      expect(overlayVis().pressure).toBe(false);
      expect(tileVis().pressure).toBe(true);
    });
  });

  it('renders an em-dash when annotations are missing', async () => {
    render(() => (
      <LastShotCard
        fetchSummary={() =>
          Promise.resolve(summary({ annotations: undefined }))
        }
        fetchFull={() => new Promise(() => {})}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => screen.getByText('Cappuccino'));
    expect(screen.getByTestId('last-shot-stats')).toHaveTextContent('—');
  });
});
