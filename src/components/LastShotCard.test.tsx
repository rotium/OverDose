import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';

// Stub the chart: jsdom has no canvas, and the chart's rendering is not what
// these tests cover. Stats, error states, and dispatch are the contract here.
vi.mock('./ShotMiniChart', () => ({
  ShotMiniChart: () => <div data-testid="shot-mini-chart-stub" />,
}));

import { LastShotCard } from './LastShotCard';
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

  it('renders the beverage name and dose → yield once the summary arrives', async () => {
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

  it('renders peak pressure + duration once the full record arrives', async () => {
    render(() => (
      <LastShotCard
        fetchSummary={() => Promise.resolve(summary())}
        fetchFull={() => Promise.resolve(fullRecord())}
        onSeeAll={() => {}}
      />
    ));
    await waitFor(() => {
      expect(screen.getByTestId('last-shot-stats')).toHaveTextContent(/bar peak/);
    });
    expect(screen.getByTestId('last-shot-stats')).toHaveTextContent(/29s/);
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
