import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
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

export default function App() {
  return (
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
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
