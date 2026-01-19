import { useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { RefreshCw, Maximize2, Minimize2 } from 'lucide-react'
import { useLogs } from '@/hooks/useLogs'
import { useState } from 'react'

export function Logs() {
  const {
    logs,
    loading,
    error,
    mode,
    autoRefresh,
    setAutoRefresh,
    loadLogs,
    setMode,
  } = useLogs(200)

  const [lines, setLines] = useState(200)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    loadLogs()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoScroll && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleRefresh = () => {
    loadLogs(mode, lines)
  }

  const handleModeChange = (newMode: string) => {
    setMode(newMode as 'out' | 'err')
  }

  const toggleAutoRefresh = () => {
    if (autoRefresh > 0) {
      setAutoRefresh(0)
    } else {
      setAutoRefresh(5000) // 5 seconds
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <Card className={expanded ? 'fixed inset-4 z-50 flex flex-col' : 'flex-1 flex flex-col'}>
        <CardHeader className="flex flex-row items-center justify-between shrink-0">
          <CardTitle>Logi PM2</CardTitle>
          <div className="flex items-center gap-2">
            <Tabs value={mode} onValueChange={handleModeChange}>
              <TabsList>
                <TabsTrigger value="out">stdout</TabsTrigger>
                <TabsTrigger value="err">stderr</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="icon" onClick={() => setExpanded(!expanded)}>
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-4 shrink-0">
            <div className="space-y-2">
              <Label htmlFor="lines">Liczba linii</Label>
              <Input
                id="lines"
                type="number"
                className="w-24"
                value={lines}
                onChange={(e) => setLines(Number(e.target.value) || 200)}
                min={20}
                max={2000}
              />
            </div>

            <Button variant="outline" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Wczytaj
            </Button>

            <Button
              variant={autoRefresh > 0 ? 'default' : 'outline'}
              onClick={toggleAutoRefresh}
            >
              Auto: {autoRefresh > 0 ? 'WL' : 'WYL'}
            </Button>

            <div className="flex items-center gap-2">
              <Checkbox
                id="autoScroll"
                checked={autoScroll}
                onCheckedChange={(checked) => setAutoScroll(!!checked)}
              />
              <Label htmlFor="autoScroll">Auto-scroll</Label>
            </div>
          </div>

          {error && (
            <p className="text-destructive text-sm shrink-0">{error}</p>
          )}

          {/* Log content */}
          <Textarea
            ref={textareaRef}
            className="flex-1 font-mono text-xs resize-none min-h-[300px]"
            value={logs}
            readOnly
            placeholder="Brak logow do wyswietlenia..."
          />

          <p className="text-xs text-muted-foreground shrink-0">
            Tryb: {mode.toUpperCase()} | Linii: {lines} | Auto-refresh: {autoRefresh > 0 ? `${autoRefresh / 1000}s` : 'wyl'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
