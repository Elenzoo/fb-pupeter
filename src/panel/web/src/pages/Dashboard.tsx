import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RefreshCw, Server, FolderOpen, FileText, Cookie } from 'lucide-react'
import { getStatus } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import type { SystemStatus } from '@/lib/types'

function TokenForm() {
  const { token, setToken } = useAuth()
  const [inputValue, setInputValue] = useState(token)

  const handleSave = () => {
    setToken(inputValue.trim())
    window.location.reload()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Autoryzacja</CardTitle>
        <CardDescription>
          Wprowadz token PANEL_TOKEN aby uzyskac dostep do API
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="token" className="sr-only">
              Token
            </Label>
            <Input
              id="token"
              type="password"
              placeholder="Wprowadz PANEL_TOKEN..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          <Button onClick={handleSave}>Zapisz</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function parsePm2Status(statusText: string): { status: string; uptime?: string } {
  // Parse PM2 status table
  const lines = statusText.split('\n')
  for (const line of lines) {
    if (line.includes('fbwatcher') || line.includes('fb-watcher')) {
      if (line.includes('online')) {
        const uptimeMatch = line.match(/(\d+[smhd])/i)
        return { status: 'online', uptime: uptimeMatch?.[1] }
      }
      if (line.includes('stopped')) {
        return { status: 'stopped' }
      }
      if (line.includes('errored')) {
        return { status: 'errored' }
      }
    }
  }
  return { status: 'unknown' }
}

export function Dashboard() {
  const { isAuthenticated } = useAuth()
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getStatus()
      if (result.ok) {
        setStatus(result)
      } else {
        setError(result.error || 'Nie udalo sie pobrac statusu')
      }
    } catch {
      setError('Blad polaczenia z API')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      loadStatus()
    }
  }, [isAuthenticated])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-4">
        <TokenForm />
      </div>
    )
  }

  const pm2Info = status?.pm2Status ? parsePm2Status(status.pm2Status) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Status systemu</h2>
          <p className="text-muted-foreground">Przeglad stanu FB Watcher</p>
        </div>
        <Button variant="outline" onClick={loadStatus} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Odswiez
        </Button>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
            <TokenForm />
          </CardContent>
        </Card>
      )}

      {status && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Watcher PM2</CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    pm2Info?.status === 'online'
                      ? 'success'
                      : pm2Info?.status === 'stopped'
                        ? 'secondary'
                        : 'destructive'
                  }
                >
                  {pm2Info?.status || 'unknown'}
                </Badge>
                {pm2Info?.uptime && (
                  <span className="text-sm text-muted-foreground">
                    {pm2Info.uptime}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Node.js</CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{status.node || 'N/A'}</div>
              <p className="text-xs text-muted-foreground">PM2: {status.pm2 || 'N/A'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Katalog projektu</CardTitle>
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground break-all">{status.projectDir}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pliki konfiguracji</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> .env
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Cookie className="h-3 w-3" /> cookies.json
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">PM2 Status</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto whitespace-pre">
              {status.pm2Status}
            </pre>
          </CardContent>
        </Card>
      )}

      <TokenForm />
    </div>
  )
}
