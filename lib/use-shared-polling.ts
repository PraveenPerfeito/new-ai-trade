'use client'

/**
 * useSharedPolling — module-level singleton polling per key.
 *
 * Multiple components subscribing to the same key share a single timer
 * and receive the same cached data, preventing duplicate API calls when
 * the same endpoint is polled by more than one mounted component.
 *
 * Drop-in replacement for useAutoRefresh when multiple components on the
 * same page (or across layout-preserved routes) need the same data.
 */

import { useCallback, useEffect, useReducer } from 'react'

export interface SharedPollState<T> {
  data:        T | null
  loading:     boolean
  error:       string | null
  lastUpdated: Date | null
  refresh:     () => void
}

// ── Module-level registry (survives component remount/HMR) ────────────────────

interface _Entry {
  data:        unknown
  loading:     boolean
  error:       string | null
  lastUpdated: Date | null
  subscribers: Set<() => void>
  timer:       ReturnType<typeof setInterval> | null
  fetcherRef:  { current: () => Promise<unknown> }
  intervalMs:  number
}

const _entries = new Map<string, _Entry>()

async function _run(key: string): Promise<void> {
  const entry = _entries.get(key)
  if (!entry) return
  try {
    const data = await entry.fetcherRef.current()
    const e = _entries.get(key)
    if (!e) return
    e.data = data; e.loading = false; e.error = null; e.lastUpdated = new Date()
  } catch (err) {
    const e = _entries.get(key)
    if (!e) return
    e.error       = err instanceof Error ? err.message : 'Fetch failed'
    e.loading     = false
  }
  _entries.get(key)?.subscribers.forEach(fn => fn())
}

function _acquire(key: string, fetcher: () => Promise<unknown>, intervalMs: number): _Entry {
  if (!_entries.has(key)) {
    _entries.set(key, {
      data: null, loading: true, error: null, lastUpdated: null,
      subscribers: new Set(), timer: null,
      fetcherRef: { current: fetcher },
      intervalMs,
    })
  }
  return _entries.get(key)!
}

function _startTimer(key: string): void {
  const e = _entries.get(key)
  if (!e || e.timer !== null) return
  _run(key)
  // intervalMs === 0 → fetch once on mount, no recurring timer
  if (e.intervalMs > 0) {
    e.timer = setInterval(() => _run(key), e.intervalMs)
  } else {
    e.timer = -1 as unknown as ReturnType<typeof setInterval>
  }
}

function _release(key: string, subscriber: () => void): void {
  const e = _entries.get(key)
  if (!e) return
  e.subscribers.delete(subscriber)
  if (e.subscribers.size === 0) {
    if (e.timer !== null && e.timer as unknown as number !== -1) { clearInterval(e.timer) }
    e.timer = null
    _entries.delete(key)
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSharedPolling<T>(
  /** Stable cache key — must be unique per API endpoint+params combination */
  key: string,
  fetcher: () => Promise<T>,
  intervalMs = 120_000,
): SharedPollState<T> {
  const [, forceRender] = useReducer((n: number) => n + 1, 0)

  const entry = _acquire(key, fetcher as () => Promise<unknown>, intervalMs)

  // Keep fetcherRef current so the timer always invokes the latest closure
  // (same pattern as useAutoRefresh's fetcherRef)
  useEffect(() => { entry.fetcherRef.current = fetcher as () => Promise<unknown> })

  useEffect(() => {
    entry.subscribers.add(forceRender)
    _startTimer(key)
    return () => {
      // Small delay handles React StrictMode double-invoke: the cleanup from
      // the first mount runs after the second mount has re-subscribed, so the
      // subscriber count stays > 0 and the timer is not cancelled prematurely.
      setTimeout(() => _release(key, forceRender), 50)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => _run(key), [key])

  return {
    data:        entry.data as T | null,
    loading:     entry.loading,
    error:       entry.error,
    lastUpdated: entry.lastUpdated,
    refresh,
  }
}
