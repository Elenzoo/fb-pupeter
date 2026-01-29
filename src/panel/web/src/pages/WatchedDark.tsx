import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, RefreshCw, Upload, Grid, List, Trash2, X } from 'lucide-react'
import { getPosts, addPost, updatePost, deletePost, uploadImage } from '@/lib/api'
import type { Post } from '@/lib/types'
import { PostCard } from '@/components/watched/PostCard'
import { cn } from '@/lib/utils'

type ViewMode = 'grid' | 'list'

export function WatchedDark() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'grid'
    return (localStorage.getItem('watched-view-mode') as ViewMode) || 'grid'
  })

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Quick add form (inline, slide-down)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [newImage, setNewImage] = useState('')
  const [newImageFile, setNewImageFile] = useState<File | null>(null)
  const [newActive, setNewActive] = useState(true)
  const [adding, setAdding] = useState(false)

  // Edit dialog state
  const [editPost, setEditPost] = useState<Post | null>(null)
  const [editUrl, setEditUrl] = useState('')
  const [editName, setEditName] = useState('')
  const [editImage, setEditImage] = useState('')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadPosts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getPosts()
      if (result.ok) {
        setPosts(result.posts)
      } else {
        setError(result.error || 'Nie udalo sie pobrac postow')
      }
    } catch {
      setError('Blad polaczenia')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  useEffect(() => {
    localStorage.setItem('watched-view-mode', viewMode)
  }, [viewMode])

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleAdd = async () => {
    if (!newUrl.trim()) {
      showMessage('Podaj URL posta', 'error')
      return
    }

    setAdding(true)
    try {
      let imagePath = newImage.trim()

      if (newImageFile) {
        const uploadResult = await uploadImage(newImageFile)
        if (!uploadResult.ok) {
          showMessage(uploadResult.error || 'Blad uploadu obrazka', 'error')
          setAdding(false)
          return
        }
        imagePath = uploadResult.path || ''
      }

      const result = await addPost({
        url: newUrl.trim(),
        name: newName.trim(),
        image: imagePath,
        active: newActive,
      })

      if (result.ok) {
        showMessage('Post dodany', 'success')
        setNewUrl('')
        setNewName('')
        setNewImage('')
        setNewImageFile(null)
        setNewActive(true)
        setShowQuickAdd(false)
        loadPosts()
      } else {
        showMessage(result.error || 'Nie udalo sie dodac posta', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setAdding(false)
    }
  }

  const handleToggleActive = async (post: Post) => {
    try {
      const result = await updatePost(post.id, { active: !post.active })
      if (result.ok) {
        loadPosts()
      } else {
        showMessage(result.error || 'Nie udalo sie zmienic statusu', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    }
  }

  const openEditDialog = (post: Post) => {
    setEditPost(post)
    setEditUrl(post.url)
    setEditName(post.name)
    setEditImage(post.image)
    setEditImageFile(null)
  }

  const handleEdit = async () => {
    if (!editPost) return

    setSaving(true)
    try {
      let imagePath = editImage.trim()

      if (editImageFile) {
        const uploadResult = await uploadImage(editImageFile)
        if (!uploadResult.ok) {
          showMessage(uploadResult.error || 'Blad uploadu obrazka', 'error')
          setSaving(false)
          return
        }
        imagePath = uploadResult.path || ''
      }

      const result = await updatePost(editPost.id, {
        url: editUrl.trim(),
        name: editName.trim(),
        image: imagePath,
      })

      if (result.ok) {
        showMessage('Zapisano zmiany', 'success')
        setEditPost(null)
        setEditImageFile(null)
        loadPosts()
      } else {
        showMessage(result.error || 'Nie udalo sie zapisac', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      const result = await deletePost(deleteTarget.id)
      if (result.ok) {
        showMessage('Post usuniety', 'success')
        setDeleteTarget(null)
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(deleteTarget.id)
          return next
        })
        loadPosts()
      } else {
        showMessage(result.error || 'Nie udalo sie usunac', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return

    const confirmDelete = window.confirm(
      `Czy na pewno chcesz usunac ${selectedIds.size} postow?`
    )
    if (!confirmDelete) return

    setDeleting(true)
    try {
      for (const id of selectedIds) {
        await deletePost(id)
      }
      showMessage(`Usunieto ${selectedIds.size} postow`, 'success')
      setSelectedIds(new Set())
      loadPosts()
    } catch {
      showMessage('Blad podczas usuwania', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const toggleSelection = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(posts.map((p) => p.id)))
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
  }

  const activePosts = posts.filter((p) => p.active).length

  return (
    <div className="flex flex-col gap-4">
      {/* Message toast */}
      {message && (
        <div
          className={cn(
            'p-3 rounded-lg text-sm animate-fade-in-up',
            message.type === 'success'
              ? 'bg-[#3fb950]/10 text-[#3fb950] border border-[#3fb950]/30'
              : 'bg-[#f85149]/10 text-[#f85149] border border-[#f85149]/30'
          )}
        >
          {message.text}
        </div>
      )}

      {/* Quick Stats Bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-4 text-sm text-[#8b949e]">
          <span>
            <strong className="text-[#e6edf3]">{posts.length}</strong> postow
          </span>
          <span className="text-[#30363d]">|</span>
          <span>
            <strong className="text-[#3fb950]">{activePosts}</strong> aktywnych
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center border border-[#30363d] rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-2 transition-colors',
                viewMode === 'grid'
                  ? 'bg-[#21262d] text-[#58a6ff]'
                  : 'text-[#8b949e] hover:text-[#e6edf3]'
              )}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-2 transition-colors',
                viewMode === 'list'
                  ? 'bg-[#21262d] text-[#58a6ff]'
                  : 'text-[#8b949e] hover:text-[#e6edf3]'
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadPosts}
            disabled={loading}
            className="border-[#30363d] hover:border-[#8b949e] text-[#8b949e] hover:text-[#e6edf3]"
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
            Odswiez
          </Button>

          <Button
            size="sm"
            onClick={() => setShowQuickAdd(!showQuickAdd)}
            className="bg-[#238636] hover:bg-[#2ea043] text-white border-0"
          >
            <Plus className="h-4 w-4 mr-2" />
            Dodaj post
          </Button>
        </div>
      </div>

      {/* Quick Add Form (slide down) */}
      {showQuickAdd && (
        <Card className="bg-[#161b22] border-[#30363d] animate-fade-in-up">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-[#e6edf3]">Dodaj nowy post</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[#8b949e] hover:text-[#e6edf3]"
                onClick={() => setShowQuickAdd(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label className="text-[#e6edf3]">URL posta *</Label>
                <Input
                  placeholder="https://www.facebook.com/..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#8b949e]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[#e6edf3]">Nazwa</Label>
                <Input
                  placeholder="Opcjonalna nazwa"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#8b949e]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[#e6edf3]">Obrazek</Label>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="URL lub wybierz plik"
                    value={newImage}
                    onChange={(e) => {
                      setNewImage(e.target.value)
                      if (e.target.value) setNewImageFile(null)
                    }}
                    disabled={!!newImageFile}
                    className="bg-[#0d1117] border-[#30363d] text-[#e6edf3] placeholder:text-[#8b949e]"
                  />
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setNewImageFile(file)
                          setNewImage('')
                        }
                        e.target.value = ''
                      }}
                    />
                    <div className="flex items-center gap-1 px-3 py-2 border border-[#30363d] rounded-md hover:border-[#8b949e] text-[#8b949e] hover:text-[#e6edf3] transition-colors">
                      <Upload className="h-4 w-4" />
                    </div>
                  </label>
                </div>
                {newImageFile && (
                  <div className="flex items-center gap-2 text-xs text-[#8b949e]">
                    <span className="truncate">{newImageFile.name}</span>
                    <button onClick={() => setNewImageFile(null)} className="text-[#f85149]">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-end gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="newActive"
                    checked={newActive}
                    onCheckedChange={(checked) => setNewActive(!!checked)}
                    className="border-[#30363d] data-[state=checked]:bg-[#238636] data-[state=checked]:border-[#238636]"
                  />
                  <Label htmlFor="newActive" className="text-[#e6edf3]">
                    Aktywny
                  </Label>
                </div>
                <Button
                  onClick={handleAdd}
                  disabled={adding}
                  className="bg-[#238636] hover:bg-[#2ea043] text-white"
                >
                  {adding ? 'Dodawanie...' : 'Dodaj'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error message */}
      {error && (
        <div className="p-4 rounded-lg bg-[#f85149]/10 border border-[#f85149]/30 text-[#f85149]">
          {error}
        </div>
      )}

      {/* Posts grid/list */}
      {viewMode === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              selected={selectedIds.has(post.id)}
              onSelect={(selected) => toggleSelection(post.id, selected)}
              onEdit={() => openEditDialog(post)}
              onDelete={() => setDeleteTarget(post)}
              onToggleActive={() => handleToggleActive(post)}
            />
          ))}
        </div>
      ) : (
        <Card className="bg-[#161b22] border-[#30363d]">
          <div className="divide-y divide-[#30363d]">
            {posts.map((post) => (
              <div
                key={post.id}
                className="flex items-center gap-4 p-4 hover:bg-[#21262d]/50 transition-colors"
              >
                <Checkbox
                  checked={selectedIds.has(post.id)}
                  onCheckedChange={(checked) => toggleSelection(post.id, !!checked)}
                  className="border-[#30363d]"
                />
                {post.image && (
                  <img
                    src={post.image}
                    alt=""
                    className="w-16 h-10 object-cover rounded border border-[#30363d]"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[#e6edf3] truncate">
                    {post.name || 'Bez nazwy'}
                  </p>
                  <p className="text-sm text-[#8b949e] truncate">{post.url}</p>
                </div>
                <button
                  onClick={() => handleToggleActive(post)}
                  className={cn(
                    'px-2 py-1 rounded text-xs font-medium',
                    post.active
                      ? 'bg-[#3fb950]/20 text-[#3fb950]'
                      : 'bg-[#8b949e]/20 text-[#8b949e]'
                  )}
                >
                  {post.active ? 'Active' : 'Inactive'}
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#8b949e] hover:text-[#e6edf3]"
                    onClick={() => openEditDialog(post)}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064l6.286-6.286z" />
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10"
                    onClick={() => setDeleteTarget(post)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {posts.length === 0 && !loading && (
        <div className="text-center py-12 text-[#8b949e]">
          <p>Brak obserwowanych postow.</p>
          <p className="text-sm mt-1">Kliknij "Dodaj post" aby dodac pierwszy.</p>
        </div>
      )}

      {/* Bulk Actions Bar (sticky bottom when items selected) */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
          <Card className="bg-[#161b22] border-[#58a6ff] shadow-lg shadow-[#58a6ff]/10">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-4">
                <span className="text-sm text-[#e6edf3]">
                  <strong>{selectedIds.size}</strong> zaznaczonych
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={selectAll}
                  className="text-[#58a6ff] hover:text-[#58a6ff] hover:bg-[#58a6ff]/10"
                >
                  Zaznacz wszystkie
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  className="text-[#8b949e] hover:text-[#e6edf3]"
                >
                  Odznacz
                </Button>
                <div className="w-px h-6 bg-[#30363d]" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBulkDelete}
                  disabled={deleting}
                  className="text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Usun zaznaczone
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editPost} onOpenChange={(open) => !open && setEditPost(null)}>
        <DialogContent className="bg-[#161b22] border-[#30363d] text-[#e6edf3]">
          <DialogHeader>
            <DialogTitle>Edytuj post</DialogTitle>
            <DialogDescription className="text-[#8b949e]">
              Zmien dane obserwowanego posta
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>URL</Label>
              <Input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                className="bg-[#0d1117] border-[#30363d]"
              />
            </div>
            <div className="space-y-2">
              <Label>Nazwa</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-[#0d1117] border-[#30363d]"
              />
            </div>
            <div className="space-y-2">
              <Label>Obrazek</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="URL lub wybierz plik"
                  value={editImage}
                  onChange={(e) => {
                    setEditImage(e.target.value)
                    if (e.target.value) setEditImageFile(null)
                  }}
                  disabled={!!editImageFile}
                  className="bg-[#0d1117] border-[#30363d]"
                />
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        setEditImageFile(file)
                        setEditImage('')
                      }
                      e.target.value = ''
                    }}
                  />
                  <div className="flex items-center px-3 py-2 border border-[#30363d] rounded-md hover:border-[#8b949e]">
                    <Upload className="h-4 w-4" />
                  </div>
                </label>
              </div>
              {editImageFile && (
                <div className="flex items-center gap-2 text-xs text-[#8b949e]">
                  <span className="truncate">{editImageFile.name}</span>
                  <button onClick={() => setEditImageFile(null)} className="text-[#f85149]">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditPost(null)}
              className="border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]"
            >
              Anuluj
            </Button>
            <Button
              onClick={handleEdit}
              disabled={saving}
              className="bg-[#238636] hover:bg-[#2ea043] text-white"
            >
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-[#161b22] border-[#30363d] text-[#e6edf3]">
          <DialogHeader>
            <DialogTitle>Usunac post?</DialogTitle>
            <DialogDescription className="text-[#8b949e]">
              Ta operacja jest nieodwracalna.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="py-4">
              <p className="font-medium">{deleteTarget.name || 'Bez nazwy'}</p>
              <p className="text-sm text-[#8b949e] break-all mt-1">{deleteTarget.url}</p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-[#30363d] text-[#8b949e] hover:text-[#e6edf3]"
            >
              Anuluj
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-[#da3633] hover:bg-[#f85149] text-white"
            >
              {deleting ? 'Usuwanie...' : 'Usun'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
