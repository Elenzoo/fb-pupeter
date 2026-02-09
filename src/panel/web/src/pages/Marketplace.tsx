import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Store,
  RefreshCw,
  Play,
  Pause,
  Upload,
  RotateCcw,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  Settings,
  History,
  Package,
  Plus,
  Pencil,
  Trash2,
  Save,
} from 'lucide-react'
import {
  getMarketplaceStatus,
  getMarketplaceListings,
  getMarketplaceContentPool,
  updateMarketplaceContentPool,
  getMarketplaceRenewals,
  marketplaceManualRenew,
  marketplaceManualPublish,
  marketplaceStopScheduler,
  marketplaceResumeScheduler,
  getMarketplaceRandomContent,
} from '@/lib/api'
import type {
  MarketplaceStatusResponse,
  MarketplaceListing,
  MarketplaceContentPool,
  MarketplaceRenewalLog,
  MarketplaceRandomContent,
  MarketplaceCategory,
} from '@/lib/types'

function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  return date.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// Pusta kategoria do tworzenia nowych
function createEmptyCategory(): MarketplaceCategory {
  return {
    id: '',
    name: '',
    active: true,
    titles: [''],
    descriptions: [''],
    prices: { min: 0, max: 0 },
    images: [],
    location: { city: '', radius_km: 50 },
    fbCategory: '',
  }
}

