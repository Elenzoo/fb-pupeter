import { useState, useCallback } from 'react'

interface UseApiOptions<T> {
  onSuccess?: (data: T) => void
  onError?: (error: string) => void
}

interface UseApiResult<T, Args extends unknown[]> {
  data: T | null
  loading: boolean
  error: string | null
  execute: (...args: Args) => Promise<T | null>
  reset: () => void
}

export function useApi<T, Args extends unknown[] = []>(
  apiFn: (...args: Args) => Promise<T & { ok: boolean; error?: string }>,
  options: UseApiOptions<T> = {}
): UseApiResult<T, Args> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      setLoading(true)
      setError(null)

      try {
        const result = await apiFn(...args)
        if (result.ok) {
          setData(result)
          options.onSuccess?.(result)
          return result
        } else {
          const errorMsg = result.error || 'Unknown error'
          setError(errorMsg)
          options.onError?.(errorMsg)
          return null
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Network error'
        setError(errorMsg)
        options.onError?.(errorMsg)
        return null
      } finally {
        setLoading(false)
      }
    },
    [apiFn, options]
  )

  const reset = useCallback(() => {
    setData(null)
    setError(null)
    setLoading(false)
  }, [])

  return { data, loading, error, execute, reset }
}
