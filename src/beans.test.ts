import { describe, expect, it } from 'vitest';
import { beanRating } from './beans';
import type { Bean } from './api';

const mk = (extras?: Bean['extras']): Bean => ({
  id: 'b1',
  roaster: 'Square Mile',
  name: 'Red Brick',
  decaf: false,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  extras,
});

describe('beanRating', () => {
  it('returns the numeric rating stored in extras', () => {
    expect(beanRating(mk({ rating: 75 }))).toBe(75);
    expect(beanRating(mk({ rating: 0 }))).toBe(0);
  });

  it('returns null when there is no usable rating', () => {
    expect(beanRating(mk())).toBeNull(); // no extras
    expect(beanRating(mk(null))).toBeNull(); // extras explicitly null
    expect(beanRating(mk({ beanId: 'x' }))).toBeNull(); // other keys only
    expect(beanRating(mk({ rating: '90' }))).toBeNull(); // non-number
  });
});
