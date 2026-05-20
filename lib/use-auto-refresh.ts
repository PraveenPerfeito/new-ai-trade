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
  const [data, setData]             = useState<T | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(() => {
    // Cancel any in-flight request before starting a new one
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    fetcher()
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
  }, [fetcher])

  useEffect(() => {
    refresh()
    if (intervalMs <= 0) return
    const id = setInterval(refresh, intervalMs)
    return () => {
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [refresh, intervalMs])

  return { data, loading, error, lastUpdated, refresh }
}
