import { useCallback, useEffect, useState } from 'react'

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
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = useCallback(() => {
    fetcher()
      .then(d => {
        setData(d)
        setError(null)
        setLastUpdated(new Date())
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Fetch failed'))
      .finally(() => setLoading(false))
  }, [fetcher])

  useEffect(() => {
    refresh()
    if (intervalMs <= 0) return
    const id = setInterval(refresh, intervalMs)
    return () => clearInterval(id)
  }, [refresh, intervalMs])

  return { data, loading, error, lastUpdated, refresh }
}
