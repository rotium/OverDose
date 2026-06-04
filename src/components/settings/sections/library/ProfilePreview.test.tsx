import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { ProfilePreview } from './ProfilePreview';
import type { ProfileRecord } from '../../../../api';

const mkRecord = (over: Partial<ProfileRecord> = {}): ProfileRecord => ({
  id: 'profile:test',
  profile: { title: 'Test Profile' },
  metadataHash: 'm',
  compoundHash: 'c',
  parentId: null,
  visibility: 'visible',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('ProfilePreview', () => {
  it('renders the empty-state placeholder when record is null', () => {
    render(() => <ProfilePreview record={null} />);
    expect(
      screen.getByTestId('profile-preview-empty'),
    ).toBeInTheDocument();
  });

  it('renders title + author + default badge for a defaulted profile', () => {
    render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: {
            title: 'Adaptive',
            author: 'Decent',
            target_weight: 36,
            tank_temperature: 90,
          },
          isDefault: true,
        })}
      />
    ));
    const preview = screen.getByTestId('profile-preview');
    expect(preview).toHaveTextContent('Adaptive');
    expect(preview).toHaveTextContent('by Decent');
    expect(
      screen.getByTestId('profile-preview-default-badge'),
    ).toBeInTheDocument();
    // Chips
    expect(preview).toHaveTextContent('Weight 36 g');
    expect(preview).toHaveTextContent('Tank preheat 90.0 °C');
  });

  it('shows both weight and volume chips when both targets are set', () => {
    render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: {
            title: 'Both targets',
            target_weight: 36,
            target_volume: 40,
          },
        })}
      />
    ));
    const preview = screen.getByTestId('profile-preview');
    // Volume must stay visible alongside weight — it's the no-scale stop.
    expect(preview).toHaveTextContent('Weight 36 g');
    expect(preview).toHaveTextContent('Volume 40 mL');
  });

  it('shows the volume-count-start chip only when non-zero', () => {
    const { unmount } = render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: { title: 'Counted', target_volume_count_start: 2 },
        })}
      />
    ));
    expect(screen.getByTestId('profile-preview-chips')).toHaveTextContent(
      'Vol from step 2',
    );
    unmount();

    render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: { title: 'Default', target_volume_count_start: 0 },
        })}
      />
    ));
    expect(
      screen.getByTestId('profile-preview-chips'),
    ).not.toHaveTextContent('Vol from step');
  });

  it('shows the beverage-type chip even for espresso', () => {
    render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: { title: 'Plain', beverage_type: 'espresso' },
        })}
      />
    ));
    expect(screen.getByTestId('profile-preview-chips')).toHaveTextContent(
      'espresso',
    );
  });

  it("shows the 'no step data' fallback when steps are missing", () => {
    render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: { title: 'Empty steps' },
        })}
      />
    ));
    expect(
      screen.getByTestId('profile-preview-no-curve'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('profile-preview-chart'),
    ).not.toBeInTheDocument();
  });

  it('renders the SVG curve and a polyline per series run', () => {
    render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: {
            title: 'With curve',
            steps: [
              { name: 'pre', pump: 'flow', seconds: 4, flow: 4 },
              { name: 'pour', pump: 'pressure', seconds: 20, pressure: 9 },
              { name: 'tail', pump: 'flow', seconds: 4, flow: 2 },
            ],
          },
        })}
      />
    ));
    expect(screen.getByTestId('profile-preview-chart')).toBeInTheDocument();
    // Two flow runs (separated by the pressure step), one pressure run.
    expect(
      screen.getAllByTestId('profile-preview-chart-flow-run'),
    ).toHaveLength(2);
    expect(
      screen.getAllByTestId('profile-preview-chart-pressure-run'),
    ).toHaveLength(1);
  });

  it('renders one step row per parsed step with its duration', () => {
    render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: {
            title: 'With steps',
            steps: [
              { name: 'preinfuse', pump: 'flow', seconds: 4, flow: 4 },
              { name: 'pour', pump: 'pressure', seconds: 20, pressure: 9 },
            ],
          },
        })}
      />
    ));
    const preview = screen.getByTestId('profile-preview');
    expect(preview).toHaveTextContent('preinfuse');
    expect(preview).toHaveTextContent('pour');
    // 20s appears as "20 s" (whole-second formatting for ≥10s).
    expect(preview).toHaveTextContent('20 s');
  });

  it('shows notes when present', () => {
    render(() => (
      <ProfilePreview
        record={mkRecord({
          profile: { title: 't', notes: 'A flexible profile.' },
        })}
      />
    ));
    expect(screen.getByTestId('profile-preview-notes')).toHaveTextContent(
      'A flexible profile.',
    );
  });
});
