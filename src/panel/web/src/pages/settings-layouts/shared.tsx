import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  User, Bot, Zap, Terminal, Eye, Send, Bell, Link,
  Moon, Search, Shield, Clock, Heart
} from 'lucide-react'
import type { EnvValues } from '@/lib/types'

// Types
export interface FieldConfig {
  key: keyof EnvValues
  label: string
  type?: 'text' | 'password' | 'number' | 'switch' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  description?: string
  /** Konwersja ms na minuty - wyświetla minuty, zapisuje ms */
  unit?: 'ms_to_min'
}

export interface SectionConfig {
  id: string
  title: string
  icon: React.ReactNode
  description?: string
  fields: FieldConfig[]
}

export interface TabGroup {
  id: string
  label: string
  icon: React.ReactNode
  sections: string[] // section IDs
}

// Sections configuration
export const SECTIONS: SectionConfig[] = [
  {
    id: 'watcher',
    title: 'Watcher',
    icon: <Zap className="h-5 w-5" />,
    description: 'Ustawienia monitorowania komentarzy',
    fields: [
      { key: 'CHECK_INTERVAL_MS', label: 'Interwal sprawdzania (min)', type: 'number', placeholder: '1', description: 'Co ile minut sprawdzac posty', unit: 'ms_to_min' },
      { key: 'FAST_MODE', label: 'Fast Mode', type: 'switch', description: 'Sortowanie "Najnowsze" dla szybszego wykrywania' },
      { key: 'INCLUDE_REPLIES', label: 'Uwzglednij odpowiedzi', type: 'switch', description: 'Czy monitorowac odpowiedzi na komentarze' },
    ],
  },
  {
    id: 'logging',
    title: 'Logowanie',
    icon: <Terminal className="h-5 w-5" />,
    description: 'Poziom szczegolowosci logow',
    fields: [
      {
        key: 'LOG_LEVEL',
        label: 'Poziom logow',
        type: 'select',
        options: [
          { value: 'silent', label: 'Silent - brak logow' },
          { value: 'production', label: 'Production - tylko wazne' },
          { value: 'dev', label: 'Dev - szczegolowe' },
          { value: 'debug', label: 'Debug - wszystko' },
        ],
      },
    ],
  },
  {
    id: 'puppeteer',
    title: 'Puppeteer / Browser',
    icon: <Eye className="h-5 w-5" />,
    description: 'Ustawienia przegladarki',
    fields: [
      { key: 'HEADLESS_BROWSER', label: 'Tryb headless', type: 'switch', description: 'Uruchamiaj bez widocznego okna' },
      { key: 'USE_UI_HANDLERS', label: 'UI Handlers', type: 'switch', description: 'Uzywaj handlerow UI do interakcji' },
      { key: 'COOKIES_READ_ONLY', label: 'Cookies tylko do odczytu', type: 'switch', description: 'Nie zapisuj zmian w cookies' },
    ],
  },
  {
    id: 'facebook',
    title: 'Facebook',
    icon: <User className="h-5 w-5" />,
    description: 'Dane logowania do FB',
    fields: [
      { key: 'FB_EMAIL', label: 'Email', placeholder: 'email@example.com' },
      { key: 'FB_PASSWORD', label: 'Haslo', type: 'password', placeholder: '********' },
    ],
  },
  {
    id: 'sources',
    title: 'Zrodla postow',
    icon: <Link className="h-5 w-5" />,
    description: 'Skad pobierac liste postow',
    fields: [
      { key: 'POSTS_API_URL', label: 'API URL', placeholder: 'http://server:3180/api/posts', description: 'Remote API panelu' },
      { key: 'POSTS_API_TOKEN', label: 'API Token', type: 'password', placeholder: 'fbw_xxx...' },
      { key: 'POSTS_SHEET_URL', label: 'Google Sheet URL', placeholder: 'https://docs.google.com/...', description: 'Fallback gdy API niedostepne' },
    ],
  },
  {
    id: 'telegram-owner',
    title: 'Telegram - Wlasciciel',
    icon: <Send className="h-5 w-5" />,
    description: 'Powiadomienia do Ciebie',
    fields: [
      { key: 'TELEGRAM_SEND_TO_OWNER', label: 'Wysylaj do wlasciciela', type: 'switch' },
      { key: 'TELEGRAM_BOT_TOKEN_OWNER', label: 'Bot Token', type: 'password', placeholder: '123456:ABC...' },
      { key: 'TELEGRAM_CHAT_ID_OWNER', label: 'Chat ID', placeholder: '123456789' },
    ],
  },
  {
    id: 'telegram-client',
    title: 'Telegram - Klient',
    icon: <Bot className="h-5 w-5" />,
    description: 'Powiadomienia do klienta',
    fields: [
      { key: 'TELEGRAM_SEND_TO_CLIENT', label: 'Wysylaj do klienta', type: 'switch' },
      { key: 'TELEGRAM_BOT_TOKEN_CLIENT', label: 'Bot Token', type: 'password', placeholder: '123456:ABC...' },
      { key: 'TELEGRAM_CHAT_ID_CLIENT', label: 'Chat ID', placeholder: '123456789' },
    ],
  },
  {
    id: 'telegram-format',
    title: 'Telegram - Format',
    icon: <Send className="h-5 w-5" />,
    description: 'Formatowanie wiadomosci',
    fields: [
      { key: 'TELEGRAM_USE_PHOTO', label: 'Wysylaj ze zdjeciem', type: 'switch', description: 'Dolacz miniature posta' },
      { key: 'TELEGRAM_DISABLE_WEB_PAGE_PREVIEW', label: 'Wylacz podglad linkow', type: 'switch' },
    ],
  },
  {
    id: 'telegram-alerts',
    title: 'Telegram - Alerty',
    icon: <Bell className="h-5 w-5" />,
    description: 'Alerty o bledach z logow',
    fields: [
      { key: 'TG_ALERTS_ENABLED', label: 'Wlacz alerty', type: 'switch' },
      { key: 'TG_ALERTS_COOLDOWN_SEC', label: 'Cooldown (sek)', type: 'number', placeholder: '120', description: 'Minimalny odstep miedzy alertami' },
      { key: 'TG_ALERTS_MAXLEN', label: 'Max dlugosc', type: 'number', placeholder: '3500', description: 'Maksymalna dlugosc wiadomosci' },
    ],
  },
  {
    id: 'lite-human',
    title: 'LITE: Human Behavior',
    icon: <Heart className="h-5 w-5" />,
    description: 'Symulacja zachowan czlowieka',
    fields: [
      { key: 'HUMAN_MODE', label: 'Human Mode', type: 'switch', description: 'Wlacz symulacje zachowan czlowieka' },
      { key: 'HUMAN_RANDOM_LIKE_CHANCE', label: 'Szansa na losowy like', type: 'number', placeholder: '0.20', description: 'Szansa (0-1) na polubienie podczas sesji' },
      { key: 'WEBHOOK_MAX_AGE_MIN', label: 'Max wiek komentarzy (min)', type: 'number', placeholder: '60', description: 'Limit wieku dla: trybu Fast, Webhooka i Telegrama' },
    ],
  },
  {
    id: 'lite-session',
    title: 'LITE: Session Management',
    icon: <Clock className="h-5 w-5" />,
    description: 'Zarzadzanie dlugoscia sesji',
    fields: [
      { key: 'SESSION_LENGTH_MIN_MS', label: 'Min dlugosc sesji (min)', type: 'number', placeholder: '30', description: 'Minimalna dlugosc sesji', unit: 'ms_to_min' },
      { key: 'SESSION_LENGTH_MAX_MS', label: 'Max dlugosc sesji (min)', type: 'number', placeholder: '90', description: 'Maksymalna dlugosc sesji', unit: 'ms_to_min' },
      { key: 'WARMUP_ENABLED', label: 'Sesja rozgrzewkowa', type: 'switch', description: 'Rozgrzewka przed monitorowaniem' },
      { key: 'WARMUP_DURATION_MIN_MS', label: 'Min warmup (min)', type: 'number', placeholder: '5', description: 'Minimalny czas rozgrzewki', unit: 'ms_to_min' },
      { key: 'WARMUP_DURATION_MAX_MS', label: 'Max warmup (min)', type: 'number', placeholder: '10', description: 'Maksymalny czas rozgrzewki', unit: 'ms_to_min' },
    ],
  },
  {
    id: 'lite-antidetection',
    title: 'LITE: Anti-Detection',
    icon: <Shield className="h-5 w-5" />,
    description: 'Techniki ukrywania bota',
    fields: [
      { key: 'VIEWPORT_RANDOMIZATION', label: 'Losowy viewport', type: 'switch', description: 'Losowa rozdzielczosc przy kazdej sesji' },
      { key: 'TYPING_MISTAKES_ENABLED', label: 'Literowki', type: 'switch', description: 'Symulacja bledow przy pisaniu' },
      { key: 'TYPING_MISTAKES_CHANCE', label: 'Szansa literowki', type: 'number', placeholder: '0.03', description: 'Szansa (0-1) na literowke' },
      { key: 'NAVIGATION_MISTAKES_ENABLED', label: 'Bledy nawigacji', type: 'switch', description: 'Symulacja cofania/powrotu' },
      { key: 'PROFILE_VISITS_ENABLED', label: 'Odwiedzanie profili', type: 'switch', description: 'Losowe odwiedzanie profili' },
      { key: 'PROFILE_VISITS_CHANCE', label: 'Szansa wizyty', type: 'number', placeholder: '0.08', description: 'Szansa (0-1) na wizyte profilu' },
      { key: 'TAB_SIMULATION_ENABLED', label: 'Symulacja kart', type: 'switch', description: 'Symulacja przelaczania kart' },
      { key: 'TAB_SIMULATION_CHANCE', label: 'Szansa tab switch', type: 'number', placeholder: '0.10', description: 'Szansa (0-1) na przelaczenie karty' },
      { key: 'IMAGE_INTERACTION_ENABLED', label: 'Interakcja ze zdjeciami', type: 'switch', description: 'Hover i klik na zdjeciach' },
      { key: 'IMAGE_INTERACTION_CHANCE', label: 'Szansa na zdjecie', type: 'number', placeholder: '0.15', description: 'Szansa (0-1) na interakcje ze zdjeciem' },
    ],
  },
  {
    id: 'lite-night',
    title: 'LITE: Night Mode',
    icon: <Moon className="h-5 w-5" />,
    description: 'Tryb nocny - bot spi',
    fields: [
      { key: 'NIGHT_MODE_ENABLED', label: 'Wlacz tryb nocny', type: 'switch', description: 'Bot spi w nocy' },
      { key: 'NIGHT_START_HOUR', label: 'Poczatek nocy', type: 'number', placeholder: '22', description: 'Godzina rozpoczecia snu (0-23)' },
      { key: 'NIGHT_END_HOUR', label: 'Koniec nocy', type: 'number', placeholder: '7', description: 'Godzina przebudzenia (0-23)' },
      { key: 'NIGHT_CATCHUP_HOURS', label: 'Catch-up (godz)', type: 'number', placeholder: '8', description: 'Po ilu godzinach robic catch-up' },
    ],
  },
  {
    id: 'lite-feed',
    title: 'LITE: Feed Scanner',
    icon: <Search className="h-5 w-5" />,
    description: 'Skanowanie tablicy po slowach kluczowych',
    fields: [
      { key: 'FEED_SCAN_ENABLED', label: 'Wlacz skanowanie', type: 'switch', description: 'Skanuj tablice FB' },
      { key: 'FEED_SCAN_KEYWORDS', label: 'Slowa kluczowe', placeholder: 'garaz,blaszany,hala', description: 'Rozdzielone przecinkami' },
      { key: 'FEED_SCROLL_DURATION_MIN', label: 'Min czas scroll (min)', type: 'number', placeholder: '1', description: 'Minimalny czas scrollowania' },
      { key: 'FEED_SCROLL_DURATION_MAX', label: 'Max czas scroll (min)', type: 'number', placeholder: '3', description: 'Maksymalny czas scrollowania' },
      { key: 'DISCOVERY_TELEGRAM_ENABLED', label: 'Alert Telegram', type: 'switch', description: 'Wyslij alert przy nowym wykryciu' },
    ],
  },
]

