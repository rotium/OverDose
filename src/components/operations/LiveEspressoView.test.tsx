import { describe, expect, it, vi } from 'vitest';
import { render as solidRender, screen, fireEvent } from '@solidjs/testing-library';
import { createRoot, type JSX } from 'solid-js';
import { LiveEspressoView } from './LiveEspressoView';
import { createLiveShotAccumulator, type LiveShotFrame } from '../../liveShot';
import { WithPrefs } from '../../test/prefs';

// Auto-wrap every render call with a UserPrefsProvider — LiveEspressoView
// reads from the prefs context now, but the tests don't care about pref
// values, so we wrap once at the helper level instead of editing each call.
const render = (factory: () => JSX.Element) =>
  solidRender(() => <WithPrefs>{factory()}</WithPrefs>);

// Stub the streaming chart: jsdom has no canvas and the chart's correctness
// is uPlot's, not ours. We surface the frameCount prop value as a data
// attribute so tests can assert what the view feeds into the chart (used
// by the cooldown-hold regression).
vi.mock('../LiveShotChart', () => ({
  LiveShotChart: (props: {
    frameCount: () => number;
  }) => (
    <div
      data-testid="live-shot-chart-stub"
      data-frame-count={String(props.frameCount())}
    />
  ),
}));

const inRoot = (body: () => void) =>
  createRoot((dispose) => {
    try {
      body();
    } finally {
      dispose();
    }
  });

const frame = (over: Partial<LiveShotFrame> = {}): LiveShotFrame => ({
  tMs: 0,
  pressure: 0,
  flow: 0,
  weightFlow: NaN,
  weight: NaN,
  mixTemperature: 92,
  targetPressure: 0,
  targetFlow: 0,
  targetMixTemperature: 92,
  machineTimestamp: '2026-05-22T08:00:00.000Z',
  substate: 'idle',
  profileFrame: 0,
  ...over,
});

