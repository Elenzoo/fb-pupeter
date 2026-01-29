import { useState, useEffect } from 'react'
import { Outlet, useLocation, NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  Home,
  Bell,
  Ban,
  Eye,
  Globe,
  Megaphone,
  Cookie,
  Settings,
  Terminal,
  Menu,
  X,
  Activity,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const PAGE_TITLES: Record<string, string> = {
  '/': 'PANEL',
  '/watched': 'OBSERWOWANE',
  '/sources': 'ZRODLA',
  '/discoveries': 'WYKRYCIA',
  '/blacklist': 'CZARNA_LISTA',
  '/campaigns': 'KAMPANIE',
  '/cookies': 'SESJE',
  '/settings': 'USTAWIENIA',
  '/logs': 'LOGI',
}

interface NavItem {
  to: string
  icon: React.ElementType
  label: string
  key: string
  disabled?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: Home, label: 'PANEL', key: 'h' },
  { to: '/watched', icon: Eye, label: 'OBSERWOWANE', key: 'w' },
  { to: '/discoveries', icon: Bell, label: 'WYKRYCIA', key: 'd' },
  { to: '/blacklist', icon: Ban, label: 'BLACKLIST', key: 'b' },
  { to: '/settings', icon: Settings, label: 'USTAWIENIA', key: 's' },
  { to: '/logs', icon: Terminal, label: 'LOGI', key: 'l' },
]

const NAV_ITEMS_SECONDARY: NavItem[] = [
  { to: '/sources', icon: Globe, label: 'ZRODLA', key: 'r', disabled: true },
  { to: '/campaigns', icon: Megaphone, label: 'KAMPANIE', key: 'c', disabled: true },
  { to: '/cookies', icon: Cookie, label: 'SESJE', key: 'e' },
]

interface CyberNavItemProps {
  to: string
  icon: React.ElementType
  label: string
  hotkey: string
  disabled?: boolean
  isActive: boolean
}

function CyberNavItem({ to, icon: Icon, label, hotkey, disabled, isActive }: CyberNavItemProps) {
  if (disabled) {
    return (
      <span className="flex items-center gap-1 px-2 py-1 text-[#00ffff30] cursor-not-allowed">
        <span className="text-[10px] opacity-50">[{hotkey}]</span>
        <Icon className="h-3 w-3" />
        <span className="text-xs">{label}</span>
      </span>
    )
  }

  return (
    <NavLink
      to={to}
      className={cn(
        'flex items-center gap-1 px-2 py-1 transition-all duration-200 relative',
        isActive
          ? 'text-[#00ffff] cyber-glow'
          : 'text-[#00ff6680] hover:text-[#00ffff]'
      )}
    >
      <span className="text-[10px] text-[#00ffff60]">[{hotkey}]</span>
      <Icon className="h-3 w-3" />
      <span className="text-xs font-bold tracking-wider">{label}</span>
      {isActive && (
        <span className="absolute bottom-0 left-0 right-0 h-[1px] bg-[#00ffff] shadow-neon-cyan" />
      )}
    </NavLink>
  )
}

function StatusIndicator({ label, value, status }: { label: string; value: string; status: 'ok' | 'warn' | 'error' }) {
  const colors = {
    ok: 'text-[#00ff00]',
    warn: 'text-[#ffff00]',
    error: 'text-[#ff33cc]',
  }

  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className="text-[#00ffff60]">{label}:</span>
      <span className={cn(colors[status], 'animate-pulse-glow')}>{value}</span>
    </div>
  )
}

