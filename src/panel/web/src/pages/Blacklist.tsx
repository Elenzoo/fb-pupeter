import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Ban, Trash2, RefreshCw, ExternalLink, Plus } from 'lucide-react'
import { getBlacklist, removeFromBlacklist, addToBlacklist } from '@/lib/api'
import type { BlacklistEntry } from '@/lib/types'

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

export function Blacklist() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [filter, setFilter] = useState('')

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const loadBlacklist = async () => {
    setLoading(true)
    try {
      const result = await getBlacklist()
      if (result.ok) {
        setEntries(result.blacklist)
      } else {
        showMessage(result.error || 'Nie udalo sie wczytac blacklisty', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBlacklist()
  }, [])

  const handleRemove = async (id: string) => {
    setActionLoading(id)
    try {
      const result = await removeFromBlacklist(id)
      if (result.ok) {
        showMessage('Usunieto z blacklisty - post moze byc ponownie wykryty', 'success')
        setEntries(prev => prev.filter(e => e.id !== id))
      } else {
        showMessage(result.error || 'Nie udalo sie usunac', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleAdd = async () => {
    if (!newUrl.trim()) return

    setActionLoading('add')
    try {
      const result = await addToBlacklist(newUrl.trim())
      if (result.ok && result.entry) {
        showMessage('Dodano do blacklisty', 'success')
        setEntries(prev => [result.entry!, ...prev])
        setNewUrl('')
      } else {
        showMessage(result.error || 'Nie udalo sie dodac', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const filteredEntries = filter
    ? entries.filter(e =>
        e.url.toLowerCase().includes(filter.toLowerCase()) ||
        (e.content?.toLowerCase().includes(filter.toLowerCase())) ||
        (e.pageName?.toLowerCase().includes(filter.toLowerCase()))
      )
    : entries

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
                <Ban className="h-6 w-6" />
              </div>
              <div>
                <CardTitle>Blacklist</CardTitle>
                <CardDescription>
                  {entries.length > 0
                    ? `${entries.length} odrzuconych postow`
                    : 'Brak odrzuconych postow'}
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadBlacklist} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Odswiez
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new URL */}
          <div className="flex gap-2">
            <Input
              placeholder="Dodaj URL do blacklisty..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button
              onClick={handleAdd}
              disabled={!newUrl.trim() || actionLoading === 'add'}
            >
              <Plus className="h-4 w-4 mr-2" />
              {actionLoading === 'add' ? 'Dodawanie...' : 'Dodaj'}
            </Button>
          </div>

          {/* Filter */}
          {entries.length > 0 && (
            <Input
              placeholder="Filtruj..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Ladowanie...
          </CardContent>
        </Card>
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Ban className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {filter ? 'Brak wynikow' : 'Blacklist pusta'}
            </h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              {filter
                ? 'Zmien filtr aby zobaczyc wyniki.'
                : 'Odrzucone posty z Wykryc pojawia sie tutaj. Mozesz tez recznie dodac URL powyzej.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2">
                      {entry.pageName && (
                        <span className="font-semibold truncate">{entry.pageName}</span>
                      )}
                      <Badge variant="outline" className="shrink-0">
                        {entry.reason === 'user_rejected' ? 'Odrzucony' : 'Reczny'}
                      </Badge>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDate(entry.rejectedAt)}
                      </span>
                    </div>

                    {/* Content */}
                    {entry.content && (
                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                        {entry.content}
                      </p>
                    )}

                    {/* URL */}
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline flex items-center gap-1 truncate"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{entry.url}</span>
                    </a>
                  </div>

                  {/* Actions */}
                  <div className="shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemove(entry.id)}
                      disabled={!!actionLoading}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {actionLoading === entry.id ? '...' : 'Usun'}
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
