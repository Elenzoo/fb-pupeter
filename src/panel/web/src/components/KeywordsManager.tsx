import { useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { X, Plus, Search } from 'lucide-react'

interface KeywordsManagerProps {
  keywords: string[]
  enabled: boolean
  loading?: boolean
  onAdd: (keyword: string) => Promise<void> | void
  onRemove: (keyword: string) => Promise<void> | void
  onToggle: (enabled: boolean) => Promise<void> | void
}

export function KeywordsManager({
  keywords,
  enabled,
  loading = false,
  onAdd,
  onRemove,
  onToggle,
}: KeywordsManagerProps) {
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return

    setIsSubmitting(true)
    try {
      await onAdd(trimmed)
      setInput('')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemove = async (keyword: string) => {
    await onRemove(keyword)
  }

  const handleToggle = async (checked: boolean) => {
    await onToggle(checked)
  }

  return (
    <div className="space-y-4">
      {/* Toggle włącz/wyłącz */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-secondary/50">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="feed-scan-toggle" className="font-medium cursor-pointer">
            Skanowanie tablicy
          </Label>
        </div>
        <Switch
          id="feed-scan-toggle"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={loading}
        />
      </div>

      {/* Input do dodawania */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Wpisz słowo lub frazę..."
          className="flex-1"
          disabled={loading || isSubmitting}
        />
        <Button
          type="submit"
          size="sm"
          disabled={loading || isSubmitting || !input.trim()}
          className="px-3"
        >
          <Plus className="h-4 w-4 mr-1" />
          Dodaj
        </Button>
      </form>

      {/* Lista keywords jako tagi */}
      <div className="flex flex-wrap gap-2 min-h-[40px]">
        {keywords.map((kw) => (
          <Badge
            key={kw}
            variant="secondary"
            className="px-3 py-1.5 text-sm bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-colors"
          >
            {kw}
            <button
              onClick={() => handleRemove(kw)}
              className="ml-2 hover:text-destructive transition-colors"
              disabled={loading}
              aria-label={`Usuń "${kw}"`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      {keywords.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
          Brak słów kluczowych. Dodaj pierwsze słowo lub frazę.
        </p>
      )}

      {/* Info o whole-word matching */}
      <p className="text-xs text-muted-foreground">
        Matching: całe słowa (np. "wiata" nie matchuje "świata").
        Frazy wielowyrazowe działają (np. "blaszany garaż").
      </p>
    </div>
  )
}
