import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  CARD_GRID_MAX_COLS,
  type CardGridRowHeightVariant,
  computeCardGridColumnCount,
  computeCellWidthPx,
  estimateRowHeightPx,
} from '../utils/cardGridLayout';

/**
 * ResizeObserver-driven column count (max six) and virtual row height estimate
 * from the measured cell width.
 */
export function useCardGridMetrics(
  measureRef: RefObject<HTMLElement | null>,
  observerEnabled: boolean,
  variant: CardGridRowHeightVariant,
  layoutSignal: number,
): { gridCols: number; rowHeightEst: number } {
  const [gridCols, setGridCols] = useState(4);
  const [rowHeightEst, setRowHeightEst] = useState(() =>
    estimateRowHeightPx(computeCellWidthPx(960, CARD_GRID_MAX_COLS), variant),
  );

  useLayoutEffect(() => {
    if (!observerEnabled) return;
    const el = measureRef.current;
    if (!el) return;
    const onResize = () => {
      const w = el.clientWidth;
      const cols = computeCardGridColumnCount(w);
      setGridCols(cols);
      setRowHeightEst(estimateRowHeightPx(computeCellWidthPx(w, cols), variant));
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [observerEnabled, variant, layoutSignal]);

  return { gridCols, rowHeightEst };
}
