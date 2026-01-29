import { useEffect, useState, useCallback } from 'react'
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
import { Plus, RefreshCw, Upload, Grid, List, X, Sparkles } from 'lucide-react'
import { getPosts, addPost, updatePost, deletePost, uploadImage } from '@/lib/api'
import type { Post } from '@/lib/types'
import { PostCardGlass } from '@/components/watched/PostCardGlass'
import { cn } from '@/lib/utils'

type ViewMode = 'grid' | 'list'

export function WatchedColorful() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Quick add form
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

  const activePosts = posts.filter((p) => p.active).length

  return (
    <div className="flex flex-col gap-6">
      {/* Message toast */}
      {message && (
        <div
          className={cn(
            'p-4 rounded-2xl text-sm animate-fade-in-up backdrop-blur-xl',
            message.type === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/30'
              : 'bg-red-500/10 text-red-400 border border-red-500/30'
          )}
        >
          {message.text}
        </div>
      )}

      {/* Quick Add Bar - Always visible */}
      <div className="glass rounded-2xl p-4 border border-white/10">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px] space-y-1.5">
            <Label className="text-xs text-white/60">URL posta</Label>
            <Input
              placeholder="https://www.facebook.com/..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="bg-white/5 border-white/10 focus:border-purple-500/50 placeholder:text-white/30"
            />
          </div>
          <div className="w-48 space-y-1.5">
            <Label className="text-xs text-white/60">Nazwa</Label>
            <Input
              placeholder="Opcjonalna"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-white/5 border-white/10 focus:border-purple-500/50 placeholder:text-white/30"
            />
          </div>
          <div className="w-48 space-y-1.5">
            <Label className="text-xs text-white/60">Obrazek</Label>
            <div className="flex gap-2">
              <Input
                placeholder="URL"
                value={newImage}
                onChange={(e) => {
                  setNewImage(e.target.value)
                  if (e.target.value) setNewImageFile(null)
                }}
                disabled={!!newImageFile}
                className="bg-white/5 border-white/10 focus:border-purple-500/50 placeholder:text-white/30"
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
                <div className="h-9 w-9 flex items-center justify-center rounded-lg border border-white/10 hover:border-purple-500/50 hover:bg-purple-500/10 transition-colors">
                  <Upload className="h-4 w-4 text-white/60" />
                </div>
              </label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={newActive}
              onCheckedChange={(checked) => setNewActive(!!checked)}
              className="border-white/20 data-[state=checked]:bg-gradient-primary data-[state=checked]:border-purple-500"
            />
            <Label className="text-sm text-white/60">Aktywny</Label>
          </div>
          <Button
            onClick={handleAdd}
            disabled={adding}
            className="bg-gradient-primary hover:opacity-90 text-white px-6 shadow-lg shadow-purple-500/25"
          >
            <Plus className="h-4 w-4 mr-2" />
            {adding ? 'Dodawanie...' : 'Dodaj'}
          </Button>
        </div>
        {newImageFile && (
          <div className="flex items-center gap-2 mt-2 text-xs text-white/50">
            <span className="truncate">{newImageFile.name}</span>
            <button onClick={() => setNewImageFile(null)} className="text-pink-400 hover:text-pink-300">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Stats & Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" />
            <span className="text-2xl font-bold gradient-text">{posts.length}</span>
            <span className="text-white/50">postow</span>
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-lg font-semibold text-green-400">{activePosts}</span>
            <span className="text-white/50">aktywnych</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-xl overflow-hidden border border-white/10">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-2.5 transition-all',
                viewMode === 'grid'
                  ? 'bg-gradient-primary text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              )}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-2.5 transition-all',
                viewMode === 'list'
                  ? 'bg-gradient-primary text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <Button
            variant="outline"
            onClick={loadPosts}
            disabled={loading}
            className="border-white/10 hover:border-purple-500/50 hover:bg-purple-500/10"
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
            Odswiez
          </Button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
          {error}
        </div>
      )}

      {/* Posts grid */}
      {viewMode === 'grid' ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {posts.map((post, index) => (
            <div
              key={post.id}
              className="animate-fade-in-up"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <PostCardGlass
                post={post}
                onEdit={() => openEditDialog(post)}
                onDelete={() => setDeleteTarget(post)}
                onToggleActive={() => handleToggleActive(post)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post, index) => (
            <div
              key={post.id}
              className="glass rounded-xl p-4 border border-white/10 hover:border-purple-500/30 transition-all duration-300 animate-fade-in-up flex items-center gap-4"
              style={{ animationDelay: `${index * 0.03}s` }}
            >
              {post.image && (
                <img
                  src={post.image}
                  alt=""
                  className="w-20 h-12 object-cover rounded-lg"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white truncate">{post.name || 'Bez nazwy'}</p>
                <p className="text-sm text-white/40 truncate">{post.url}</p>
              </div>
              <button
                onClick={() => handleToggleActive(post)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
                  post.active
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-white/5 text-white/40 border border-white/10'
                )}
              >
                {post.active ? 'Active' : 'Inactive'}
              </button>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/10"
                  onClick={() => openEditDialog(post)}
                >
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064l6.286-6.286z" />
                  </svg>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-pink-400/50 hover:text-pink-400 hover:bg-pink-500/10"
                  onClick={() => setDeleteTarget(post)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {posts.length === 0 && !loading && (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-primary/20 flex items-center justify-center mb-4">
            <Sparkles className="h-8 w-8 text-purple-400" />
          </div>
          <p className="text-white/70">Brak obserwowanych postow</p>
          <p className="text-sm text-white/40 mt-1">Dodaj pierwszy post powyzej</p>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editPost} onOpenChange={(open) => !open && setEditPost(null)}>
        <DialogContent className="bg-[#16161e]/95 backdrop-blur-xl border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="gradient-text">Edytuj post</DialogTitle>
            <DialogDescription className="text-white/50">
              Zmien dane obserwowanego posta
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label className="text-white/70">URL</Label>
              <Input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                className="bg-white/5 border-white/10 focus:border-purple-500/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white/70">Nazwa</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-white/5 border-white/10 focus:border-purple-500/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white/70">Obrazek</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="URL lub wybierz plik"
                  value={editImage}
                  onChange={(e) => {
                    setEditImage(e.target.value)
                    if (e.target.value) setEditImageFile(null)
                  }}
                  disabled={!!editImageFile}
                  className="bg-white/5 border-white/10 focus:border-purple-500/50"
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
                  <div className="h-9 w-9 flex items-center justify-center rounded-lg border border-white/10 hover:border-purple-500/50">
                    <Upload className="h-4 w-4" />
                  </div>
                </label>
              </div>
              {editImageFile && (
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span className="truncate">{editImageFile.name}</span>
                  <button onClick={() => setEditImageFile(null)} className="text-pink-400">
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
              className="border-white/10 hover:bg-white/5"
            >
              Anuluj
            </Button>
            <Button
              onClick={handleEdit}
              disabled={saving}
              className="bg-gradient-primary hover:opacity-90"
            >
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-[#16161e]/95 backdrop-blur-xl border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-pink-400">Usunac post?</DialogTitle>
            <DialogDescription className="text-white/50">
              Ta operacja jest nieodwracalna.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="py-4">
              <p className="font-medium">{deleteTarget.name || 'Bez nazwy'}</p>
              <p className="text-sm text-white/40 break-all mt-1">{deleteTarget.url}</p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-white/10 hover:bg-white/5"
            >
              Anuluj
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-pink-500 hover:bg-pink-600"
            >
              {deleting ? 'Usuwanie...' : 'Usun'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
