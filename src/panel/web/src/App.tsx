import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Dashboard } from '@/pages/Dashboard'
import { Watched } from '@/pages/Watched'
import { Sources } from '@/pages/Sources'
import { Discoveries } from '@/pages/Discoveries'
import { Blacklist } from '@/pages/Blacklist'
import { Campaigns } from '@/pages/Campaigns'
import { Cookies } from '@/pages/Cookies'
import { Settings } from '@/pages/Settings'
import { Logs } from '@/pages/Logs'
import { Stats } from '@/pages/Stats'
import { DeadPosts } from '@/pages/DeadPosts'
import { Marketplace } from '@/pages/Marketplace'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter basename="/new">
          <Routes>
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/watched" element={<Watched />} />
              <Route path="/sources" element={<Sources />} />
              <Route path="/discoveries" element={<Discoveries />} />
              <Route path="/blacklist" element={<Blacklist />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/cookies" element={<Cookies />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/dead-posts" element={<DeadPosts />} />
              <Route path="/marketplace" element={<Marketplace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
