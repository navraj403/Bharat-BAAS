"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch on mount (and on key change) with optional polling. `loading` = no data and no error yet. */
export function useAsync<T>(fn: () => Promise<T>, key: string, opts?: { intervalMs?: number; paused?: boolean }) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const v = await fnRef.current();
      if (my === seq.current) {
        setData(v);
        setError(undefined);
      }
    } catch (e) {
      if (my === seq.current) setError(e);
    }
  }, []);

  useEffect(() => {
    const counter = seq;
    counter.current += 1;
    const t = setTimeout(() => {
      setData(undefined);
      setError(undefined);
      void reload();
    }, 0);
    return () => {
      clearTimeout(t);
      counter.current += 1;
    };
  }, [key, reload]);

  const { intervalMs, paused } = opts ?? {};
  useEffect(() => {
    if (!intervalMs || paused) return;
    const id = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, paused, reload]);

  return { data, error, loading: data === undefined && error === undefined, reload };
}
