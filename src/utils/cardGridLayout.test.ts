import { describe, expect, it } from 'vitest';
import { computeCardGridColumnCount, CARD_GRID_MAX_COLS } from './cardGridLayout';

describe('computeCardGridColumnCount', () => {
  it('never exceeds CARD_GRID_MAX_COLS', () => {
    expect(computeCardGridColumnCount(20_000)).toBe(CARD_GRID_MAX_COLS);
  });

  it('returns at least one column', () => {
    expect(computeCardGridColumnCount(50)).toBe(1);
  });

  it('uses six columns on wide desktop widths', () => {
    expect(computeCardGridColumnCount(1200)).toBe(6);
  });
});
