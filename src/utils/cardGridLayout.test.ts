import { describe, expect, it } from 'vitest';
import { computeCardGridColumnCount } from './cardGridLayout';
import { LIBRARY_GRID_MAX_COLUMNS_MAX, LIBRARY_GRID_MAX_COLUMNS_MIN } from '../store/authStoreDefaults';

describe('computeCardGridColumnCount', () => {
  it('never exceeds the configured max', () => {
    expect(computeCardGridColumnCount(20_000, 6)).toBe(6);
    expect(computeCardGridColumnCount(20_000, 4)).toBe(4);
  });

  it('clamps requested max to store-wide upper bound', () => {
    expect(computeCardGridColumnCount(20_000, 99)).toBe(LIBRARY_GRID_MAX_COLUMNS_MAX);
  });

  it('clamps requested max to store-wide lower bound', () => {
    expect(computeCardGridColumnCount(20_000, 2)).toBe(LIBRARY_GRID_MAX_COLUMNS_MIN);
  });

  it('returns at least one column', () => {
    expect(computeCardGridColumnCount(50, 6)).toBe(1);
  });

  it('uses six columns on wide desktop when max allows', () => {
    expect(computeCardGridColumnCount(1200, 6)).toBe(6);
  });
});
