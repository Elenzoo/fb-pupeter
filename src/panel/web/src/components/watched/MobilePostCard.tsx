import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Pencil, Trash2, ExternalLink, Copy, Check, Circle } from 'lucide-react'
import type { Post } from '@/lib/types'

interface MobilePostCardProps {
  post: Post
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}

export function MobilePostCard({
  post,
  onEdit,
  onDelete,
  onToggleActive,
}: MobilePostCardProps) {
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
  const statusBg = post.active ? 'bg-[#00ff0015]' : 'bg-[#ff33cc15]'
  const statusBorder = post.active ? 'border-[#00ff0030]' : 'border-[#ff33cc30]'

  return (
    <div className="border border-[#00ffff20] bg-[#09090b] rounded-lg overflow-hidden">
      {/* Główna zawartość karty */}
      <div className="flex gap-3 p-3">
        {/* Miniatura */}
        <div className="w-16 h-16 shrink-0 rounded overflow-hidden bg-[#050505] border border-[#00ffff20]">
          {post.image ? (
            <img
              src={post.image}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#00ffff30] text-[8px]">
              NO_IMG
            </div>
          )}
        </div>

        {/* Informacje */}
        <div className="flex-1 min-w-0">
          {/* Nazwa i status */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className={cn(
                'text-sm font-medium truncate',
                post.name ? 'text-[#e6edf3]' : 'text-[#8b949e] italic'
              )}>
                {post.name || 'no_name'}
              </h3>
              <p className="text-[10px] text-[#00ffff60] truncate mt-0.5">
                {post.url}
              </p>
            </div>

            {/* Status badge */}
            <button
              onClick={onToggleActive}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border shrink-0 touch-manipulation',
                statusColor, statusBg, statusBorder
              )}
            >
              <Circle className={cn('h-2 w-2 fill-current', post.active && 'animate-pulse')} />
              {post.active ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* ID */}
          <p className="text-[10px] text-[#00ffff30] mt-1">
            ID: {post.id.slice(0, 8)}
          </p>
        </div>
      </div>

      {/* Przyciski akcji - zawsze widoczne na mobile */}
      <div className="flex items-center border-t border-[#00ffff15] divide-x divide-[#00ffff15]">
        <button
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-2 min-h-[44px] text-[#00ffff] hover:bg-[#00ffff10] active:bg-[#00ffff15] transition-colors touch-manipulation"
        >
          <Pencil className="h-4 w-4" />
          <span className="text-xs">Edytuj</span>
        </button>

        <button
          onClick={copyToClipboard}
          className="flex-1 flex items-center justify-center gap-2 min-h-[44px] text-[#00ffff] hover:bg-[#00ffff10] active:bg-[#00ffff15] transition-colors touch-manipulation"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-[#00ff00]" />
              <span className="text-xs text-[#00ff00]">Skopiowano</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span className="text-xs">Kopiuj</span>
            </>
          )}
        </button>

        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 min-h-[44px] text-[#00ffff] hover:bg-[#00ffff10] active:bg-[#00ffff15] transition-colors touch-manipulation"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="text-xs">Otwórz</span>
        </a>

        <button
          onClick={onDelete}
          className="flex-1 flex items-center justify-center gap-2 min-h-[44px] text-[#ff33cc] hover:bg-[#ff33cc10] active:bg-[#ff33cc15] transition-colors touch-manipulation"
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-xs">Usuń</span>
        </button>
      </div>
    </div>
  )
}

export default MobilePostCard
