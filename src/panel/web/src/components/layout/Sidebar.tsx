import { NavLink } from 'react-router-dom'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface NavItemProps {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
  disabled?: boolean
}

function NavItem({ to, icon, label, badge, disabled }: NavItemProps) {
  if (disabled) {
    return (
      <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground/50 cursor-not-allowed">
        {icon}
        <span className="flex-1">{label}</span>
        <Badge variant="outline" className="text-xs opacity-50">
          Wkrotce
        </Badge>
      </div>
    )
  }

  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
          isActive
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:bg-secondary/50 hover:text-secondary-foreground'
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <Badge variant="destructive" className="text-xs">
          {badge}
        </Badge>
      )}
    </NavLink>
  )
}

interface SidebarProps {
  className?: string
}

export function Sidebar({ className }: SidebarProps) {
  return (
    <div className={cn('flex h-full flex-col gap-2', className)}>
      <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
        <span className="flex items-center gap-2 font-semibold">
          <Eye className="h-6 w-6" />
          <span>FB Watcher</span>
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <nav className="grid items-start gap-1 px-2 text-sm font-medium lg:px-4">
          <div className="py-2">
            <p className="px-3 text-xs font-semibold uppercase text-muted-foreground/70 tracking-wider">
              Glowne
            </p>
          </div>
          <NavItem to="/" icon={<Home className="h-4 w-4" />} label="Dashboard" />
          <NavItem
            to="/discoveries"
            icon={<Bell className="h-4 w-4" />}
            label="Wykrycia"
          />
          <NavItem
            to="/blacklist"
            icon={<Ban className="h-4 w-4" />}
            label="Blacklist"
          />

          <Separator className="my-3" />

          <div className="py-2">
            <p className="px-3 text-xs font-semibold uppercase text-muted-foreground/70 tracking-wider">
              Monitoring
            </p>
          </div>
          <NavItem to="/watched" icon={<Eye className="h-4 w-4" />} label="Obserwowane" />
          <NavItem
            to="/sources"
            icon={<Globe className="h-4 w-4" />}
            label="Zrodla"
            disabled
          />

          <Separator className="my-3" />

          <div className="py-2">
            <p className="px-3 text-xs font-semibold uppercase text-muted-foreground/70 tracking-wider">
              Automatyzacja
            </p>
          </div>
          <NavItem
            to="/campaigns"
            icon={<Megaphone className="h-4 w-4" />}
            label="Kampanie"
            disabled
          />

          <Separator className="my-3" />

          <div className="py-2">
            <p className="px-3 text-xs font-semibold uppercase text-muted-foreground/70 tracking-wider">
              System
            </p>
          </div>
          <NavItem to="/cookies" icon={<Cookie className="h-4 w-4" />} label="Sesje" />
          <NavItem to="/settings" icon={<Settings className="h-4 w-4" />} label="Ustawienia" />
          <NavItem to="/logs" icon={<Terminal className="h-4 w-4" />} label="Logi" />
        </nav>
      </div>
    </div>
  )
}
