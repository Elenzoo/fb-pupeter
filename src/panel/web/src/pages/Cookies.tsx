import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Cookie,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  HardDrive,
} from 'lucide-react'
import { getCookiesStatus, clearCookies } from '@/lib/api'
import type { SessionStatus } from '@/lib/types'

function formatAge(hours: number): string {
  if (hours < 1) return 'teraz'
  if (hours < 24) return `${Math.round(hours)}h temu`
  const days = Math.floor(hours / 24)
  return `${days}d temu`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function Cookies() {
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Dialog states
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 4000)
  }

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getCookiesStatus()
      if (result.ok) {
        setStatus(result)
      } else {
        setError(result.error || 'Nie udalo sie pobrac statusu cookies')
      }
    } catch {
      setError('Blad polaczenia')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handleClear = async () => {
    setActionLoading(true)
    try {
      const result = await clearCookies()
      if (result.ok) {
        showMessage('Cookies wyczyszczone', 'success')
        setClearDialogOpen(false)
        loadStatus()
      } else {
        showMessage(result.error || 'Nie udalo sie wyczyscic cookies', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <div
          className={`p-3 rounded-md text-sm ${
            message.type === 'success'
              ? 'bg-green-900/20 text-green-400 border border-green-900/50'
              : 'bg-red-900/20 text-red-400 border border-red-900/50'
          }`}
        >
          {message.text}
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Status sesji</CardTitle>
            <CardDescription>Informacje o aktualnych cookies</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Odswiez
          </Button>
        </CardHeader>
        <CardContent>
          {status && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {status.isLoggedIn ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <span className="font-medium">Zalogowany</span>
                    </>
                  ) : status.mainCookiesExists ? (
                    <>
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      <span className="font-medium">Cookies istnieja (status nieznany)</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 text-red-500" />
                      <span className="font-medium">Brak cookies</span>
                    </>
                  )}
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                {status.mainCookiesAge !== undefined && (
                  <p>Wiek: {formatAge(status.mainCookiesAge)}</p>
                )}
                {status.mainCookiesSize !== undefined && (
                  <p>Rozmiar: {formatSize(status.mainCookiesSize)}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main cookies */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Cookie className="h-5 w-5" />
            Plik cookies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex items-center gap-3">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-mono text-sm">cookies.json</p>
                {status && (
                  <p className="text-xs text-muted-foreground">
                    {status.mainCookiesExists
                      ? `${status.mainCookiesSize ? formatSize(status.mainCookiesSize) : ''} ${status.mainCookiesAge !== undefined ? '• ' + formatAge(status.mainCookiesAge) : ''}`
                      : 'Plik nie istnieje'}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearDialogOpen(true)}
              disabled={actionLoading || !status?.mainCookiesExists}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Wyczysc
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Clear dialog */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wyczyscic cookies?</DialogTitle>
            <DialogDescription>
              To wymusi ponowne logowanie do Facebooka przy kolejnym uruchomieniu watchera.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDialogOpen(false)}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleClear} disabled={actionLoading}>
              {actionLoading ? 'Czyszczenie...' : 'Wyczysc'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
