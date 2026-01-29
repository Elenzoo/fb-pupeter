import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RefreshCw, Upload } from 'lucide-react'
import { getPosts, addPost, updatePost, deletePost, uploadImage } from '@/lib/api'
import type { Post } from '@/lib/types'
import { PostRow } from '@/components/watched/PostRow'
import { cn } from '@/lib/utils'

export function WatchedCyber() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Selection for vim-style navigation
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Quick add form (terminal style)
  const [showAdd, setShowAdd] = useState(false)
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
        setError(result.error || 'FETCH_ERROR')
      }
    } catch {
      setError('CONNECTION_FAILED')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  // Vim-style keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If any form/dialog is open, only handle Escape
      if (showAdd || editPost || deleteTarget) {
        if (e.key === 'Escape') {
          setShowAdd(false)
          setEditPost(null)
          setDeleteTarget(null)
        }
        return
      }

      // Ignore if in any input element
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, posts.length - 1))
          break
        case 'k':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'g':
          if (e.shiftKey) {
            e.preventDefault()
            setSelectedIndex(posts.length - 1)
          } else {
            e.preventDefault()
            setSelectedIndex(0)
          }
          break
        case 'a':
          e.preventDefault()
          setShowAdd(true)
          break
        case 'enter':
          e.preventDefault()
          if (posts[selectedIndex]) {
            window.open(posts[selectedIndex].url, '_blank')
          }
          break
        case 'e':
          e.preventDefault()
          if (posts[selectedIndex]) {
            openEditDialog(posts[selectedIndex])
          }
          break
        case 'd':
          e.preventDefault()
          if (posts[selectedIndex]) {
            setDeleteTarget(posts[selectedIndex])
          }
          break
        case 'x':
          e.preventDefault()
          if (posts[selectedIndex]) {
            handleToggleActive(posts[selectedIndex])
          }
          break
        case 'r':
          e.preventDefault()
          loadPosts()
          break
        case 'escape':
          setShowAdd(false)
          setEditPost(null)
          setDeleteTarget(null)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [posts, selectedIndex, loadPosts, showAdd, editPost, deleteTarget])

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleAdd = async () => {
    if (!newUrl.trim()) {
      showMessage('ERR: URL_REQUIRED', 'error')
      return
    }

    setAdding(true)
    try {
      let imagePath = newImage.trim()

      if (newImageFile) {
        const uploadResult = await uploadImage(newImageFile)
        if (!uploadResult.ok) {
          showMessage('ERR: UPLOAD_FAILED', 'error')
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
        showMessage('OK: POST_ADDED', 'success')
        setNewUrl('')
        setNewName('')
        setNewImage('')
        setNewImageFile(null)
        setNewActive(true)
        setShowAdd(false)
        loadPosts()
      } else {
        showMessage('ERR: ' + (result.error || 'ADD_FAILED'), 'error')
      }
    } catch {
      showMessage('ERR: CONNECTION_FAILED', 'error')
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
        showMessage('ERR: TOGGLE_FAILED', 'error')
      }
    } catch {
      showMessage('ERR: CONNECTION_FAILED', 'error')
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
          showMessage('ERR: UPLOAD_FAILED', 'error')
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
        showMessage('OK: POST_UPDATED', 'success')
        setEditPost(null)
        setEditImageFile(null)
        loadPosts()
      } else {
        showMessage('ERR: UPDATE_FAILED', 'error')
      }
    } catch {
      showMessage('ERR: CONNECTION_FAILED', 'error')
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
        showMessage('OK: POST_DELETED', 'success')
        setDeleteTarget(null)
        loadPosts()
      } else {
        showMessage('ERR: DELETE_FAILED', 'error')
      }
    } catch {
      showMessage('ERR: CONNECTION_FAILED', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const activePosts = posts.filter((p) => p.active).length

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Message toast */}
      {message && (
        <div
          className={cn(
            'px-4 py-2 text-sm border animate-fade-in-up',
            message.type === 'success'
              ? 'bg-[#00ff0010] text-[#00ff00] border-[#00ff0040]'
              : 'bg-[#ff33cc10] text-[#ff33cc] border-[#ff33cc40]'
          )}
        >
          {'>'} {message.text}
        </div>
      )}

      {/* Terminal header */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4 text-[#00ffff]">
          <span>RAZEM: <span className="text-[#00ff00]">{posts.length}</span></span>
          <span className="text-[#00ffff40]">|</span>
          <span>AKTYWNE: <span className="text-[#00ff00]">{activePosts}</span></span>
          <span className="text-[#00ffff40]">|</span>
          <span>NIEAKTYWNE: <span className="text-[#ff33cc]">{posts.length - activePosts}</span></span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadPosts}
            disabled={loading}
            className="text-[#00ffff] hover:text-[#00ff00] hover:bg-[#00ff0010] border border-[#00ffff30]"
          >
            <RefreshCw className={cn('h-3 w-3 mr-2', loading && 'animate-spin')} />
            [r]ODSWIEZ
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdd(!showAdd)}
            className="text-[#00ff00] hover:text-[#00ffff] hover:bg-[#00ffff10] border border-[#00ff0030]"
          >
            [a]DODAJ
          </Button>
        </div>
      </div>

      {/* Inline Add Form (terminal style) */}
      {showAdd && (
        <div className="border border-[#00ffff30] bg-[#09090b] p-4 animate-fade-in-up">
          <div className="text-[#00ffff] text-xs mb-3">{'>'} NOWY_POST</div>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <div className="text-[10px] text-[#00ffff60] mb-1">URL *</div>
              <Input
                placeholder="https://facebook.com/..."
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="bg-transparent border-[#00ffff30] text-[#00ff66] placeholder:text-[#00ff6640] font-mono text-sm"
              />
            </div>
            <div>
              <div className="text-[10px] text-[#00ffff60] mb-1">NAZWA</div>
              <Input
                placeholder="opcjonalna"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="bg-transparent border-[#00ffff30] text-[#00ff66] placeholder:text-[#00ff6640] font-mono text-sm"
              />
            </div>
            <div>
              <div className="text-[10px] text-[#00ffff60] mb-1">OBRAZEK</div>
              <div className="flex gap-2">
                <Input
                  placeholder="url lub plik"
                  value={newImage}
                  onChange={(e) => {
                    setNewImage(e.target.value)
                    if (e.target.value) setNewImageFile(null)
                  }}
                  disabled={!!newImageFile}
                  className="bg-transparent border-[#00ffff30] text-[#00ff66] placeholder:text-[#00ff6640] font-mono text-sm"
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
                  <div className="h-9 w-9 flex items-center justify-center border border-[#00ffff30] text-[#00ffff60] hover:text-[#00ffff] hover:border-[#00ffff]">
                    <Upload className="h-4 w-4" />
                  </div>
                </label>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={() => setNewActive(!newActive)}
                className={cn(
                  'px-3 py-2 text-xs border transition-colors',
                  newActive
                    ? 'border-[#00ff0040] text-[#00ff00] bg-[#00ff0010]'
                    : 'border-[#ff33cc40] text-[#ff33cc] bg-[#ff33cc10]'
                )}
              >
                {newActive ? '[x] AKTYWNY' : '[ ] NIEAKTYWNY'}
              </button>
              <Button
                onClick={handleAdd}
                disabled={adding}
                className="bg-[#00ff0020] hover:bg-[#00ff0030] text-[#00ff00] border border-[#00ff0040]"
              >
                {adding ? 'DODAWANIE...' : 'DODAJ'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowAdd(false)}
                className="text-[#ff33cc] hover:text-[#ff33cc] hover:bg-[#ff33cc10]"
              >
                [ESC]
              </Button>
            </div>
          </div>
          {newImageFile && (
            <div className="flex items-center gap-2 mt-2 text-xs text-[#00ffff60]">
              PLIK: {newImageFile.name}
              <button onClick={() => setNewImageFile(null)} className="text-[#ff33cc]">
                [x]
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 border border-[#ff33cc40] bg-[#ff33cc10] text-[#ff33cc] text-sm">
          {'>'} ERROR: {error}
        </div>
      )}

      {/* Help bar */}
      <div className="text-[10px] text-[#00ffff40] flex items-center gap-4">
        <span>[j/k] gora/dol</span>
        <span>[g/G] poczatek/koniec</span>
        <span>[enter] otworz</span>
        <span>[e] edytuj</span>
        <span>[d] usun</span>
        <span>[x] przelacz</span>
        <span>[a] dodaj</span>
        <span>[r] odswiez</span>
      </div>

      {/* Posts list (terminal style) */}
      <div className="border border-[#00ffff20] bg-[#09090b]">
        {/* Header row */}
        <div className="flex items-center gap-4 px-4 py-2 text-[10px] text-[#00ffff60] border-b border-[#00ffff20] bg-[#00ffff08]">
          <span className="w-8 text-right">#</span>
          <span className="w-14">STATUS</span>
          <span className="w-48">NAZWA</span>
          <span className="flex-1">URL</span>
          <span className="w-24">PODGLAD</span>
          <span className="w-20">ID</span>
          <span className="w-28">AKCJE</span>
        </div>

        {/* Data rows */}
        {posts.map((post, index) => (
          <PostRow
            key={post.id}
            post={post}
            index={index}
            isSelected={index === selectedIndex}
            onSelect={() => setSelectedIndex(index)}
            onEdit={() => openEditDialog(post)}
            onDelete={() => setDeleteTarget(post)}
            onToggleActive={() => handleToggleActive(post)}
          />
        ))}

        {posts.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-[#00ffff60]">
            {'>'} BRAK_POSTOW. Nacisnij [a] zeby dodac nowy post.
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editPost} onOpenChange={(open) => !open && setEditPost(null)}>
        <DialogContent className="bg-[#09090b] border-[#00ffff30] text-[#00ff66] font-mono">
          <DialogHeader>
            <DialogTitle className="text-[#00ffff]">EDYTUJ_POST</DialogTitle>
            <DialogDescription className="text-[#00ffff60]">
              Zmien dane obserwowanego posta
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <div className="text-[10px] text-[#00ffff60] mb-1">URL</div>
              <Input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                className="bg-transparent border-[#00ffff30] text-[#00ff66]"
              />
            </div>
            <div>
              <div className="text-[10px] text-[#00ffff60] mb-1">NAZWA</div>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-transparent border-[#00ffff30] text-[#00ff66]"
              />
            </div>
            <div>
              <div className="text-[10px] text-[#00ffff60] mb-1">OBRAZEK</div>
              <div className="flex gap-2">
                <Input
                  value={editImage}
                  onChange={(e) => {
                    setEditImage(e.target.value)
                    if (e.target.value) setEditImageFile(null)
                  }}
                  disabled={!!editImageFile}
                  className="bg-transparent border-[#00ffff30] text-[#00ff66]"
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
                  <div className="h-9 w-9 flex items-center justify-center border border-[#00ffff30] text-[#00ffff]">
                    <Upload className="h-4 w-4" />
                  </div>
                </label>
              </div>
              {editImageFile && (
                <div className="flex items-center gap-2 mt-1 text-xs text-[#00ffff60]">
                  PLIK: {editImageFile.name}
                  <button onClick={() => setEditImageFile(null)} className="text-[#ff33cc]">
                    [x]
                  </button>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditPost(null)}
              className="text-[#00ffff60] hover:text-[#00ffff] border border-[#00ffff30]"
            >
              ANULUJ
            </Button>
            <Button
              onClick={handleEdit}
              disabled={saving}
              className="bg-[#00ff0020] text-[#00ff00] border border-[#00ff0040] hover:bg-[#00ff0030]"
            >
              {saving ? 'ZAPISYWANIE...' : 'ZAPISZ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-[#09090b] border-[#ff33cc30] text-[#00ff66] font-mono">
          <DialogHeader>
            <DialogTitle className="text-[#ff33cc]">POTWIERDZ_USUNIECIE</DialogTitle>
            <DialogDescription className="text-[#ff33cc80]">
              Ta operacja jest nieodwracalna
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="py-4 text-sm">
              <div className="text-[#00ffff60]">CEL:</div>
              <div className="text-[#00ff66] mt-1">{deleteTarget.name || 'BRAK_NAZWY'}</div>
              <div className="text-[#00ffff60] break-all mt-1 text-xs">{deleteTarget.url}</div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              className="text-[#00ffff60] hover:text-[#00ffff] border border-[#00ffff30]"
            >
              ANULUJ
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-[#ff33cc20] text-[#ff33cc] border border-[#ff33cc40] hover:bg-[#ff33cc30]"
            >
              {deleting ? 'USUWANIE...' : 'USUN'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