export function Marketplace() {
  const [status, setStatus] = useState<MarketplaceStatusResponse | null>(null)
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [renewalLog, setRenewalLog] = useState<MarketplaceRenewalLog[]>([])
  const [preview, setPreview] = useState<MarketplaceRandomContent | null>(null)

  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Stan dla edycji puli treści
  const [localPool, setLocalPool] = useState<MarketplaceContentPool | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [editingCategory, setEditingCategory] = useState<MarketplaceCategory | null>(null)
  const [isAddingCategory, setIsAddingCategory] = useState(false)
  const [categoryDialogTab, setCategoryDialogTab] = useState('basic')

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 5000)
  }

  const loadAll = async () => {
    setLoading(true)
    try {
      const [statusRes, listingsRes, poolRes, renewalsRes] = await Promise.all([
        getMarketplaceStatus(),
        getMarketplaceListings(),
        getMarketplaceContentPool(),
        getMarketplaceRenewals(50),
      ])

      if (statusRes.ok) setStatus(statusRes)
      if (listingsRes.ok) setListings(listingsRes.listings || [])
      if (poolRes.ok) {
        setLocalPool(JSON.parse(JSON.stringify(poolRes.pool))) // Deep copy
        setHasChanges(false)
      }
      if (renewalsRes.ok) setRenewalLog(renewalsRes.log || [])
    } catch {
      showMessage('Blad ladowania danych', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const handleStopScheduler = async () => {
    setActionLoading('stop')
    try {
      const result = await marketplaceStopScheduler()
      if (result.ok) {
        showMessage('Scheduler zatrzymany', 'success')
        loadAll()
      } else {
        showMessage(result.error || 'Blad', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleResumeScheduler = async () => {
    setActionLoading('resume')
    try {
      const result = await marketplaceResumeScheduler()
      if (result.ok) {
        showMessage('Scheduler wznowiony', 'success')
        loadAll()
      } else {
        showMessage(result.error || 'Blad', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleManualRenew = async () => {
    setActionLoading('renew')
    try {
      const result = await marketplaceManualRenew()
      if (result.ok) {
        const r = result.result
        showMessage(
          `Wznowienie: ${r?.renewed || 0} sukces, ${r?.failed || 0} bledy`,
          r?.renewed ? 'success' : 'error'
        )
        loadAll()
      } else {
        showMessage(result.error || 'Blad', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleManualPublish = async () => {
    setActionLoading('publish')
    try {
      const result = await marketplaceManualPublish()
      if (result.ok && result.result?.success) {
        showMessage(`Opublikowano: ${result.result.listing?.title}`, 'success')
        loadAll()
      } else {
        showMessage(result.result?.error || result.error || 'Blad publikacji', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleSavePool = async () => {
    if (!localPool) return

    setActionLoading('save-pool')
    try {
      const result = await updateMarketplaceContentPool(localPool)
      if (result.ok) {
        showMessage('Pula tresci zapisana', 'success')
        setHasChanges(false)
      } else {
        showMessage(result.error || 'Blad zapisu', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handlePreviewContent = async () => {
    setActionLoading('preview')
    try {
      const result = await getMarketplaceRandomContent()
      if (result.ok && result.content) {
        setPreview(result.content)
      } else {
        showMessage(result.error || 'Brak tresci do podgladu', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  // Funkcje edycji kategorii
  const openEditCategory = (category: MarketplaceCategory) => {
    setEditingCategory(JSON.parse(JSON.stringify(category))) // Deep copy
    setIsAddingCategory(false)
    setCategoryDialogTab('basic')
  }

  const openAddCategory = () => {
    setEditingCategory(createEmptyCategory())
    setIsAddingCategory(true)
    setCategoryDialogTab('basic')
  }

  const closeEditDialog = () => {
    setEditingCategory(null)
    setIsAddingCategory(false)
  }

  const saveCategory = () => {
    if (!editingCategory || !localPool) return

    // Walidacja
    if (!editingCategory.id.trim()) {
      showMessage('ID kategorii jest wymagane', 'error')
      return
    }
    if (!editingCategory.name.trim()) {
      showMessage('Nazwa kategorii jest wymagana', 'error')
      return
    }

    const newPool = { ...localPool }

    if (isAddingCategory) {
      // Sprawdź czy ID już istnieje
      if (newPool.categories.some(c => c.id === editingCategory.id)) {
        showMessage('Kategoria o takim ID juz istnieje', 'error')
        return
      }
      newPool.categories = [...newPool.categories, editingCategory]
    } else {
      newPool.categories = newPool.categories.map(c =>
        c.id === editingCategory.id ? editingCategory : c
      )
    }

    setLocalPool(newPool)
    setHasChanges(true)
    closeEditDialog()
  }

  const deleteCategory = (categoryId: string) => {
    if (!localPool) return
    if (!confirm('Czy na pewno usunac te kategorie?')) return

    setLocalPool({
      ...localPool,
      categories: localPool.categories.filter(c => c.id !== categoryId),
    })
    setHasChanges(true)
  }

  const toggleCategoryActive = (categoryId: string) => {
    if (!localPool) return

    setLocalPool({
      ...localPool,
      categories: localPool.categories.map(c =>
        c.id === categoryId ? { ...c, active: !c.active } : c
      ),
    })
    setHasChanges(true)
  }

  // Funkcje pomocnicze dla edycji kategorii
  const updateEditingCategory = (updates: Partial<MarketplaceCategory>) => {
    if (!editingCategory) return
    setEditingCategory({ ...editingCategory, ...updates })
  }

  const addTitle = () => {
    if (!editingCategory) return
    setEditingCategory({
      ...editingCategory,
      titles: [...editingCategory.titles, ''],
    })
  }

  const removeTitle = (index: number) => {
    if (!editingCategory) return
    setEditingCategory({
      ...editingCategory,
      titles: editingCategory.titles.filter((_, i) => i !== index),
    })
  }

  const updateTitle = (index: number, value: string) => {
    if (!editingCategory) return
    const newTitles = [...editingCategory.titles]
    newTitles[index] = value
    setEditingCategory({ ...editingCategory, titles: newTitles })
  }

  const addDescription = () => {
    if (!editingCategory) return
    setEditingCategory({
      ...editingCategory,
      descriptions: [...editingCategory.descriptions, ''],
    })
  }

  const removeDescription = (index: number) => {
    if (!editingCategory) return
    setEditingCategory({
      ...editingCategory,
      descriptions: editingCategory.descriptions.filter((_, i) => i !== index),
    })
  }

  const updateDescription = (index: number, value: string) => {
    if (!editingCategory) return
    const newDescriptions = [...editingCategory.descriptions]
    newDescriptions[index] = value
    setEditingCategory({ ...editingCategory, descriptions: newDescriptions })
  }

  // Funkcje dla ustawień globalnych
  const updateSettings = (updates: Partial<MarketplaceContentPool['settings']>) => {
    if (!localPool) return
    setLocalPool({
      ...localPool,
      settings: { ...localPool.settings, ...updates },
    })
    setHasChanges(true)
  }

  const addPublishHour = () => {
    if (!localPool) return
    const hours = [...localPool.settings.publishHours]
    // Znajdź pierwszą wolną godzinę
    for (let h = 8; h <= 20; h++) {
      if (!hours.includes(h)) {
        hours.push(h)
        hours.sort((a, b) => a - b)
        updateSettings({ publishHours: hours })
        return
      }
    }
  }

  const removePublishHour = (hour: number) => {
    if (!localPool) return
    updateSettings({
      publishHours: localPool.settings.publishHours.filter(h => h !== hour),
    })
  }

  const isSchedulerStopped = status?.state?.stopped ?? false
  const isEnabled = status?.enabled ?? false

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
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

      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg shrink-0">
                <Store className="h-5 w-5 lg:h-6 lg:w-6" />
              </div>
              <div>
                <CardTitle className="text-lg lg:text-xl">Marketplace</CardTitle>
                <CardDescription className="text-xs lg:text-sm">
                  Automatyczne publikowanie i wznawianie ogloszen
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={isEnabled ? (isSchedulerStopped ? 'destructive' : 'default') : 'secondary'}>
                {!isEnabled ? 'Wylaczony' : isSchedulerStopped ? 'Zatrzymany' : 'Aktywny'}
              </Badge>
              <Button variant="outline" size="sm" className="lg:w-auto" onClick={loadAll} disabled={loading}>
                <RefreshCw className={`h-4 w-4 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden lg:inline">Odswiez</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{status?.stats?.listings?.active ?? 0}</p>
              <p className="text-sm text-muted-foreground">Aktywne</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{status?.stats?.listings?.needingRenewal ?? 0}</p>
              <p className="text-sm text-muted-foreground">Do wznowienia</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{status?.stats?.listings?.totalPublished ?? 0}</p>
              <p className="text-sm text-muted-foreground">Opublikowanych</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{status?.stats?.listings?.totalRenewed ?? 0}</p>
              <p className="text-sm text-muted-foreground">Wznowien</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Akcje</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {isSchedulerStopped ? (
              <Button
                variant="default"
                size="sm"
                onClick={handleResumeScheduler}
                disabled={!!actionLoading || !isEnabled}
              >
                <Play className="h-4 w-4 mr-2" />
                {actionLoading === 'resume' ? 'Wznawianie...' : 'Wznow scheduler'}
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStopScheduler}
                disabled={!!actionLoading || !isEnabled}
              >
                <Pause className="h-4 w-4 mr-2" />
                {actionLoading === 'stop' ? 'Zatrzymywanie...' : 'Zatrzymaj scheduler'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRenew}
              disabled={!!actionLoading || !isEnabled}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {actionLoading === 'renew' ? 'Wznawianie...' : 'Reczne wznowienie'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualPublish}
              disabled={!!actionLoading || !isEnabled}
            >
              <Upload className="h-4 w-4 mr-2" />
              {actionLoading === 'publish' ? 'Publikowanie...' : 'Reczna publikacja'}
            </Button>
          </div>
          {status?.state?.stoppedReason && (
            <p className="text-sm text-red-400 mt-2">
              <AlertTriangle className="h-4 w-4 inline mr-1" />
              {status.state.stoppedReason}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="listings" className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto">
          <TabsTrigger value="listings" className="min-h-[44px] lg:min-h-[36px] text-xs lg:text-sm">
            <Package className="h-4 w-4 sm:mr-2" />
            <span className="hidden lg:inline">Ogloszenia</span>
            <span className="lg:hidden">Lista</span>
          </TabsTrigger>
          <TabsTrigger value="pool" className="min-h-[44px] lg:min-h-[36px] text-xs lg:text-sm">
            <Settings className="h-4 w-4 sm:mr-2" />
            <span className="hidden lg:inline">Pula tresci</span>
            <span className="lg:hidden">Tresc</span>
          </TabsTrigger>
          <TabsTrigger value="schedule" className="min-h-[44px] lg:min-h-[36px] text-xs lg:text-sm">
            <Clock className="h-4 w-4 sm:mr-2" />
            <span className="hidden lg:inline">Harmonogram</span>
            <span className="lg:hidden">Plan</span>
          </TabsTrigger>
          <TabsTrigger value="logs" className="min-h-[44px] lg:min-h-[36px] text-xs lg:text-sm">
            <History className="h-4 w-4 sm:mr-2" />
            Logi
          </TabsTrigger>
        </TabsList>

        {/* Ogloszenia */}
        <TabsContent value="listings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Opublikowane ogloszenia</CardTitle>
              <CardDescription>Lista ogloszen z datami wznowien</CardDescription>
            </CardHeader>
            <CardContent>
              {listings.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Brak opublikowanych ogloszen</p>
              ) : (
                <div className="space-y-2">
                  {listings.map((listing) => (
                    <div
                      key={listing.id}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{listing.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(listing.price)} | Opublikowano: {formatDate(listing.publishedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={
                            listing.status === 'active'
                              ? 'default'
                              : listing.status === 'expired'
                              ? 'secondary'
                              : 'destructive'
                          }
                        >
                          {listing.status === 'active'
                            ? 'Aktywne'
                            : listing.status === 'expired'
                            ? 'Wygaslo'
                            : listing.status}
                        </Badge>
                        <div className="text-xs text-muted-foreground text-right">
                          <p>Wznowienie:</p>
                          <p>{formatDate(listing.nextRenewalDue)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pula tresci - NOWY INTERFEJS TABELKOWY */}
        <TabsContent value="pool">
          <div className="space-y-4">
            {/* Tabela kategorii */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      Kategorie tresci
                      {hasChanges && (
                        <Badge variant="destructive" className="text-xs">Niezapisane</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {localPool?.categories?.length ?? 0} kategorii
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handlePreviewContent} disabled={!!actionLoading}>
                      <Eye className="h-4 w-4 mr-2" />
                      {actionLoading === 'preview' ? 'Ladowanie...' : 'Podglad'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={openAddCategory}>
                      <Plus className="h-4 w-4 mr-2" />
                      Dodaj kategorie
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSavePool}
                      disabled={!!actionLoading || !hasChanges}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {actionLoading === 'save-pool' ? 'Zapisywanie...' : 'Zapisz zmiany'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!localPool?.categories?.length ? (
                  <p className="text-center text-muted-foreground py-8">
                    Brak kategorii. Kliknij "Dodaj kategorie" aby utworzyc pierwsza.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Aktywna</TableHead>
                        <TableHead>Nazwa</TableHead>
                        <TableHead className="w-20 text-center">Tytulow</TableHead>
                        <TableHead className="w-20 text-center">Opisow</TableHead>
                        <TableHead className="w-32">Ceny</TableHead>
                        <TableHead className="w-40">Lokalizacja</TableHead>
                        <TableHead className="w-24 text-right">Akcje</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {localPool.categories.map((category) => (
                        <TableRow key={category.id}>
                          <TableCell>
                            <Switch
                              checked={category.active}
                              onCheckedChange={() => toggleCategoryActive(category.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{category.name}</p>
                              <p className="text-xs text-muted-foreground">{category.id}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">{category.titles.length}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">{category.descriptions.length}</Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">
                              {formatCurrency(category.prices.min)} - {formatCurrency(category.prices.max)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {category.location ? (
                              <span className="text-sm">
                                {category.location.city} ({category.location.radius_km} km)
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditCategory(category)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteCategory(category.id)}
                              >
                                <Trash2 className="h-4 w-4 text-red-400" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {/* Preview */}
                {preview && (
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <h4 className="font-semibold mb-2">Podglad losowej tresci:</h4>
                    <p className="text-sm">
                      <strong>Kategoria:</strong> {preview.categoryName}
                    </p>
                    <p className="text-sm">
                      <strong>Tytul:</strong> {preview.title}
                    </p>
                    <p className="text-sm">
                      <strong>Cena:</strong> {formatCurrency(preview.price)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-3">
                      {preview.description}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Ustawienia globalne */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ustawienia globalne</CardTitle>
                <CardDescription>Parametry publikacji dla wszystkich kategorii</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Zdjęcia na ogłoszenie */}
                  <div className="space-y-2">
                    <Label>Zdjec na ogloszenie</Label>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={localPool?.settings?.imagesPerListing?.min ?? 1}
                        onChange={(e) => updateSettings({
                          imagesPerListing: {
                            ...localPool!.settings.imagesPerListing,
                            min: parseInt(e.target.value) || 1,
                          },
                        })}
                        className="w-20"
                      />
                      <span className="text-muted-foreground">-</span>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={localPool?.settings?.imagesPerListing?.max ?? 5}
                        onChange={(e) => updateSettings({
                          imagesPerListing: {
                            ...localPool!.settings.imagesPerListing,
                            max: parseInt(e.target.value) || 5,
                          },
                        })}
                        className="w-20"
                      />
                    </div>
                  </div>

                  {/* Godziny publikacji */}
                  <div className="space-y-2">
                    <Label>Godziny publikacji</Label>
                    <div className="flex flex-wrap gap-1">
                      {localPool?.settings?.publishHours?.map((hour) => (
                        <Badge
                          key={hour}
                          variant="secondary"
                          className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => removePublishHour(hour)}
                        >
                          {hour}:00 ×
                        </Badge>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2"
                        onClick={addPublishHour}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Unikaj weekendów */}
                  <div className="space-y-2">
                    <Label>Unikaj weekendow</Label>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={localPool?.settings?.avoidWeekends ?? false}
                        onCheckedChange={(checked) => updateSettings({ avoidWeekends: checked })}
                      />
                      <span className="text-sm text-muted-foreground">
                        {localPool?.settings?.avoidWeekends ? 'Tak' : 'Nie'}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Harmonogram */}
        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Harmonogram</CardTitle>
              <CardDescription>Konfiguracja automatycznych akcji</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-2">Wznawianie</h4>
                  <p className="text-sm text-muted-foreground">
                    Interwal: <strong>{status?.config?.renewalIntervalDays ?? 7} dni</strong>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Godziny sprawdzania:{' '}
                    <strong>{(status?.config?.renewalCheckHours ?? [8, 14, 20]).join(', ')}</strong>
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Ostatnie wznowienie: {formatDate(status?.state?.lastRenewalRun)}
                  </p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-2">Publikowanie</h4>
                  <p className="text-sm text-muted-foreground">
                    Minimalny interwal: <strong>{status?.config?.publishIntervalDays ?? 3} dni</strong>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Max aktywnych: <strong>{status?.config?.maxActiveListings ?? 10}</strong>
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Ostatnia publikacja: {formatDate(status?.state?.lastPublishRun)}
                  </p>
                </div>
              </div>

              <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                <h4 className="font-semibold mb-2">Stan schedulera</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="font-medium">
                      {status?.state?.stopped ? (
                        <span className="text-red-400">Zatrzymany</span>
                      ) : status?.state?.isRunning ? (
                        <span className="text-green-400">Dziala</span>
                      ) : (
                        <span className="text-yellow-400">Oczekuje</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Bledy z rzedu</p>
                    <p className="font-medium">{status?.state?.consecutiveErrors ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Powinien wznowic</p>
                    <p className="font-medium">
                      {status?.nextActions?.shouldRenew ? (
                        <CheckCircle className="h-4 w-4 inline text-green-400" />
                      ) : (
                        <XCircle className="h-4 w-4 inline text-muted-foreground" />
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Powinien opublikowac</p>
                    <p className="font-medium">
                      {status?.nextActions?.shouldPublish ? (
                        <CheckCircle className="h-4 w-4 inline text-green-400" />
                      ) : (
                        <XCircle className="h-4 w-4 inline text-muted-foreground" />
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-4">
                Aby zmienic konfiguracje, edytuj zmienne MARKETPLACE_* w ustawieniach .env
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logi */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historia wznowien</CardTitle>
              <CardDescription>Ostatnie {renewalLog.length} wpisow</CardDescription>
            </CardHeader>
            <CardContent>
              {renewalLog.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Brak logow</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {renewalLog.map((entry, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-3 p-2 rounded-lg ${
                        entry.success ? 'bg-green-900/10' : 'bg-red-900/10'
                      }`}
                    >
                      {entry.success ? (
                        <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{entry.title || entry.listingId}</p>
                        {!entry.success && entry.error && (
                          <p className="text-xs text-red-400">{entry.error}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDate(entry.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog edycji kategorii - mobile optimized */}
      <Dialog open={!!editingCategory} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent className="max-w-[calc(100vw-1rem)] lg:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isAddingCategory ? 'Dodaj kategorie' : `Edytuj: ${editingCategory?.name}`}
            </DialogTitle>
            <DialogDescription>
              {isAddingCategory
                ? 'Wprowadz dane nowej kategorii tresci'
                : 'Zmodyfikuj dane kategorii'}
            </DialogDescription>
          </DialogHeader>

          {editingCategory && (
            <Tabs value={categoryDialogTab} onValueChange={setCategoryDialogTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="basic">Podstawowe</TabsTrigger>
                <TabsTrigger value="titles">
                  Tytuly ({editingCategory.titles.length})
                </TabsTrigger>
                <TabsTrigger value="descriptions">
                  Opisy ({editingCategory.descriptions.length})
                </TabsTrigger>
              </TabsList>

              {/* Zakładka Podstawowe */}
              <TabsContent value="basic" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cat-id">ID kategorii</Label>
                    <Input
                      id="cat-id"
                      value={editingCategory.id}
                      onChange={(e) => updateEditingCategory({ id: e.target.value })}
                      disabled={!isAddingCategory}
                      placeholder="np. garaze-blaszane"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cat-name">Nazwa</Label>
                    <Input
                      id="cat-name"
                      value={editingCategory.name}
                      onChange={(e) => updateEditingCategory({ name: e.target.value })}
                      placeholder="np. Garaze blaszane"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Label>Aktywna</Label>
                  <Switch
                    checked={editingCategory.active}
                    onCheckedChange={(checked) => updateEditingCategory({ active: checked })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Cena minimalna (PLN)</Label>
                    <Input
                      type="number"
                      value={editingCategory.prices.min}
                      onChange={(e) =>
                        updateEditingCategory({
                          prices: { ...editingCategory.prices, min: parseInt(e.target.value) || 0 },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cena maksymalna (PLN)</Label>
                    <Input
                      type="number"
                      value={editingCategory.prices.max}
                      onChange={(e) =>
                        updateEditingCategory({
                          prices: { ...editingCategory.prices, max: parseInt(e.target.value) || 0 },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Miasto</Label>
                    <Input
                      value={editingCategory.location?.city ?? ''}
                      onChange={(e) =>
                        updateEditingCategory({
                          location: {
                            city: e.target.value,
                            radius_km: editingCategory.location?.radius_km ?? 50,
                          },
                        })
                      }
                      placeholder="np. Warszawa"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Promien (km)</Label>
                    <Input
                      type="number"
                      value={editingCategory.location?.radius_km ?? 50}
                      onChange={(e) =>
                        updateEditingCategory({
                          location: {
                            city: editingCategory.location?.city ?? '',
                            radius_km: parseInt(e.target.value) || 50,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Kategoria Facebook</Label>
                  <Input
                    value={editingCategory.fbCategory ?? ''}
                    onChange={(e) => updateEditingCategory({ fbCategory: e.target.value })}
                    placeholder="np. vehicles"
                  />
                </div>
              </TabsContent>

              {/* Zakładka Tytuły */}
              <TabsContent value="titles" className="space-y-4 mt-4">
                <div className="space-y-2">
                  {editingCategory.titles.map((title, index) => (
                    <div key={index} className="flex gap-2">
                      <span className="w-8 text-sm text-muted-foreground pt-2">{index + 1}.</span>
                      <Input
                        value={title}
                        onChange={(e) => updateTitle(index, e.target.value)}
                        placeholder="Wpisz tytul..."
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTitle(index)}
                        disabled={editingCategory.titles.length <= 1}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={addTitle}>
                  <Plus className="h-4 w-4 mr-2" />
                  Dodaj tytul
                </Button>
              </TabsContent>

              {/* Zakładka Opisy */}
              <TabsContent value="descriptions" className="space-y-4 mt-4">
                <div className="space-y-3">
                  {editingCategory.descriptions.map((desc, index) => (
                    <div key={index} className="flex gap-2">
                      <span className="w-8 text-sm text-muted-foreground pt-2">{index + 1}.</span>
                      <Textarea
                        value={desc}
                        onChange={(e) => updateDescription(index, e.target.value)}
                        placeholder="Wpisz opis..."
                        rows={3}
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDescription(index)}
                        disabled={editingCategory.descriptions.length <= 1}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={addDescription}>
                  <Plus className="h-4 w-4 mr-2" />
                  Dodaj opis
                </Button>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={closeEditDialog}>
              Anuluj
            </Button>
            <Button onClick={saveCategory}>
              {isAddingCategory ? 'Dodaj' : 'Zapisz'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