// Tab groups configuration
export const TAB_GROUPS: TabGroup[] = [
  {
    id: 'core',
    label: 'Core',
    icon: <Zap className="h-4 w-4" />,
    sections: ['watcher', 'logging', 'puppeteer'],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    icon: <User className="h-4 w-4" />,
    sections: ['facebook', 'sources'],
  },
  {
    id: 'telegram',
    label: 'Telegram',
    icon: <Send className="h-4 w-4" />,
    sections: ['telegram-owner', 'telegram-client', 'telegram-format', 'telegram-alerts'],
  },
  {
    id: 'lite',
    label: 'LITE',
    icon: <Shield className="h-4 w-4" />,
    sections: ['lite-human', 'lite-session', 'lite-antidetection', 'lite-night', 'lite-feed'],
  },
]

// Helper functions
export function isTruthy(val: string): boolean {
  return val === 'true' || val === '1' || val === 'yes'
}

export function boolToEnv(val: boolean): string {
  return val ? 'true' : 'false'
}

// Konwersja ms <-> min
export function msToMin(ms: string): string {
  const num = parseInt(ms, 10)
  if (isNaN(num) || num === 0) return ''
  return String(Math.round(num / 60000))
}

export function minToMs(min: string): string {
  const num = parseFloat(min)
  if (isNaN(num)) return ''
  return String(Math.round(num * 60000))
}

