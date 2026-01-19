import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MobileNav } from './MobileNav'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/watched': 'Obserwowane posty',
  '/sources': 'Zrodla',
  '/discoveries': 'Wykrycia',
  '/campaigns': 'Kampanie',
  '/cookies': 'Sesje / Cookies',
  '/settings': 'Ustawienia',
  '/logs': 'Logi',
}

export function DashboardLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const location = useLocation()

  const pageTitle = PAGE_TITLES[location.pathname] || 'FB Watcher'

  // Close mobile nav on route change
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      {/* Desktop sidebar */}
      <div className="hidden border-r bg-muted/40 md:block">
        <Sidebar />
      </div>

      {/* Mobile nav */}
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      {/* Main content */}
      <div className="flex flex-col">
        <Header title={pageTitle} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
