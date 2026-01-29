import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Pencil, Trash2, ExternalLink, Copy, Check, Circle } from 'lucide-react'
import type { Post } from '@/lib/types'

interface PostRowProps {
  post: Post
  index: number
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}

export function PostRow({
  post,
  index,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onToggleActive,
}: PostRowProps) {
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

  const statusColor = post.active ? 'text-[#00ff00]' : 'text-[#ff33cc]'
  const statusText = post.active ? 'ON ' : 'OFF'

  return (
    <div
      className={cn(
        'group flex items-center gap-4 px-4 py-2 font-mono text-sm transition-colors cursor-pointer',
        'border-b border-[#00ffff15]',
        isSelected
          ? 'bg-[#00ffff15] text-[#00ffff]'
          : 'hover:bg-[#00ffff08] text-[#00ff66]'
      )}
      onClick={onSelect}
    >
      {/* Index */}
      <span className="w-8 text-[#00ffff40] text-right">{String(index + 1).padStart(3, '0')}</span>

      {/* Status indicator */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggleActive()
        }}
        className={cn('flex items-center gap-1', statusColor)}
        title={post.active ? 'Kliknij aby wylaczyc' : 'Kliknij aby wlaczyc'}
      >
        <Circle className={cn('h-2 w-2 fill-current', post.active && 'animate-pulse')} />
        <span className="text-[10px] tracking-wider">{statusText}</span>
      </button>

      {/* Name/Title */}
      <div className="w-48 truncate">
        <span className={cn('text-[#e6edf3]', !post.name && 'text-[#8b949e] italic')}>
          {post.name || 'no_name'}
        </span>
      </div>

      {/* URL */}
      <div className="flex-1 truncate">
        <span className="text-[#00ffff80]">{post.url}</span>
      </div>

      {/* Preview thumbnail */}
      <div className="w-24 h-16 rounded overflow-hidden bg-[#09090b] border border-[#00ffff20]">
        {post.image ? (
          <img
            src={post.image}
            alt=""
            className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#00ffff30] text-[8px]">
            NO_IMG
          </div>
        )}
      </div>

      {/* ID */}
      <span className="w-20 text-[#00ffff40] text-xs">
        {post.id.slice(0, 8)}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="p-1.5 text-[#00ffff] hover:text-[#00ff00] hover:bg-[#00ff0020] rounded transition-colors"
          title="[e]dit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            copyToClipboard()
          }}
          className="p-1.5 text-[#00ffff] hover:text-[#00ff00] hover:bg-[#00ff0020] rounded transition-colors"
          title="[c]opy"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 text-[#00ffff] hover:text-[#00ff00] hover:bg-[#00ff0020] rounded transition-colors"
          title="[o]pen"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1.5 text-[#ff33cc] hover:text-[#ff33cc] hover:bg-[#ff33cc20] rounded transition-colors"
          title="[d]elete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