export function getSectionById(id: string): SectionConfig | undefined {
  return SECTIONS.find(s => s.id === id)
}

export function getSectionsForGroup(groupId: string): SectionConfig[] {
  const group = TAB_GROUPS.find(g => g.id === groupId)
  if (!group) return []
  return group.sections
    .map(sectionId => getSectionById(sectionId))
    .filter((s): s is SectionConfig => s !== undefined)
}

// Shared render field function
interface RenderFieldProps {
  field: FieldConfig
  values: EnvValues
  onValueChange: (key: keyof EnvValues, value: string) => void
  onSwitchChange: (key: keyof EnvValues, checked: boolean) => void
}

export function renderField({ field, values, onValueChange, onSwitchChange }: RenderFieldProps) {
  const rawValue = values[field.key] || ''

  // Konwersja wyświetlanej wartości (ms -> min)
  const displayValue = field.unit === 'ms_to_min' ? msToMin(rawValue) : rawValue

  // Handler dla pól z konwersją (min -> ms przy zapisie)
  const handleChange = (inputValue: string) => {
    if (field.unit === 'ms_to_min') {
      onValueChange(field.key, minToMs(inputValue))
    } else {
      onValueChange(field.key, inputValue)
    }
  }

  if (field.type === 'switch') {
    return (
      <div key={field.key} className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label htmlFor={field.key}>{field.label}</Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
        <Switch
          id={field.key}
          checked={isTruthy(rawValue)}
          onCheckedChange={(checked) => onSwitchChange(field.key, checked)}
        />
      </div>
    )
  }

  if (field.type === 'select' && field.options) {
    return (
      <div key={field.key} className="space-y-2">
        <Label htmlFor={field.key}>{field.label}</Label>
        <select
          id={field.key}
          value={rawValue}
          onChange={(e) => onValueChange(field.key, e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div key={field.key} className="space-y-2">
      <Label htmlFor={field.key}>{field.label}</Label>
      <Input
        id={field.key}
        type={field.type || 'text'}
        placeholder={field.placeholder}
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
      />
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
    </div>
  )
}

// Layout types
export type SettingsLayout = 'vertical' | 'horizontal' | 'accordion'

export const LAYOUT_OPTIONS: { value: SettingsLayout; label: string }[] = [
  { value: 'vertical', label: 'Pionowe taby (Sidebar)' },
  { value: 'horizontal', label: 'Poziome taby' },
  { value: 'accordion', label: 'Accordion (rozwijane)' },
]