export function CyberLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const [time, setTime] = useState(new Date())

  const pageTitle = PAGE_TITLES[location.pathname] || 'FB_WATCHER'

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if in input, textarea, or contenteditable
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('[role="dialog"]')
      ) {
        return
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return

      const allItems = [...NAV_ITEMS, ...NAV_ITEMS_SECONDARY]
      const item = allItems.find((i) => i.key === e.key.toLowerCase() && !i.disabled)

      if (item) {
        window.location.href = `/new${item.to}`
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const timeString = time.toLocaleTimeString('pl-PL', { hour12: false })
  const dateString = time.toLocaleDateString('pl-PL')

  return (
    <div className="min-h-screen bg-[#050505] text-[#00ff66] font-mono">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile menu */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-[#09090b] border-r border-[#00ffff30] transform transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-12 items-center justify-between px-4 border-b border-[#00ffff30]">
          <span className="text-[#00ffff] font-bold tracking-widest">MENU</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-[#00ffff]"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <nav className="p-4 space-y-1">
          {[...NAV_ITEMS, ...NAV_ITEMS_SECONDARY].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded transition-colors',
                  item.disabled && 'opacity-30 pointer-events-none',
                  isActive
                    ? 'bg-[#00ffff20] text-[#00ffff] border-l-2 border-[#00ffff]'
                    : 'text-[#00ff6680] hover:text-[#00ffff] hover:bg-[#00ffff10]'
                )
              }
            >
              <span className="text-[10px] text-[#00ffff60]">[{item.key}]</span>
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Main container */}
      <div className="flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-[#00ffff30] bg-[#09090b]/95 backdrop-blur">
          {/* ASCII art header line */}
          <div className="h-[2px] bg-gradient-to-r from-transparent via-[#00ffff] to-transparent opacity-50" />

          <div className="flex h-12 items-center gap-2 px-4">
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 md:hidden text-[#00ffff]"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            {/* Logo */}
            <div className="flex items-center gap-2 mr-4">
              <Eye className="h-5 w-5 text-[#00ffff] animate-pulse-glow" />
              <span className="font-bold tracking-widest text-[#00ffff] hidden sm:inline">
                FB_WATCHER
              </span>
            </div>

            {/* Navigation tabs (desktop) */}
            <nav className="hidden md:flex items-center gap-1 border-l border-[#00ffff30] pl-4">
              {NAV_ITEMS.map((item) => (
                <CyberNavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={item.label}
                  hotkey={item.key}
                  isActive={location.pathname === item.to}
                />
              ))}

              <span className="mx-2 text-[#00ffff30]">|</span>

              {NAV_ITEMS_SECONDARY.map((item) => (
                <CyberNavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  label={item.label}
                  hotkey={item.key}
                  disabled={item.disabled}
                  isActive={location.pathname === item.to}
                />
              ))}
            </nav>

            <div className="flex-1" />

            {/* Status indicators */}
            <div className="hidden lg:flex items-center gap-4 mr-4">
              <StatusIndicator label="SYS" value="ONLINE" status="ok" />
              <StatusIndicator label="MEM" value="OK" status="ok" />
              <Activity className="h-3 w-3 text-[#00ff00] animate-pulse" />
            </div>

            {/* Time display */}
            <div className="hidden sm:flex flex-col items-end text-[10px]">
              <span className="text-[#00ffff]">{timeString}</span>
              <span className="text-[#00ffff60]">{dateString}</span>
            </div>
          </div>

          <div className="h-[1px] bg-[#00ffff20]" />
        </header>

        {/* Page title bar */}
        <div className="border-b border-[#00ffff20] bg-[#09090b]/50 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[#00ffff60] text-xs">{'>'}</span>
            <span className="text-[#00ffff] font-bold tracking-widest text-sm terminal-cursor">
              {pageTitle}
            </span>
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6">
          <div className="cyber-corners">
            <Outlet />
          </div>
        </main>

        {/* Footer status bar */}
        <footer className="border-t border-[#00ffff20] bg-[#09090b]/80 px-4 py-2">
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-4">
              <span className="text-[#00ffff60]">TRYB:</span>
              <span className="text-[#00ff00]">NORMALNY</span>
              <span className="text-[#00ffff30]">|</span>
              <span className="text-[#00ffff60]">WERSJA:</span>
              <span className="text-[#00ffff]">2.0.0</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#00ffff40]">Nacisnij klawisz by nawigowac</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
