import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { ProfileCurveChart } from './ProfileCurveChart';
import { buildProfileCurve } from '../../../../profile/curve';

// A 3-step profile → 3 named steps, 2 internal boundaries. Steps are spaced
// far enough apart that no time label collides.
const curve = () =>
  buildProfileCurve([
    { name: 'fill', seconds: 10, pump: 'flow', flow: 8 },
    { name: 'infuse', seconds: 20, pump: 'pressure', pressure: 3 },
    { name: 'pour', seconds: 25, pump: 'pressure', pressure: 9 },
  ]);

describe('ProfileCurveChart step markers', () => {
  it('full size (steps on): dividers, name chips, and boundary times', () => {
    render(() => <ProfileCurveChart curve={curve()} />);

    // 2 internal boundaries → 2 dividers.
    expect(
      screen.getAllByTestId('profile-curve-chart-step-line'),
    ).toHaveLength(2);

    // One name chip per step.
    const chips = screen.getAllByTestId('profile-curve-chart-step-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['fill', 'infuse', 'pour']);

    // Edge times: 0, 10, 30, and 55 s (duration).
    const times = screen
      .getAllByTestId('profile-curve-chart-step-time')
      .map((t) => t.textContent);
    expect(times).toEqual(['0', '10', '30', '55 s']);
  });

  it('full size, names off: dividers + times but no chips', () => {
    render(() => <ProfileCurveChart curve={curve()} showStepNames={false} />);

    expect(
      screen.getAllByTestId('profile-curve-chart-step-line'),
    ).toHaveLength(2);
    expect(
      screen.getAllByTestId('profile-curve-chart-step-time'),
    ).toHaveLength(4);
    expect(
      screen.queryByTestId('profile-curve-chart-step-chip'),
    ).not.toBeInTheDocument();
  });

  it('compact: dividers only — no chips, no times', () => {
    render(() => <ProfileCurveChart curve={curve()} compact={true} />);

    expect(
      screen.getAllByTestId('profile-curve-chart-step-line'),
    ).toHaveLength(2);
    expect(
      screen.queryByTestId('profile-curve-chart-step-chip'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('profile-curve-chart-step-time'),
    ).not.toBeInTheDocument();
  });

  it('steps off: no dividers, chips, or times', () => {
    render(() => <ProfileCurveChart curve={curve()} showSteps={false} />);

    expect(
      screen.queryByTestId('profile-curve-chart-step-line'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('profile-curve-chart-step-chip'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('profile-curve-chart-step-time'),
    ).not.toBeInTheDocument();
  });

  it('drops a boundary time that would collide with its neighbour', () => {
    // A 1-second middle step puts its end time right next to the previous
    // boundary → the collision guard drops it, leaving 0 · 10 · 55 s.
    const tight = buildProfileCurve([
      { name: 'fill', seconds: 10, pump: 'flow', flow: 8 },
      { name: 'blip', seconds: 1, pump: 'pressure', pressure: 3 },
      { name: 'pour', seconds: 44, pump: 'pressure', pressure: 9 },
    ]);
    render(() => <ProfileCurveChart curve={tight} />);

    const times = screen
      .getAllByTestId('profile-curve-chart-step-time')
      .map((t) => t.textContent);
    expect(times).toEqual(['0', '10', '55 s']);
    // Both dividers still draw (they don't collide the way labels do).
    expect(
      screen.getAllByTestId('profile-curve-chart-step-line'),
    ).toHaveLength(2);
  });

  it('drops a boundary time that would collide with the wide duration label', () => {
    // Two 1-second steps at the very end put their boundary times right up
    // against the "42 s" duration label → both are dropped, leaving 0 · 42 s.
    const endHeavy = buildProfileCurve([
      { name: 'main', seconds: 40, pump: 'pressure', pressure: 9 },
      { name: 'a', seconds: 1, pump: 'pressure', pressure: 6 },
      { name: 'b', seconds: 1, pump: 'pressure', pressure: 6 },
    ]);
    render(() => <ProfileCurveChart curve={endHeavy} />);

    const times = screen
      .getAllByTestId('profile-curve-chart-step-time')
      .map((t) => t.textContent);
    expect(times).toEqual(['0', '42 s']);
  });

  it('drops a name chip that would overlap the previous one', () => {
    // "preinfusion" is a wide chip; the short "bloom" step starts underneath
    // it, so bloom's chip is dropped (its divider still draws).
    const dense = buildProfileCurve([
      { name: 'fill', seconds: 4, pump: 'flow', flow: 8 },
      { name: 'preinfusion', seconds: 3, pump: 'pressure', pressure: 2 },
      { name: 'bloom', seconds: 3, pump: 'pressure', pressure: 3 },
      { name: 'pour', seconds: 14, pump: 'pressure', pressure: 9 },
    ]);
    render(() => <ProfileCurveChart curve={dense} />);

    const chips = screen
      .getAllByTestId('profile-curve-chart-step-chip')
      .map((c) => c.textContent);
    expect(chips).toContain('preinfusion');
    expect(chips).not.toContain('bloom');
    // The dropped chip's boundary divider is still present (3 boundaries).
    expect(
      screen.getAllByTestId('profile-curve-chart-step-line'),
    ).toHaveLength(3);
  });

  it('no steps in the profile → no step markers', () => {
    render(() => <ProfileCurveChart curve={buildProfileCurve([])} />);
    expect(
      screen.queryByTestId('profile-curve-chart-step-line'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('profile-curve-chart-step-time'),
    ).not.toBeInTheDocument();
  });
});
