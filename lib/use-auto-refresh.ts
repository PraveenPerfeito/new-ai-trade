import { useCallback, useEffect, useRef, useState } from 'react'

export interface RefreshState<T> {
  data: T | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

export function useAutoRefresh<T>(
  fetcher: () => Promise<T>,
  intervalMs = 30_000,
): RefreshState<T> {
  const [data, setData]               = useState<T | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const abortRef   = useRef<AbortController | null>(null)
  // Keep a mutable ref to the latest fetcher so `refresh` never needs to
  // change identity when the caller passes a new inline arrow function.
  const fetcherRef = useRef<() => Promise<T>>(fetcher)
  useEffect(() => { fetcherRef.current = fetcher })

  // H-16: keep intervalMs stable via ref so the effect fires once;
  // prevents interval reset if caller ever passes a dynamic value
  const intervalMsRef = useRef(intervalMs)
  useEffect(() => { intervalMsRef.current = intervalMs })

  const refresh = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    fetcherRef.current()
      .then(d => {
        if (signal.aborted) return
        setData(d)
        setError(null)
        setLastUpdated(new Date())
      })
      .catch(e => {
        if (signal.aborted) return
        setError(e instanceof Error ? e.message : 'Fetch failed')
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false)
      })
  }, []) // stable — fetcher updates flow through fetcherRef, not re-renders

  useEffect(() => {
    refresh()
    if (intervalMsRef.current <= 0) return
    const id = setInterval(refresh, intervalMsRef.current)
    return () => {
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [refresh]) // intervalMs flows through ref — effect fires once on mount

  return { data, loading, error, lastUpdated, refresh }
}