describe('LiveEspressoView', () => {
  it('renders em-dashes before any frame arrives', () => {
    inRoot(() => {
      const acc = createLiveShotAccumulator();
      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
      expect(screen.getByTestId('live-shot-chart-stub')).toBeInTheDocument();
      // WEIGHT readout shows em-dash until scale weight arrives.
      expect(screen.getByTestId('readout-weight')).toHaveTextContent('—');
    });
  });

  it('renders pressure / flow / weight / volume / counted vol / mix temp in real units after a frame', () => {
    inRoot(() => {
      const acc = createLiveShotAccumulator();
      acc.start(null);
      // Two frames so the flow-integral has a Δt to work with: 2 mL/s over
      // 1s → 2 mL of accumulated volume.
      acc.append(frame({ tMs: 11_500, flow: 2, machineTimestamp: '2026-05-22T08:00:11.500Z' }));
      acc.append(
        frame({
          tMs: 12_500,
          pressure: 6.2,
          flow: 2,
          weight: 28.4,
          mixTemperature: 92.7,
          targetPressure: 6,
          targetFlow: 2,
          targetMixTemperature: 92,
          machineTimestamp: '2026-05-22T08:00:12.500Z',
          substate: 'pouring',
        }),
      );

      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
      expect(screen.getByText(/6\.2 bar/)).toBeInTheDocument();
      expect(screen.getByText(/2\.0 mL\/s/)).toBeInTheDocument();
      expect(screen.getByText(/92\.7 °C/)).toBeInTheDocument();
      // Plain WEIGHT column — no progress bar, no "/36 g" target text.
      expect(screen.getByTestId('readout-weight')).toHaveTextContent('28.4 g');
      expect(screen.getByTestId('readout-weight')).not.toHaveTextContent(/\//);
      // VOLUME column — flow integrated to 2 mL, rendered as whole mL.
      expect(screen.getByTestId('readout-volume')).toHaveTextContent('2 mL');
      // Counted volume is always shown now (independent of count-start).
      expect(screen.getByTestId('readout-counted-volume')).toBeInTheDocument();
      // Elapsed time lives only in the header clock now (num + unit split),
      // not in a TIME readout.
      expect(screen.getByTestId('live-view-timer')).toHaveTextContent('12.5');
    });
  });

  it('STOP button invokes onStop callback', () => {
    inRoot(() => {
      const acc = createLiveShotAccumulator();
      const onStop = vi.fn();
      render(() => <LiveEspressoView acc={acc} onStop={onStop} />);
      fireEvent.click(screen.getByTestId('live-view-stop'));
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('STOP button progress + trigger', () => {
    it('fills proportionally to weight progress when targetYield is set and scale weight is leading', () => {
      const acc = createLiveShotAccumulator();
      // Profile total: 30s. Weight target: 36g. Halfway through both, but
      // weight is at 25g → 69%, time at 5s → 17%. Weight leads.
      acc.start({
        context: { targetYield: 36 },
        profile: { title: 'p', steps: [{ name: 'a', seconds: 30 }] },
      });
      acc.append(
        frame({ tMs: 5_000, weight: 25, substate: 'pouring', profileFrame: 0 }),
      );
      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);

      const fill = screen.getByTestId('live-view-stop-fill') as HTMLElement;
      // 25/36 ≈ 69.4%
      expect(parseFloat(fill.style.width)).toBeCloseTo(69.4, 0);
      // Trigger icon: weight.
      expect(
        screen.getByTestId('live-view-stop-trigger-weight'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('live-view-stop-trigger-time'),
      ).not.toBeInTheDocument();
    });

    it('switches the trigger icon to time when time progress overtakes weight', () => {
      const acc = createLiveShotAccumulator();
      // No yield target — weightProgress is 0. Time progress: 20/30 ≈ 67%.
      acc.start({
        profile: { title: 'p', steps: [{ name: 'a', seconds: 30 }] },
      });
      acc.append(
        frame({ tMs: 20_000, weight: 25, substate: 'pouring', profileFrame: 0 }),
      );
      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);

      expect(
        screen.getByTestId('live-view-stop-trigger-time'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('live-view-stop-trigger-weight'),
      ).not.toBeInTheDocument();
    });

    it('flips severity to "over" once the leading trigger crosses 100%', () => {
      const acc = createLiveShotAccumulator();
      acc.start({ context: { targetYield: 36 } });
      acc.append(frame({ weight: 40, substate: 'pouring' }));
      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
      expect(screen.getByTestId('live-view-stop')).toHaveAttribute(
        'data-severity',
        'over',
      );
    });

    it('shows no progress fill and no trigger icon when neither weight target nor profile time is known', () => {
      const acc = createLiveShotAccumulator();
      acc.start(null); // no workflow + no profile = no auto-stop info
      acc.append(frame({ tMs: 5_000, weight: 10, substate: 'pouring' }));
      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
      const fill = screen.getByTestId('live-view-stop-fill') as HTMLElement;
      expect(fill.style.width).toBe('0%');
      expect(
        screen.queryByTestId('live-view-stop-trigger-weight'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('live-view-stop-trigger-time'),
      ).not.toBeInTheDocument();
    });
  });

  describe('current-state label', () => {
    it('is absent before any frame arrives', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        expect(screen.queryByTestId('live-view-state')).not.toBeInTheDocument();
      });
    });

    it('shows "Preparing" while substate is preparingForShot', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ substate: 'preparingForShot' }));
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        expect(screen.getByTestId('live-view-state')).toHaveTextContent('Preparing');
      });
    });

    it('shows "Pouring" while substate is pouring', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ substate: 'pouring' }));
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        const state = screen.getByTestId('live-view-state');
        expect(state).toHaveTextContent('Pouring');
        expect(state).toHaveAttribute('data-substate', 'pouring');
      });
    });

    it('shows "Done" (capital first letter, not POURING DONE) when substate is pouringDone', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ substate: 'pouringDone' }));
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        const state = screen.getByTestId('live-view-state');
        expect(state).toHaveTextContent('Done');
        expect(state).not.toHaveTextContent(/pouring/i);
        expect(state).toHaveAttribute('data-substate', 'pouringDone');
      });
    });

    it('hides the label for unrecognised substates (e.g. idle leak-through)', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ substate: 'idle' }));
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        expect(screen.queryByTestId('live-view-state')).not.toBeInTheDocument();
      });
    });
  });

  describe('header timer + legend', () => {
    it('renders the big elapsed timer in the header', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        acc.append(frame({ tMs: 12_500, substate: 'pouring' }));
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        const timer = screen.getByTestId('live-view-timer');
        expect(timer).toHaveTextContent('12.5');
      });
    });

    it('renders an em-dash in the header timer before any frame arrives', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        expect(screen.getByTestId('live-view-timer')).toHaveTextContent('—');
      });
    });

    it('legend items are interactive buttons toggling aria-pressed when clicked', () => {
      // Note: NOT wrapped in inRoot — @solidjs/testing-library's render
      // creates its own reactive root. Wrapping it in createRoot tears
      // down JSX bindings the moment our body returns, but for click
      // tests we need bindings live AFTER body finishes (which is when
      // jsdom's queued microtasks flush attribute updates).
      const acc = createLiveShotAccumulator();
      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);

      const pressureBtn = screen.getByTestId('legend-toggle-pressure');
      expect(pressureBtn).toHaveAttribute('aria-pressed', 'true');
      expect(pressureBtn).not.toHaveClass('legend-item--hidden');

      fireEvent.click(pressureBtn);
      expect(pressureBtn).toHaveAttribute('aria-pressed', 'false');
      expect(pressureBtn).toHaveClass('legend-item--hidden');

      fireEvent.click(pressureBtn);
      expect(pressureBtn).toHaveAttribute('aria-pressed', 'true');
      expect(pressureBtn).not.toHaveClass('legend-item--hidden');
    });

    it('targets toggle is a single button that controls all dashed series', () => {
      const acc = createLiveShotAccumulator();
      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
      const targetsBtn = screen.getByTestId('legend-toggle-targets');
      expect(targetsBtn).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(targetsBtn);
      expect(targetsBtn).toHaveAttribute('aria-pressed', 'false');
      expect(targetsBtn).toHaveClass('legend-item--hidden');
    });

    it('toggling one trace does not affect others', () => {
      const acc = createLiveShotAccumulator();
      render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
      fireEvent.click(screen.getByTestId('legend-toggle-weightFlow'));
      expect(
        screen.getByTestId('legend-toggle-weightFlow'),
      ).toHaveAttribute('aria-pressed', 'false');
      // Others stay visible.
      for (const key of ['pressure', 'flow', 'weight', 'mixTemp', 'targets']) {
        expect(screen.getByTestId(`legend-toggle-${key}`)).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      }
    });

    it('renders a legend with one entry per chart trace plus a "targets" note', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        const legend = screen.getByTestId('live-view-legend');
        // Inspect each legend item independently — textContent of the whole
        // legend smushes adjacent labels together, so the "weight flow" and
        // "weight" items both contain the substring "weight" if matched
        // against the whole list. Per-item assertions avoid that ambiguity.
        const labels = Array.from(
          legend.querySelectorAll('.legend-label'),
        ).map((el) => el.textContent?.trim() ?? '');
        expect(labels).toContain('pressure');
        expect(labels).toContain('flow');
        expect(labels).toContain('weight flow');
        expect(labels).toContain('weight');
        expect(labels).toContain('mix temp');
        expect(labels).toContain('targets');
      });
    });
  });

  describe('profile + step name', () => {
    it('renders the profile title in the header when present', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start({ profile: { title: 'Gentle and Sweet', steps: [{ name: 'ramp up' }] } });
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        expect(screen.getByTestId('live-view-profile')).toHaveTextContent(
          'Gentle and Sweet',
        );
      });
    });

    it('falls back to "Espresso" as the title when no profile is set (ad-hoc brew)', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start(null);
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        expect(screen.getByTestId('live-view-profile')).toHaveTextContent(
          'Espresso',
        );
      });
    });

    it('renders the current step name with capital-first formatting', () => {
      // Profile names are lowercase in the source ("ramp up"); the live view
      // capitalises just the first letter ("Ramp up", not "Ramp Up").
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start({
          profile: {
            title: 'Gentle and Sweet',
            steps: [{ name: 'ramp up' }, { name: 'hold' }, { name: 'decline' }],
          },
        });
        acc.append(frame({ profileFrame: 0, substate: 'pouring' }));
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        // capital-first: "Ramp up" (not "Ramp Up", not "ramp up")
        expect(screen.getByTestId('live-view-step')).toHaveTextContent(
          /step: Ramp up/,
        );
      });
    });

    it('puts the profile and step on the same (title) row; current-state label on the subtitle row', () => {
      // Layout contract: future refactors that re-arrange these should
      // either update this test or stop and ask. The grouping is what
      // makes "what" + "which frame" read together at a glance.
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start({
          profile: { title: 'Gentle and Sweet', steps: [{ name: 'ramp up' }] },
        });
        acc.append(frame({ profileFrame: 0, substate: 'pouring' }));
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        const profileEl = screen.getByTestId('live-view-profile');
        const stepEl = screen.getByTestId('live-view-step');
        const stateEl = screen.getByTestId('live-view-state');
        // Profile + step share a common parent (the title row).
        expect(profileEl.parentElement).toBe(stepEl.parentElement);
        // The current-state label lives on the subtitle row — different parent.
        expect(stateEl.parentElement).not.toBe(profileEl.parentElement);
      });
    });

    it('omits the step element when profile lacks a step at the current index', () => {
      inRoot(() => {
        const acc = createLiveShotAccumulator();
        acc.start({ profile: { title: 'Sparse', steps: [{ name: 'only' }] } });
        acc.append(frame({ profileFrame: 5, substate: 'pouring' }));
        render(() => <LiveEspressoView acc={acc} onStop={() => {}} />);
        expect(screen.queryByTestId('live-view-step')).not.toBeInTheDocument();
      });
    });
  });
});
