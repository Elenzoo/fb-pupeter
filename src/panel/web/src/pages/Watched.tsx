import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, ExternalLink, Copy, RefreshCw } from 'lucide-react'
import { getPosts, addPost, updatePost, deletePost } from '@/lib/api'
import type { Post } from '@/lib/types'

export function Watched() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Add form state
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [newImage, setNewImage] = useState('')
  const [newActive, setNewActive] = useState(true)
  const [adding, setAdding] = useState(false)

  // Edit dialog state
  const [editPost, setEditPost] = useState<Post | null>(null)
  const [editUrl, setEditUrl] = useState('')
  const [editName, setEditName] = useState('')
  const [editImage, setEditImage] = useState('')
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
      const result = await addPost({
        url: newUrl.trim(),
        name: newName.trim(),
        image: newImage.trim(),
        active: newActive,
      })

      if (result.ok) {
        showMessage('Post dodany', 'success')
        setNewUrl('')
        setNewName('')
        setNewImage('')
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
  }

  const handleEdit = async () => {
    if (!editPost) return

    setSaving(true)
    try {
      const result = await updatePost(editPost.id, {
        url: editUrl.trim(),
        name: editName.trim(),
        image: editImage.trim(),
      })

      if (result.ok) {
        showMessage('Zapisano zmiany', 'success')
        setEditPost(null)
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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showMessage('Skopiowano do schowka', 'success')
    } catch {
      showMessage('Nie udalo sie skopiowac', 'error')
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

      {/* Add form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Dodaj nowy post</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="newUrl">URL posta *</Label>
              <Input
                id="newUrl"
                placeholder="https://www.facebook.com/..."
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newName">Nazwa</Label>
              <Input
                id="newName"
                placeholder="Opcjonalna nazwa"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newImage">URL obrazka</Label>
              <Input
                id="newImage"
                placeholder="https://..."
                value={newImage}
                onChange={(e) => setNewImage(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="newActive"
                  checked={newActive}
                  onCheckedChange={(checked) => setNewActive(!!checked)}
                />
                <Label htmlFor="newActive">Aktywny</Label>
              </div>
              <Button onClick={handleAdd} disabled={adding}>
                <Plus className="h-4 w-4 mr-2" />
                {adding ? 'Dodawanie...' : 'Dodaj'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Posts table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Obserwowane posty ({posts.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={loadPosts} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Odswiez
          </Button>
        </CardHeader>
        <CardContent>
          {error && <p className="text-destructive mb-4">{error}</p>}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">ID</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Nazwa</TableHead>
                <TableHead className="w-[260px]">Obrazek</TableHead>
                <TableHead className="w-[80px]">Aktywny</TableHead>
                <TableHead className="w-[120px]">Akcje</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell className="font-mono text-xs">{post.id.slice(0, 6)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 max-w-md">
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline truncate text-sm"
                      >
                        {post.url}
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => copyToClipboard(post.url)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0"
                      >
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate">{post.name || '-'}</TableCell>
                  <TableCell>
                    {post.image ? (
                      <img
  src={post.image}
  alt=""
  className="w-[220px] h-[120px] object-contain rounded-md bg-black/20 transition-transform duration-200 hover:scale-[1.03] cursor-zoom-in"
/>

                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={post.active}
                      onCheckedChange={() => handleToggleActive(post)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditDialog(post)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(post)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {posts.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Brak obserwowanych postow. Dodaj pierwszy powyzej.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editPost} onOpenChange={(open) => !open && setEditPost(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edytuj post</DialogTitle>
            <DialogDescription>Zmien dane obserwowanego posta</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editUrl">URL</Label>
              <Input
                id="editUrl"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editName">Nazwa</Label>
              <Input
                id="editName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editImage">URL obrazka</Label>
              <Input
                id="editImage"
                value={editImage}
                onChange={(e) => setEditImage(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPost(null)}>
              Anuluj
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usunac post?</DialogTitle>
            <DialogDescription>Ta operacja jest nieodwracalna.</DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="py-4">
              <p className="font-medium">{deleteTarget.name || 'Bez nazwy'}</p>
              <p className="text-sm text-muted-foreground break-all mt-1">
                {deleteTarget.url}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Usuwanie...' : 'Usun'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
