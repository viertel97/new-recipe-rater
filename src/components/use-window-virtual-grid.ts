"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rowCountFor, prefixOffsets, visibleRowRange } from "@/lib/virtual-grid";

const ESTIMATE_ROW_HEIGHT = 440;
const OVERSCAN_PX = 600;

function columnsForWidth(width: number): number {
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

export type VirtualRow = {
  rowIndex: number;
  start: number;
  measureRef: (el: HTMLElement | null) => void;
};

export function useWindowVirtualGrid(itemCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(1);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(800);
  const [listTop, setListTop] = useState(0);
  const [version, setVersion] = useState(0);

  const rowCount = rowCountFor(itemCount, columns);

  const heightsRef = useRef<number[]>([]);
  if (heightsRef.current.length !== rowCount) {
    const next = new Array<number>(rowCount).fill(ESTIMATE_ROW_HEIGHT);
    const carry = Math.min(rowCount, heightsRef.current.length);
    for (let i = 0; i < carry; i++) next[i] = heightsRef.current[i];
    heightsRef.current = next;
  }

  const observersRef = useRef<Map<number, ResizeObserver>>(new Map());

  const measureListTop = useCallback(() => {
    const el = containerRef.current;
    if (el) setListTop(el.getBoundingClientRect().top + window.scrollY);
  }, []);

  useEffect(() => {
    const update = () => {
      setColumns(columnsForWidth(window.innerWidth));
      setViewportH(window.innerHeight);
      measureListTop();
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [measureListTop]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrollY(window.scrollY);
        measureListTop();
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [measureListTop]);

  useEffect(() => {
    measureListTop();
  }, [columns, itemCount, version, measureListTop]);

  useEffect(() => {
    const observers = observersRef.current;
    return () => {
      observers.forEach((o) => o.disconnect());
      observers.clear();
    };
  }, []);

  const prefix = useMemo(
    () => prefixOffsets(heightsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowCount, version],
  );
  const totalHeight = prefix[prefix.length - 1] ?? 0;

  const [startRow, endRow] = useMemo(
    () => visibleRowRange(prefix, scrollY - listTop, viewportH, OVERSCAN_PX),
    [prefix, scrollY, listTop, viewportH],
  );

  const makeMeasureRef = useCallback(
    (rowIndex: number) => (el: HTMLElement | null) => {
      const observers = observersRef.current;
      const existing = observers.get(rowIndex);
      if (existing) {
        existing.disconnect();
        observers.delete(rowIndex);
      }
      if (!el) return;
      const measure = () => {
        const h = el.getBoundingClientRect().height;
        if (h > 0 && Math.abs((heightsRef.current[rowIndex] ?? 0) - h) > 0.5) {
          heightsRef.current[rowIndex] = h;
          setVersion((v) => v + 1);
        }
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.set(rowIndex, ro);
    },
    [],
  );

  const virtualRows = useMemo<VirtualRow[]>(() => {
    const rows: VirtualRow[] = [];
    for (let i = startRow; i < endRow; i++) {
      rows.push({ rowIndex: i, start: prefix[i], measureRef: makeMeasureRef(i) });
    }
    return rows;
  }, [startRow, endRow, prefix, makeMeasureRef]);

  return { containerRef, columns, rowCount, totalHeight, virtualRows };
}
