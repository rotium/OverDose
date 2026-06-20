import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import {
  ShotRatingBar,
  ratingWord,
  nearestRatingTier,
} from './ShotRatingBar';

const renderBar = (
  initial: number | null,
  editable = true,
  inline = false,
) => {
  const [value, setValue] = createSignal<number | null>(initial);
  const onChange = vi.fn((v: number) => setValue(v));
  const { container } = render(() => (
    <ShotRatingBar
      value={value}
      onChange={onChange}
      editable={() => editable}
      inline={inline}
      testId="rate"
    />
  ));
  return { value, onChange, container };
};

describe('ratingWord / nearestRatingTier', () => {
  it('maps a value to its nearest tier word', () => {
    expect(ratingWord(0)).toBe('Bad');
    expect(ratingWord(50)).toBe('OK');
    expect(ratingWord(100)).toBe('Great');
    // 62 is nearer 50 than 75 → "OK"; 70 is nearer 75 → "Good".
    expect(ratingWord(62)).toBe('OK');
    expect(ratingWord(70)).toBe('Good');
  });
  it('nearestRatingTier returns the preset index', () => {
    expect(nearestRatingTier(0)).toBe(0);
    expect(nearestRatingTier(75)).toBe(3);
    expect(nearestRatingTier(100)).toBe(4);
  });
});

describe('ShotRatingBar — editable', () => {
  it('tapping a tier face sets that preset', () => {
    const { onChange } = renderBar(null);
    fireEvent.click(screen.getByTestId('rate-tier-4')); // 4th tier → 75
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('shows "Tap to rate" when unrated, then the value · word once set', () => {
    renderBar(null);
    expect(screen.getByText('Tap to rate')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rate-tier-5')); // → 100 "Great"
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('· Great')).toBeInTheDocument();
  });

  it('carries the editable testid and renders the bar', () => {
    renderBar(50);
    expect(screen.getByTestId('rate')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });
});

describe('ShotRatingBar — read-only', () => {
  it('hides the bar/tiers and the testid, shows just the word', () => {
    renderBar(75, false);
    expect(screen.queryByTestId('rate')).toBeNull();
    expect(screen.queryByTestId('rate-tier-4')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText('· Good')).toBeInTheDocument();
  });

  it('shows "Unrated" when read-only and null', () => {
    renderBar(null, false);
    expect(screen.getByText('Unrated')).toBeInTheDocument();
  });
});

describe('ShotRatingBar — inline', () => {
  it('inline editable: shows the slider and tier taps set the preset', () => {
    const { onChange, container } = renderBar(75, true, true);
    expect(container.querySelector('.rating--inline')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rate-tier-3')); // → 50
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it('inline read-only: keeps bar + tiers (disabled) but they do nothing', () => {
    const { onChange, container } = renderBar(75, false, true);
    // Inline RO carries the dimmed marker and still renders the bar/tiers
    // (unlike the stacked read-only, which hides them).
    expect(container.querySelector('.rating--ro')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    const tierButtons = container.querySelectorAll('.rating__tier');
    expect(tierButtons.length).toBe(5);
    // All disabled, and clicking is a no-op (no testid in RO either).
    tierButtons.forEach((b) => expect(b).toBeDisabled());
    fireEvent.click(tierButtons[0]!);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('· Good')).toBeInTheDocument();
  });
});
