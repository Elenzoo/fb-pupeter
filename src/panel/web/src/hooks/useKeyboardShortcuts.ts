import { useEffect, useCallback, useRef } from 'react'

interface ShortcutConfig {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  callback: () => void
  preventDefault?: boolean
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Ignore if user is typing in an input
    const target = event.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return
    }

    for (const shortcut of shortcutsRef.current) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase()
      const ctrlMatch = !!shortcut.ctrl === (event.ctrlKey || event.metaKey)
      const shiftMatch = !!shortcut.shift === event.shiftKey
      const altMatch = !!shortcut.alt === event.altKey

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        if (shortcut.preventDefault !== false) {
          event.preventDefault()
        }
        shortcut.callback()
        break
      }
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

// Navigation shortcuts hook for g+key pattern
export function useNavigationShortcuts() {
  const pendingG = useRef(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      if (event.key.toLowerCase() === 'g' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        pendingG.current = true
        // Clear after 1 second
        if (timeoutRef.current) {
          window.clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = window.setTimeout(() => {
          pendingG.current = false
        }, 1000)
        return
      }

      if (pendingG.current) {
        pendingG.current = false
        if (timeoutRef.current) {
          window.clearTimeout(timeoutRef.current)
        }

        const routes: Record<string, string> = {
          h: '/',        // g+h -> home/dashboard
          w: '/watched', // g+w -> watched
          d: '/discoveries',
          b: '/blacklist',
          s: '/settings',
          l: '/logs',
          c: '/cookies',
        }

        const key = event.key.toLowerCase()
        if (routes[key]) {
          event.preventDefault()
          window.location.href = `/new${routes[key]}`
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])
}

// Command palette trigger hook
export function useCommandPalette(onOpen: () => void) {
  useKeyboardShortcuts([
    {
      key: 'k',
      ctrl: true,
      callback: onOpen,
    },
  ])
}
