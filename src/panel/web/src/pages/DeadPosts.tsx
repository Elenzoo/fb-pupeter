import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { RefreshCw, Skull, RotateCcw, ExternalLink, Calendar, MessageSquare } from 'lucide-react'
import { getDeadPosts, reactivateDeadPost } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import type { DeadPost } from '@/lib/types'

function formatDate(isoString: string | null): string {
  if (!isoString) return '-'
  const date = new Date(isoString)
  return date.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function DeadPosts() {
  const { isAuthenticated } = useAuth()
  const [deadPosts, setDeadPosts] = useState<DeadPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reactivating, setReactivating] = useState<string | null>(null)

  const loadDeadPosts = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getDeadPosts()
      if (result.ok) {
        setDeadPosts(result.deadPosts || [])
      } else {
        setError(result.error || 'Nie udalo sie pobrac martwych postow')
      }
    } catch {
      setError('Blad polaczenia z API')
    } finally {
      setLoading(false)
    }
  }

  const handleReactivate = async (id: string) => {
    setReactivating(id)
    try {
      const result = await reactivateDeadPost(id)
      if (result.ok) {
        // Remove from local state
        setDeadPosts(prev => prev.filter(p => p.id !== id))
      } else {
        setError(result.error || 'Nie udalo sie reaktywowac posta')
      }
    } catch {
      setError('Blad polaczenia z API')
    } finally {
      setReactivating(null)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      loadDeadPosts()
    }
  }, [isAuthenticated])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Zaloguj sie aby zobaczyc martwe posty</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Martwe posty</h2>
          <p className="text-muted-foreground">
            Posty bez aktywnosci przez ponad 14 dni
          </p>
        </div>
        <Button variant="outline" onClick={loadDeadPosts} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Odswiez
        </Button>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Skull className="h-4 w-4" />
            Lista martwych postow ({deadPosts.length})
          </CardTitle>
          <CardDescription>
            Posty automatycznie przeniesione z powodu braku aktywnosci.
            Mozesz je reaktywowac aby wrocily do monitorowania.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deadPosts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Skull className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Brak martwych postow</p>
              <p className="text-sm">Wszystkie posty sa aktywne!</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nazwa</TableHead>
                  <TableHead>Dni bez aktywnosci</TableHead>
                  <TableHead>Komentarze przed smiercia</TableHead>
                  <TableHead>Data przeniesienia</TableHead>
                  <TableHead>Powod</TableHead>
                  <TableHead>Akcje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deadPosts.map((post) => (
                  <TableRow key={post.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Skull className="h-4 w-4 text-destructive" />
                        {post.name || post.id.slice(0, 8)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="destructive">
                        {post.lastCommentAgeDays} dni
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        {post.totalDetectedBeforeDeath}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {formatDate(post.movedAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {post.reason === 'no_activity_14_days' ? 'Brak aktywnosci' : post.reason}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={reactivating === post.id}
                            >
                              {reactivating === post.id ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                              <span className="ml-1">Reaktywuj</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reaktywowac post?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Post "{post.name}" zostanie przeniesiony z powrotem do listy monitorowanych.
                                Bot zacznie sprawdzac komentarze w nastepnym cyklu.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Anuluj</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleReactivate(post.id)}>
                                Reaktywuj
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent hover:text-accent-foreground"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Informacje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>Automatyczne przenoszenie:</strong> Posty bez nowych komentarzy przez 14 dni sa automatycznie przenoszone do tej listy.
          </p>
          <p>
            <strong>Reaktywacja:</strong> Kliknij "Reaktywuj" aby przywrocic post do monitorowania. Bot zacznie sprawdzac komentarze w nastepnym cyklu.
          </p>
          <p>
            <strong>Konfiguracja:</strong> Mozesz zmienic prog martwego posta (DEAD_POST_THRESHOLD_DAYS) w ustawieniach .env.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
