import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  Home,
  Eye,
  Bell,
  Settings,
  MoreHorizontal,
  X,
  Ban,
  Terminal,
  Store,
  Cookie,
  Globe,
  Megaphone,
  BarChart3,
  Skull,
} from 'lucide-react'
import { useState } from 'react'

interface BottomNavItem {
  to: string
  icon: React.ElementType
  label: string
}

// Główne pozycje w bottom nav (max 5)
const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { to: '/', icon: Home, label: 'Panel' },
  { to: '/watched', icon: Eye, label: 'Obserwowane' },
  { to: '/discoveries', icon: Bell, label: 'Wykrycia' },
  { to: '/settings', icon: Settings, label: 'Ustawienia' },
]

// Pozostałe pozycje dostępne z "Więcej"
const MORE_NAV_ITEMS: BottomNavItem[] = [
  { to: '/stats', icon: BarChart3, label: 'Statystyki' },
  { to: '/dead-posts', icon: Skull, label: 'Martwe' },
  { to: '/blacklist', icon: Ban, label: 'Blacklist' },
  { to: '/logs', icon: Terminal, label: 'Logi' },
  { to: '/marketplace', icon: Store, label: 'Marketplace' },
  { to: '/cookies', icon: Cookie, label: 'Sesje' },
  { to: '/sources', icon: Globe, label: 'Źródła' },
  { to: '/campaigns', icon: Megaphone, label: 'Kampanie' },
]

interface BottomNavItemProps {
  to: string
  icon: React.ElementType
  label: string
  isActive: boolean
}

function BottomNavItemComponent({ to, icon: Icon, label, isActive }: BottomNavItemProps) {
  return (
    <NavLink
      to={to}
      className={cn(
        'flex flex-col items-center justify-center min-h-[56px] flex-1 px-1 py-2 transition-colors touch-manipulation tap-highlight',
        isActive
          ? 'text-[#00ffff]'
          : 'text-[#00ff6680] active:text-[#00ffff]'
      )}
    >
      <Icon className={cn(
        'h-6 w-6 mb-1',
        isActive && 'drop-shadow-[0_0_8px_rgba(0,255,255,0.8)]'
      )} />
      <span className={cn(
        'text-[10px] font-medium tracking-wide',
        isActive && 'text-[#00ffff]'
      )}>
        {label}
      </span>
      {isActive && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[#00ffff] shadow-neon-cyan" />
      )}
    </NavLink>
  )
}

export function BottomNav() {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  // Sprawdź czy któraś z pozycji "więcej" jest aktywna
  const isMoreActive = MORE_NAV_ITEMS.some(item => location.pathname === item.to)

  return (
    <nav className="bottom-nav bg-[#09090b]/95 backdrop-blur border-t border-[#00ffff30]">
      {/* Gradient line na górze */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#00ffff50] to-transparent" />

      <div className="flex items-stretch justify-around max-w-lg mx-auto relative">
        {BOTTOM_NAV_ITEMS.map((item) => (
          <BottomNavItemComponent
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            isActive={location.pathname === item.to}
          />
        ))}

        {/* Przycisk "Więcej" */}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex flex-col items-center justify-center min-h-[56px] flex-1 px-1 py-2 transition-colors touch-manipulation tap-highlight relative',
            isMoreActive
              ? 'text-[#00ffff]'
              : 'text-[#00ff6680] active:text-[#00ffff]'
          )}
        >
          <MoreHorizontal className={cn(
            'h-6 w-6 mb-1',
            isMoreActive && 'drop-shadow-[0_0_8px_rgba(0,255,255,0.8)]'
          )} />
          <span className={cn(
            'text-[10px] font-medium tracking-wide',
            isMoreActive && 'text-[#00ffff]'
          )}>
            Więcej
          </span>
          {isMoreActive && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[#00ffff] shadow-neon-cyan" />
          )}
        </button>
      </div>

      {/* Bottom Sheet dla "Więcej" */}
      {moreOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
            onClick={() => setMoreOpen(false)}
          />

          {/* Sheet */}
          <div className="fixed inset-x-0 bottom-0 z-50 bg-[#09090b] border-t border-[#00ffff30] rounded-t-2xl pb-safe animate-slide-up">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-[#00ffff30] rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3 border-b border-[#00ffff20]">
              <span className="text-[#00ffff] font-bold tracking-widest">WIĘCEJ OPCJI</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-2 text-[#00ffff60] hover:text-[#00ffff] touch-manipulation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Grid nawigacji */}
            <nav className="grid grid-cols-3 gap-2 p-4">
              {MORE_NAV_ITEMS.map((item) => {
                const isActive = location.pathname === item.to
                const isDisabled = item.to === '/sources' || item.to === '/campaigns'

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => !isDisabled && setMoreOpen(false)}
                    className={cn(
                      'flex flex-col items-center justify-center min-h-[72px] p-3 rounded-lg transition-colors touch-manipulation',
                      isDisabled && 'opacity-30 pointer-events-none',
                      isActive
                        ? 'bg-[#00ffff20] text-[#00ffff] border border-[#00ffff50]'
                        : 'text-[#00ff6680] active:bg-[#00ffff10]'
                    )}
                  >
                    <item.icon className={cn(
                      'h-7 w-7 mb-2',
                      isActive && 'drop-shadow-[0_0_8px_rgba(0,255,255,0.8)]'
                    )} />
                    <span className="text-xs font-medium">{item.label}</span>
                  </NavLink>
                )
              })}
            </nav>
          </div>
        </>
      )}
    </nav>
  )
}

export default BottomNav
