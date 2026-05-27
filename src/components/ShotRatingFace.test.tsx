import { describe, expect, it } from 'vitest';
import { render } from '@solidjs/testing-library';
import { ShotRatingFace } from './ShotRatingFace';

describe('ShotRatingFace', () => {
  const mouthD = (): string =>
    document.querySelector('.rating-face__mouth')?.getAttribute('d') ?? '';

  it('curves the mouth downward (frown) at low values', () => {
    render(() => <ShotRatingFace value={0} />);
    // Control-point Y above the 40 baseline → an ∩ frown.
    expect(mouthD()).toBe('M 22 40 Q 32 27 42 40');
  });

  it('is flat at the midpoint', () => {
    render(() => <ShotRatingFace value={50} />);
    expect(mouthD()).toBe('M 22 40 Q 32 40 42 40');
  });

  it('curves the mouth upward (smile) at high values', () => {
    render(() => <ShotRatingFace value={100} />);
    // Control-point Y below the baseline → a U smile.
    expect(mouthD()).toBe('M 22 40 Q 32 53 42 40');
  });
});
