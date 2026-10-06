import { describe, expect, it } from 'vitest';

import { comparisonWindows, compareValues } from './compare';

describe('compareValues', () => {
  it('flags a fall of 10% or more as down and unfavourable', () => {
    const change = compareValues(80, 100);
    expect(change.direction).toBe('down');
    expect(change.ratio).toBeCloseTo(-0.2);
    expect(change.significant).toBe(true);
    expect(change.favourable).toBe(false);
  });

  it('treats a move under 10% as steady', () => {
    const change = compareValues(95, 100);
    expect(change.direction).toBe('flat');
    expect(change.significant).toBe(false);
    expect(change.favourable).toBeNull();
  });

  it('inverts favourability where more is worse', () => {
    expect(compareValues(150, 100, true).favourable).toBe(false);
    expect(compareValues(50, 100, true).favourable).toBe(true);
  });

  it('measures change against the magnitude of a negative baseline', () => {
    // A loss shrinking from -100 to -50 is a rise.
    const change = compareValues(-50, -100);
    expect(change.direction).toBe('up');
    expect(change.ratio).toBeCloseTo(0.5);
  });

  it('marks a figure appearing from zero as new and one dropping to zero as gone', () => {
    expect(compareValues(10, 0)).toMatchObject({ direction: 'new', ratio: null });
    expect(compareValues(0, 10)).toMatchObject({
      direction: 'gone',
      significant: true,
    });
    expect(compareValues(0, 0)).toMatchObject({
      direction: 'flat',
      significant: false,
    });
  });
});

describe('comparisonWindows', () => {
  it('compares an unfinished month day for day', () => {
    expect(comparisonWindows('2026-10', '2026-10-06')).toEqual({
      current: { from: '2026-10-01', to: '2026-10-06' },
      previous: { from: '2026-09-01', to: '2026-09-06' },
      days: 6,
    });
  });

  it('compares a finished month in full, clamping a shorter previous month', () => {
    expect(comparisonWindows('2026-03', '2026-10-06')).toMatchObject({
      current: { from: '2026-03-01', to: '2026-03-31' },
      previous: { from: '2026-02-01', to: '2026-02-28' },
    });
  });

  it('rolls January back to December of the year before', () => {
    expect(comparisonWindows('2026-01', '2026-01-15')?.previous).toEqual({
      from: '2025-12-01',
      to: '2025-12-15',
    });
  });

  it('refuses a future or malformed month', () => {
    expect(comparisonWindows('2026-11', '2026-10-06')).toBeNull();
    expect(comparisonWindows('2026-13', '2026-10-06')).toBeNull();
    expect(comparisonWindows('oops', '2026-10-06')).toBeNull();
  });
});
