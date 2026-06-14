export function rowCountFor(itemCount: number, columns: number): number {
  if (columns <= 0) return 0;
  return Math.ceil(itemCount / columns);
}

export function rowItemRange(
  rowIndex: number,
  columns: number,
  itemCount: number,
): [number, number] {
  const start = rowIndex * columns;
  const end = Math.min(start + columns, itemCount);
  return [start, end];
}

// prefix[i] = top offset (px) of row i; prefix[rowCount] = total content height.
export function prefixOffsets(rowHeights: number[]): number[] {
  const prefix: number[] = new Array(rowHeights.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < rowHeights.length; i++) {
    prefix[i + 1] = prefix[i] + rowHeights[i];
  }
  return prefix;
}

// Half-open [startRow, endRow). scrollTop is window scrollY minus the list's top
// offset (may be negative; treated as scrolled-above-list). overscanPx pads both edges.
export function visibleRowRange(
  prefix: number[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
): [number, number] {
  const rowCount = prefix.length - 1;
  if (rowCount <= 0) return [0, 0];
  const top = scrollTop - overscanPx;
  const bottom = scrollTop + viewportHeight + overscanPx;
  let startRow = 0;
  while (startRow < rowCount && prefix[startRow + 1] <= top) startRow++;
  let endRow = startRow;
  while (endRow < rowCount && prefix[endRow] < bottom) endRow++;
  return [startRow, endRow];
}
