import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2, ExternalLink, Copy, Check } from 'lucide-react'
import type { Post } from '@/lib/types'

interface PostCardGlassProps {
  post: Post
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}

export function PostCardGlass({
  post,
  onEdit,
  onDelete,
  onToggleActive,
}: PostCardGlassProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(post.url)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = post.url
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silent fail
    }
  }

  return (
    <div
      className={cn(
        'group relative rounded-2xl overflow-hidden transition-all duration-300',
        'bg-[rgba(17,17,27,0.7)] backdrop-blur-xl',
        'border border-white/10 hover:border-white/20',
        'hover:shadow-xl hover:shadow-purple-500/10',
        'hover:-translate-y-1'
      )}
    >
      {/* Gradient border effect on hover */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 gradient-border pointer-events-none" />

      {/* Image */}
      <div className="relative aspect-video overflow-hidden">
        {post.image ? (
          <img
            src={post.image}
            alt={post.name || 'Post'}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
            <ExternalLink className="h-10 w-10 text-white/30" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#11111b] via-transparent to-transparent opacity-60" />

        {/* Action buttons on hover */}
        <div className="absolute inset-0 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/40">
          <Button
            size="icon"
            className="h-10 w-10 rounded-xl bg-white/10 backdrop-blur hover:bg-white/20 text-white border border-white/20"
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-10 w-10 rounded-xl bg-white/10 backdrop-blur hover:bg-white/20 text-white border border-white/20"
            onClick={copyToClipboard}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
          <a href={post.url} target="_blank" rel="noopener noreferrer">
            <Button
              size="icon"
              className="h-10 w-10 rounded-xl bg-white/10 backdrop-blur hover:bg-white/20 text-white border border-white/20"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </a>
          <Button
            size="icon"
            className="h-10 w-10 rounded-xl bg-red-500/20 backdrop-blur hover:bg-red-500/30 text-red-400 border border-red-500/30"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Status badge */}
        <div className="absolute top-3 right-3">
          <button
            onClick={onToggleActive}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300',
              'backdrop-blur-md border',
              post.active
                ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-400 border-green-500/30 shadow-lg shadow-green-500/20'
                : 'bg-white/5 text-white/50 border-white/10'
            )}
          >
            {post.active ? 'Active' : 'Inactive'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        <h3 className="font-semibold text-white truncate text-lg">
          {post.name || 'Bez nazwy'}
        </h3>
        <p className="text-sm text-white/50 truncate mt-1">{post.url}</p>
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-white/30 font-mono bg-white/5 px-2 py-1 rounded">
            #{post.id.slice(0, 8)}
          </span>
          <div className="flex items-center gap-1">
            {post.active && (
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
