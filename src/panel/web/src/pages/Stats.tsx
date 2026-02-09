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
import { RefreshCw, MessageSquare, Clock, TrendingUp, Flame, CheckCircle, AlertTriangle, Skull, ExternalLink } from 'lucide-react'
import { getStats } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import type { StatsResponse, PostWithStats, PostTier, DailyStats } from '@/lib/types'

const tierConfig: Record<PostTier, { label: string; icon: React.ReactNode; className: string; badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  hot: { label: 'HOT', icon: <Flame className="h-4 w-4" />, className: 'text-orange-500', badgeVariant: 'default' },
  active: { label: 'AKTYWNY', icon: <CheckCircle className="h-4 w-4" />, className: 'text-green-500', badgeVariant: 'secondary' },
  weak: { label: 'SLABY', icon: <AlertTriangle className="h-4 w-4" />, className: 'text-yellow-500 border-yellow-500', badgeVariant: 'outline' },
  dead: { label: 'MARTWY', icon: <Skull className="h-4 w-4" />, className: '', badgeVariant: 'destructive' },
}

function TierBadge({ tier }: { tier: PostTier }) {
  const config = tierConfig[tier]
  return (
    <Badge variant={config.badgeVariant} className={`gap-1 ${config.className}`}>
      {config.icon}
      {config.label}
    </Badge>
  )
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

function formatDate(isoString: string | null): string {
  if (!isoString) return '-'
  const date = new Date(isoString)
  return date.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateShort(isoString: string | null): string {
  if (!isoString) return '-'
  const date = new Date(isoString)
  return date.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
  })
}

function DailyChart({ daily }: { daily: DailyStats }) {
  // Get last 7 days
  const dates: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }

  const maxComments = Math.max(...dates.map(d => daily[d]?.comments || 0), 1)
  const barHeight = 80 // px

  return (
    <div className="flex items-end gap-2" style={{ height: `${barHeight + 40}px` }}>
      {dates.map((date) => {
        const dayData = daily[date]
        const comments = dayData?.comments || 0
        const height = comments === 0 ? 4 : Math.max((comments / maxComments) * barHeight, 8)
        const dayName = new Date(date).toLocaleDateString('pl-PL', { weekday: 'short' })

        return (
          <div key={date} className="flex flex-col items-center flex-1">
            <span className="text-xs text-muted-foreground mb-1">{comments}</span>
            <div
              className={`rounded-t w-full max-w-10 ${comments === 0 ? 'bg-muted' : 'bg-primary'}`}
              style={{ height: `${height}px` }}
              title={`${date}: ${comments} komentarzy`}
            />
            <span className="text-xs text-muted-foreground mt-1">{dayName}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Stats() {
  const { isAuthenticated } = useAuth()
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStats = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getStats()
      if (result.ok) {
        setStats(result)
      } else {
        setError(result.error || 'Nie udalo sie pobrac statystyk')
      }
    } catch {
      setError('Blad polaczenia z API')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      loadStats()
    }
  }, [isAuthenticated])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Zaloguj sie aby zobaczyc statystyki</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Statystyki</h2>
          <p className="text-muted-foreground">Analiza aktywnosci monitorowanych postow</p>
        </div>
        <Button variant="outline" onClick={loadStats} disabled={loading}>
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

      {stats && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Posty lacznie</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.summary.totalPosts}</div>
                <p className="text-xs text-muted-foreground">
                  {stats.summary.activePosts} aktywnych, {stats.summary.deadPosts} martwych
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Komentarze wykryte</CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats.summary.totalComments)}</div>
                <p className="text-xs text-muted-foreground">
                  lacznie od {formatDateShort(stats.summary.startedAt)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cykle i sesje</CardTitle>
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNumber(stats.summary.cyclesCompleted)}</div>
                <p className="text-xs text-muted-foreground">
                  cykli od {formatDateShort(stats.summary.startedAt)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Ostatni cykl: {formatDate(stats.summary.lastCycleAt)}
                </p>
                {stats.summary.lastSessionStart && (
                  <p className="text-xs text-primary mt-1">
                    Sesja #{stats.summary.restartCount} od {formatDate(stats.summary.lastSessionStart)}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Dzis</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {(() => {
                  const today = new Date().toISOString().split('T')[0]
                  const todayStats = stats.daily[today]
                  return (
                    <>
                      <div className="text-2xl font-bold">{todayStats?.comments || 0}</div>
                      <p className="text-xs text-muted-foreground">
                        komentarzy w {todayStats?.cycles || 0} cyklach
                      </p>
                    </>
                  )
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Daily Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Ostatnie 7 dni</CardTitle>
              <CardDescription>Liczba wykrytych komentarzy</CardDescription>
            </CardHeader>
            <CardContent>
              <DailyChart daily={stats.daily} />
            </CardContent>
          </Card>

          {/* Posts Tier List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Ranking postow</CardTitle>
              <CardDescription>
                Sortowane od najbardziej aktywnych do martwych
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nazwa</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Komentarze</TableHead>
                    <TableHead>Ostatni komentarz</TableHead>
                    <TableHead>Akcje</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.posts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Brak danych o postach
                      </TableCell>
                    </TableRow>
                  ) : (
                    stats.posts.map((post: PostWithStats) => (
                      <TableRow key={post.id}>
                        <TableCell className="font-medium">
                          {post.name || post.id.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <TierBadge tier={post.tier} />
                        </TableCell>
                        <TableCell className="text-right">
                          {post.stats?.totalDetected || 0}
                        </TableCell>
                        <TableCell>
                          {post.lastCommentAge || '-'}
                        </TableCell>
                        <TableCell>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent hover:text-accent-foreground"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Legend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Legenda tier</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <TierBadge tier="hot" />
                  <span className="text-sm text-muted-foreground">Nowe komentarze w ciagu ostatniej doby</span>
                </div>
                <div className="flex items-center gap-2">
                  <TierBadge tier="active" />
                  <span className="text-sm text-muted-foreground">Normalna aktywnosc</span>
                </div>
                <div className="flex items-center gap-2">
                  <TierBadge tier="weak" />
                  <span className="text-sm text-muted-foreground">Brak aktywnosci 7-14 dni</span>
                </div>
                <div className="flex items-center gap-2">
                  <TierBadge tier="dead" />
                  <span className="text-sm text-muted-foreground">Brak aktywnosci &gt; 14 dni</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
