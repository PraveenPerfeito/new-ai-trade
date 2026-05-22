'use client';
import { useState, useCallback } from 'react';

export function useWorkspaceMemory<T>(
  key: string,
  defaultValue: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const stored = localStorage.getItem(`ws_${key}`);
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue(prev => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try { localStorage.setItem(`ws_${key}`, JSON.stringify(next)); } catch {}
        return next;
      });
    },
    [key],
  );

  return [value, set];
}
