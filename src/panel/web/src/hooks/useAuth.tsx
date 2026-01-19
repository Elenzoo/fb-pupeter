import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { getToken, setToken as saveToken } from '@/lib/api'

interface AuthContextValue {
  token: string
  setToken: (token: string) => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(() => getToken())

  const setToken = useCallback((newToken: string) => {
    saveToken(newToken)
    setTokenState(newToken)
  }, [])

  const value: AuthContextValue = {
    token,
    setToken,
    isAuthenticated: token.length > 0,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
