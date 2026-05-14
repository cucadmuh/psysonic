/**
 * Shared responsive card grids: capped columns, even stretch (`minmax(0, 1fr)`),
 * and row-height estimates derived from measured cell width (TanStack virtual rows).
 */

export const CARD_GRID_GAP_PX = 16;
export const CARD_GRID_MIN_TILE_PX = 140;
export const CARD_GRID_MAX_COLS = 6;

export function computeCardGridColumnCount(containerWidthPx: number): number {
  const raw = Math.floor(
    (containerWidthPx + CARD_GRID_GAP_PX) / (CARD_GRID_MIN_TILE_PX + CARD_GRID_GAP_PX),
  );
  return Math.min(CARD_GRID_MAX_COLS, Math.max(1, raw));
}

export function computeCellWidthPx(containerWidthPx: number, columnCount: number): number {
  const c = Math.max(1, columnCount);
  return (containerWidthPx - (c - 1) * CARD_GRID_GAP_PX) / c;
}

export type CardGridRowHeightVariant = 'artist' | 'album' | 'playlist' | 'composer';

const VARIANT: Record<CardGridRowHeightVariant, { extra: number; min: number; max: number }> = {
  artist: { extra: 72, min: 200, max: 520 },
  /** Cover scales with cell width; ~108px headroom matches prior ~288px row at ~180px tiles. */
  album: { extra: 108, min: 260, max: 560 },
  playlist: { extra: 108, min: 260, max: 560 },
  /** Text-only composer tiles (~78px intrinsic) with some slack for wrapping. */
  composer: { extra: 56, min: 88, max: 200 },
};

export function estimateRowHeightPx(cellWidthPx: number, variant: CardGridRowHeightVariant): number {
  const { extra, min, max } = VARIANT[variant];
  return Math.max(min, Math.min(max, Math.ceil(cellWidthPx + extra)));
}
