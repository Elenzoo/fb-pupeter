import { useState, useCallback, useRef, useEffect } from 'react'
import { getLogsOut, getLogsErr } from '@/lib/api'

type LogMode = 'out' | 'err'

interface UseLogsResult {
  logs: string
  loading: boolean
  error: string | null
  mode: LogMode
  autoRefresh: number
  setAutoRefresh: (interval: number) => void
  loadLogs: (mode?: LogMode, lines?: number) => Promise<void>
  setMode: (mode: LogMode) => void
}

export function useLogs(initialLines = 200): UseLogsResult {
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<LogMode>('out')
  const [autoRefresh, setAutoRefresh] = useState(0)
  const intervalRef = useRef<number | null>(null)

  const loadLogs = useCallback(
    async (logMode?: LogMode, lines = initialLines) => {
      const targetMode = logMode ?? mode
      setLoading(true)
      setError(null)

      try {
        const fn = targetMode === 'out' ? getLogsOut : getLogsErr
        const result = await fn(lines)

        if (result.ok && result.log) {
          // Strip ANSI codes
          const cleanLog = result.log.replace(/\x1b\[[0-9;]*m/g, '')
          setLogs(cleanLog)
        } else {
          setError(result.error || 'Nie udalo sie wczytac logow')
          setLogs('')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Blad sieci')
        setLogs('')
      } finally {
        setLoading(false)
      }
    },
    [mode, initialLines]
  )

  // Handle auto-refresh
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (autoRefresh > 0) {
      intervalRef.current = window.setInterval(() => {
        loadLogs()
      }, autoRefresh)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [autoRefresh, loadLogs])

  const handleModeChange = useCallback(
    (newMode: LogMode) => {
      setMode(newMode)
      loadLogs(newMode)
    },
    [loadLogs]
  )

  return {
    logs,
    loading,
    error,
    mode,
    autoRefresh,
    setAutoRefresh,
    loadLogs,
    setMode: handleModeChange,
  }
}
