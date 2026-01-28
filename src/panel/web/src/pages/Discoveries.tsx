import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bell, Check, X, RefreshCw, ExternalLink, CheckCheck, XCircle } from 'lucide-react'
import {
  getDiscoveries,
  approveDiscovery,
  rejectDiscovery,
  approveAllDiscoveries,
  rejectAllDiscoveries,
} from '@/lib/api'
import type { Discovery } from '@/lib/types'

function highlightKeywords(text: string, keywords: string[]): React.ReactNode {
  if (!keywords.length) return text

  const regex = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(regex)

  return parts.map((part, i) => {
    const isKeyword = keywords.some(k => k.toLowerCase() === part.toLowerCase())
    if (isKeyword) {
      return (
        <span key={i} className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded">
          {part}
        </span>
      )
    }
    return part
  })
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Discoveries() {
  const [discoveries, setDiscoveries] = useState<Discovery[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const loadDiscoveries = async () => {
    setLoading(true)
    try {
      const result = await getDiscoveries()
      if (result.ok) {
        setDiscoveries(result.discoveries)
      } else {
        showMessage(result.error || 'Nie udalo sie wczytac wykryc', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDiscoveries()
  }, [])

  const handleApprove = async (id: string) => {
    setActionLoading(id)
    try {
      const result = await approveDiscovery(id)
      if (result.ok) {
        showMessage('Zatwierdzono - dodano do monitorowanych', 'success')
        setDiscoveries(prev => prev.filter(d => d.id !== id))
      } else {
        showMessage(result.error || 'Nie udalo sie zatwierdzic', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (id: string) => {
    setActionLoading(id)
    try {
      const result = await rejectDiscovery(id)
      if (result.ok) {
        showMessage('Odrzucono - dodano do blacklist', 'success')
        setDiscoveries(prev => prev.filter(d => d.id !== id))
      } else {
        showMessage(result.error || 'Nie udalo sie odrzucic', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleApproveAll = async () => {
    setActionLoading('approve-all')
    try {
      const result = await approveAllDiscoveries()
      if (result.ok) {
        showMessage(`Zatwierdzono ${result.count || discoveries.length} wykryc`, 'success')
        setDiscoveries([])
      } else {
        showMessage(result.error || 'Nie udalo sie zatwierdzic wszystkich', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleRejectAll = async () => {
    setActionLoading('reject-all')
    try {
      const result = await rejectAllDiscoveries()
      if (result.ok) {
        showMessage(`Odrzucono ${result.count || discoveries.length} wykryc`, 'success')
        setDiscoveries([])
      } else {
        showMessage(result.error || 'Nie udalo sie odrzucic wszystkich', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg">
                <Bell className="h-6 w-6" />
              </div>
              <div>
                <CardTitle>Wykrycia</CardTitle>
                <CardDescription>
                  {discoveries.length > 0
                    ? `${discoveries.length} postow oczekuje na zatwierdzenie`
                    : 'Brak nowych wykryc'}
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadDiscoveries} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Odswiez
            </Button>
          </div>
        </CardHeader>
        {discoveries.length > 0 && (
          <CardContent>
            <div className="flex gap-2 mb-4">
              <Button
                variant="default"
                size="sm"
                onClick={handleApproveAll}
                disabled={!!actionLoading}
              >
                <CheckCheck className="h-4 w-4 mr-2" />
                {actionLoading === 'approve-all' ? 'Zatwierdzanie...' : 'Zatwierdz wszystkie'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRejectAll}
                disabled={!!actionLoading}
              >
                <XCircle className="h-4 w-4 mr-2" />
                {actionLoading === 'reject-all' ? 'Odrzucanie...' : 'Odrzuc wszystkie'}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Ladowanie...
          </CardContent>
        </Card>
      ) : discoveries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Brak wykryc</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Gdy Feed Scanner znajdzie nowe posty pasujace do slow kluczowych,
              pojawia sie tutaj do zatwierdzenia.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {discoveries.map((discovery) => (
            <Card key={discovery.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2">
                      {discovery.pageName && (
                        <span className="font-semibold truncate">{discovery.pageName}</span>
                      )}
                      <Badge variant="secondary" className="shrink-0">
                        {discovery.source === 'home_feed' ? 'Feed' : discovery.source === 'group' ? 'Grupa' : 'Reklamy'}
                      </Badge>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDate(discovery.discoveredAt)}
                      </span>
                    </div>

                    {/* Content */}
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
                      {highlightKeywords(discovery.content, discovery.matchedKeywords)}
                    </p>

                    {/* Keywords */}
                    <div className="flex flex-wrap gap-1 mb-3">
                      {discovery.matchedKeywords.map((kw) => (
                        <Badge key={kw} variant="outline" className="text-xs">
                          {kw}
                        </Badge>
                      ))}
                    </div>

                    {/* URL */}
                    <a
                      href={discovery.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline flex items-center gap-1 truncate"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{discovery.url}</span>
                    </a>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleApprove(discovery.id)}
                      disabled={!!actionLoading}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      {actionLoading === discovery.id ? '...' : 'Zatwierdz'}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleReject(discovery.id)}
                      disabled={!!actionLoading}
                    >
                      <X className="h-4 w-4 mr-1" />
                      {actionLoading === discovery.id ? '...' : 'Odrzuc'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
