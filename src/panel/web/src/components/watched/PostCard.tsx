import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Pencil, Trash2, ExternalLink, Copy, Check } from 'lucide-react'
import type { Post } from '@/lib/types'

interface PostCardProps {
  post: Post
  selected: boolean
  onSelect: (selected: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}

export function PostCard({
  post,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onToggleActive,
}: PostCardProps) {
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)

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
        'group relative rounded-lg border bg-[#161b22] border-[#30363d] overflow-hidden transition-all duration-200',
        'hover:border-[#58a6ff]/50 hover:shadow-lg hover:shadow-[#58a6ff]/5',
        selected && 'border-[#58a6ff] ring-1 ring-[#58a6ff]/50'
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Selection checkbox */}
      <div className="absolute top-3 left-3 z-10">
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          className={cn(
            'h-5 w-5 border-2 transition-opacity',
            'data-[state=checked]:bg-[#58a6ff] data-[state=checked]:border-[#58a6ff]',
            !selected && !hovered && 'opacity-0 group-hover:opacity-100'
          )}
        />
      </div>

      {/* Image */}
      <div className="relative aspect-video bg-[#0d1117] overflow-hidden">
        {post.image ? (
          <img
            src={post.image}
            alt={post.name || 'Post'}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#8b949e]">
            <ExternalLink className="h-8 w-8" />
          </div>
        )}

        {/* Hover overlay */}
        <div
          className={cn(
            'absolute inset-0 bg-black/60 flex items-center justify-center gap-2 transition-opacity duration-200',
            hovered ? 'opacity-100' : 'opacity-0'
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 bg-white/10 hover:bg-white/20 text-white"
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 bg-white/10 hover:bg-white/20 text-white"
            onClick={copyToClipboard}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
          <a href={post.url} target="_blank" rel="noopener noreferrer">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 bg-white/10 hover:bg-white/20 text-white"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 bg-red-500/20 hover:bg-red-500/30 text-red-400"
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
              'px-2 py-1 rounded text-xs font-medium transition-colors',
              post.active
                ? 'bg-[#3fb950]/20 text-[#3fb950] hover:bg-[#3fb950]/30'
                : 'bg-[#8b949e]/20 text-[#8b949e] hover:bg-[#8b949e]/30'
            )}
          >
            {post.active ? 'Active' : 'Inactive'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-medium text-[#e6edf3] truncate">
          {post.name || 'Bez nazwy'}
        </h3>
        <p className="text-sm text-[#8b949e] truncate mt-1">{post.url}</p>
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-[#8b949e] font-mono">
            #{post.id.slice(0, 8)}
          </span>
        </div>
      </div>
    </div>
  )
}
