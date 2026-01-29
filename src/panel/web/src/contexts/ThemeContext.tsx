import { createContext, useContext, useEffect, type ReactNode } from 'react'

// Tylko Cyberpunk - pozostałe motywy usunięte
export type Theme = 'cyberpunk'

interface ThemeContextType {
  theme: Theme
  themeName: string
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('dark', 'theme-cyberpunk')
  }, [])

  const value: ThemeContextType = {
    theme: 'cyberpunk',
    themeName: 'Cyberpunk',
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
