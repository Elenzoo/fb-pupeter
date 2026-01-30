import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Play, Square, RotateCw, Save, RefreshCw,
  ChevronDown, ChevronRight,
  Zap, User, Send, Shield, Terminal, Eye, Bot, Bell, Link, Moon, Search, Clock, Heart
} from 'lucide-react'
import { getEnv, setEnv, pm2Start, pm2Stop, pm2Restart } from '@/lib/api'
import type { EnvValues } from '@/lib/types'
import { cn } from '@/lib/utils'

// =============== KONFIGURACJA SEKCJI (PO POLSKU) ===============

interface FieldConfig {
  key: keyof EnvValues
  label: string
  type?: 'text' | 'password' | 'number' | 'switch' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  hint?: string
  unit?: 'ms_to_min'
}

interface SubSection {
  id: string
  title: string
  icon: React.ReactNode
  fields: FieldConfig[]
}

interface TabConfig {
  id: string
  label: string
  icon: React.ReactNode
  subsections: SubSection[]
}

const TABS: TabConfig[] = [
  {
    id: 'core',
    label: 'SYSTEM',
    icon: <Zap className="h-4 w-4" />,
    subsections: [
      {
        id: 'watcher',
        title: 'Monitoring',
        icon: <Eye className="h-4 w-4" />,
        fields: [
          { key: 'CHECK_INTERVAL_MS', label: 'Interwal sprawdzania', type: 'number', placeholder: '1', hint: 'Co ile minut sprawdzac posty', unit: 'ms_to_min' },
          { key: 'FAST_MODE', label: 'Tryb szybki', type: 'switch', hint: 'Sortowanie "Najnowsze" dla szybszego wykrywania' },
          { key: 'INCLUDE_REPLIES', label: 'Uwzglednij odpowiedzi', type: 'switch', hint: 'Monitoruj odpowiedzi na komentarze' },
        ],
      },
      {
        id: 'logging',
        title: 'Logi',
        icon: <Terminal className="h-4 w-4" />,
        fields: [
          {
            key: 'LOG_LEVEL',
            label: 'Poziom logow',
            type: 'select',
            options: [
              { value: 'silent', label: 'Cisza - brak logow' },
              { value: 'production', label: 'Produkcja - tylko wazne' },
              { value: 'dev', label: 'Deweloper - szczegolowe' },
              { value: 'debug', label: 'Debug - wszystko' },
            ],
          },
        ],
      },
      {
        id: 'puppeteer',
        title: 'Przegladarka',
        icon: <Eye className="h-4 w-4" />,
        fields: [
          { key: 'HEADLESS_BROWSER', label: 'Tryb ukryty', type: 'switch', hint: 'Uruchom bez widocznego okna' },
          { key: 'USE_UI_HANDLERS', label: 'UI Handlers', type: 'switch', hint: 'Uzywaj handlerow UI' },
          { key: 'COOKIES_READ_ONLY', label: 'Cookies tylko odczyt', type: 'switch', hint: 'Nie zapisuj zmian w cookies' },
        ],
      },
    ],
  },
  {
    id: 'facebook',
    label: 'FACEBOOK',
    icon: <User className="h-4 w-4" />,
    subsections: [
      {
        id: 'login',
        title: 'Logowanie',
        icon: <User className="h-4 w-4" />,
        fields: [
          { key: 'FB_EMAIL', label: 'Email', placeholder: 'email@example.com' },
          { key: 'FB_PASSWORD', label: 'Haslo', type: 'password', placeholder: '********' },
        ],
      },
      {
        id: 'sources',
        title: 'Zrodla postow',
        icon: <Link className="h-4 w-4" />,
        fields: [
          { key: 'POSTS_API_URL', label: 'API URL', placeholder: 'http://server:3180/api/posts', hint: 'Adres API panelu' },
          { key: 'POSTS_API_TOKEN', label: 'API Token', type: 'password', placeholder: 'fbw_xxx...' },
          { key: 'POSTS_SHEET_URL', label: 'Google Sheet', placeholder: 'https://docs.google.com/...', hint: 'Backup gdy API niedostepne' },
        ],
      },
    ],
  },
  {
    id: 'telegram',
    label: 'TELEGRAM',
    icon: <Send className="h-4 w-4" />,
    subsections: [
      {
        id: 'tg-owner',
        title: 'Wlasciciel',
        icon: <Send className="h-4 w-4" />,
        fields: [
          { key: 'TELEGRAM_SEND_TO_OWNER', label: 'Wysylaj powiadomienia', type: 'switch' },
          { key: 'TELEGRAM_BOT_TOKEN_OWNER', label: 'Bot Token', type: 'password', placeholder: '123456:ABC...' },
          { key: 'TELEGRAM_CHAT_ID_OWNER', label: 'Chat ID', placeholder: '123456789' },
        ],
      },
      {
        id: 'tg-client',
        title: 'Klient',
        icon: <Bot className="h-4 w-4" />,
        fields: [
          { key: 'TELEGRAM_SEND_TO_CLIENT', label: 'Wysylaj powiadomienia', type: 'switch' },
          { key: 'TELEGRAM_BOT_TOKEN_CLIENT', label: 'Bot Token', type: 'password', placeholder: '123456:ABC...' },
          { key: 'TELEGRAM_CHAT_ID_CLIENT', label: 'Chat ID', placeholder: '123456789' },
        ],
      },
      {
        id: 'tg-format',
        title: 'Format wiadomosci',
        icon: <Send className="h-4 w-4" />,
        fields: [
          { key: 'TELEGRAM_USE_PHOTO', label: 'Dolacz zdjecie', type: 'switch', hint: 'Wyslij miniature posta' },
          { key: 'TELEGRAM_DISABLE_WEB_PAGE_PREVIEW', label: 'Wylacz podglad', type: 'switch', hint: 'Ukryj podglad linku' },
        ],
      },
      {
        id: 'tg-alerts',
        title: 'Alerty o bledach',
        icon: <Bell className="h-4 w-4" />,
        fields: [
          { key: 'TG_ALERTS_ENABLED', label: 'Wlacz alerty', type: 'switch' },
          { key: 'TG_ALERTS_COOLDOWN_SEC', label: 'Przerwa (sek)', type: 'number', placeholder: '120', hint: 'Min. odstep miedzy alertami' },
          { key: 'TG_ALERTS_MAXLEN', label: 'Max dlugosc', type: 'number', placeholder: '3500' },
        ],
      },
    ],
  },
  {
    id: 'lite',
    label: 'LITE',
    icon: <Shield className="h-4 w-4" />,
    subsections: [
      {
        id: 'lite-human',
        title: 'Zachowanie czlowieka',
        icon: <Heart className="h-4 w-4" />,
        fields: [
          { key: 'HUMAN_MODE', label: 'Tryb ludzki', type: 'switch', hint: 'Symulacja zachowan czlowieka' },
          { key: 'HUMAN_RANDOM_LIKE_CHANCE', label: 'Szansa na like', type: 'number', placeholder: '0.20', hint: '0-1, np. 0.20 = 20%' },
          { key: 'WEBHOOK_MAX_AGE_MIN', label: 'Max wiek koment. (min)', type: 'number', placeholder: '60', hint: 'Fast mode + Webhook + Telegram' },
        ],
      },
      {
        id: 'lite-session',
        title: 'Sesje',
        icon: <Clock className="h-4 w-4" />,
        fields: [
          { key: 'SESSION_LENGTH_MIN_MS', label: 'Min dlugosc (min)', type: 'number', placeholder: '30', unit: 'ms_to_min' },
          { key: 'SESSION_LENGTH_MAX_MS', label: 'Max dlugosc (min)', type: 'number', placeholder: '90', unit: 'ms_to_min' },
          { key: 'WARMUP_ENABLED', label: 'Rozgrzewka', type: 'switch', hint: 'Naturalna aktywnosc przed praca' },
          { key: 'WARMUP_DURATION_MIN_MS', label: 'Min warmup (min)', type: 'number', placeholder: '5', unit: 'ms_to_min' },
          { key: 'WARMUP_DURATION_MAX_MS', label: 'Max warmup (min)', type: 'number', placeholder: '10', unit: 'ms_to_min' },
          { key: 'BETWEEN_POSTS_PAUSE_MIN_MS', label: 'Min przerwa miedzy postami (min)', type: 'number', placeholder: '1', unit: 'ms_to_min', hint: 'Minimalna pauza przed kolejnym postem' },
          { key: 'BETWEEN_POSTS_PAUSE_MAX_MS', label: 'Max przerwa miedzy postami (min)', type: 'number', placeholder: '3', unit: 'ms_to_min', hint: 'Maksymalna pauza przed kolejnym postem' },
        ],
      },
      {
        id: 'lite-antidetect',
        title: 'Anty-wykrywanie',
        icon: <Shield className="h-4 w-4" />,
        fields: [
          { key: 'VIEWPORT_RANDOMIZATION', label: 'Losowy viewport', type: 'switch', hint: 'Losowa rozdzielczosc' },
          { key: 'TYPING_MISTAKES_ENABLED', label: 'Literowki', type: 'switch', hint: 'Symulacja bledow pisania' },
          { key: 'TYPING_MISTAKES_CHANCE', label: 'Szansa literowki', type: 'number', placeholder: '0.03' },
          { key: 'NAVIGATION_MISTAKES_ENABLED', label: 'Bledy nawigacji', type: 'switch', hint: 'Cofanie, powroty' },
          { key: 'PROFILE_VISITS_ENABLED', label: 'Wizyty profili', type: 'switch', hint: 'Losowe odwiedziny' },
          { key: 'PROFILE_VISITS_CHANCE', label: 'Szansa wizyty', type: 'number', placeholder: '0.08' },
          { key: 'TAB_SIMULATION_ENABLED', label: 'Symulacja kart', type: 'switch', hint: 'Przelaczanie zakladek' },
          { key: 'TAB_SIMULATION_CHANCE', label: 'Szansa tab', type: 'number', placeholder: '0.10' },
          { key: 'IMAGE_INTERACTION_ENABLED', label: 'Interakcja ze zdj.', type: 'switch', hint: 'Hover i klik na foto' },
          { key: 'IMAGE_INTERACTION_CHANCE', label: 'Szansa zdjecie', type: 'number', placeholder: '0.15' },
        ],
      },
      {
        id: 'lite-night',
        title: 'Tryb nocny',
        icon: <Moon className="h-4 w-4" />,
        fields: [
          { key: 'NIGHT_MODE_ENABLED', label: 'Wlacz tryb nocny', type: 'switch', hint: 'Bot spi w nocy' },
          { key: 'NIGHT_START_HOUR', label: 'Poczatek nocy', type: 'number', placeholder: '22', hint: 'Godzina (0-23)' },
          { key: 'NIGHT_END_HOUR', label: 'Koniec nocy', type: 'number', placeholder: '7', hint: 'Godzina (0-23)' },
          { key: 'NIGHT_CATCHUP_HOURS', label: 'Catch-up (godz)', type: 'number', placeholder: '8' },
        ],
      },
      {
        id: 'lite-feed',
        title: 'Skaner tablicy',
        icon: <Search className="h-4 w-4" />,
        fields: [
          { key: 'FEED_SCAN_ENABLED', label: 'Wlacz skanowanie', type: 'switch', hint: 'Szukaj postow na tablicy' },
          { key: 'FEED_SCAN_KEYWORDS', label: 'Slowa kluczowe', placeholder: 'garaz,blaszany,hala', hint: 'Rozdziel przecinkami' },
          { key: 'FEED_SCROLL_DURATION_MIN', label: 'Min scroll (min)', type: 'number', placeholder: '1' },
          { key: 'FEED_SCROLL_DURATION_MAX', label: 'Max scroll (min)', type: 'number', placeholder: '3' },
          { key: 'DISCOVERY_TELEGRAM_ENABLED', label: 'Alert Telegram', type: 'switch', hint: 'Powiadom o wykryciu' },
        ],
      },
    ],
  },
]

// =============== HELPERY ===============

function isTruthy(val: string): boolean {
  return val === 'true' || val === '1' || val === 'yes'
}

function boolToEnv(val: boolean): string {
  return val ? 'true' : 'false'
}

function msToMin(ms: string): string {
  const num = parseInt(ms, 10)
  if (isNaN(num) || num === 0) return ''
  return String(Math.round(num / 60000))
}

function minToMs(min: string): string {
  const num = parseFloat(min)
  if (isNaN(num)) return ''
  return String(Math.round(num * 60000))
}

// =============== KOMPONENTY ===============

interface CyberFieldProps {
  field: FieldConfig
  value: string
  onChange: (value: string) => void
}

function CyberField({ field, value, onChange }: CyberFieldProps) {
  const displayValue = field.unit === 'ms_to_min' ? msToMin(value) : value

  const handleChange = (inputValue: string) => {
    if (field.unit === 'ms_to_min') {
      onChange(minToMs(inputValue))
    } else {
      onChange(inputValue)
    }
  }

  if (field.type === 'switch') {
    return (
      <div className="flex items-center justify-between py-2 border-b border-[#00ffff10] last:border-0">
        <div className="flex-1">
          <Label className="text-[#00ff66] text-sm">{field.label}</Label>
          {field.hint && <p className="text-[10px] text-[#00ffff60] mt-0.5">{field.hint}</p>}
        </div>
        <Switch
          checked={isTruthy(value)}
          onCheckedChange={(checked) => onChange(boolToEnv(checked))}
          className="data-[state=checked]:bg-[#00ff00] data-[state=unchecked]:bg-[#ff33cc40]"
        />
      </div>
    )
  }

  if (field.type === 'select' && field.options) {
    return (
      <div className="py-2 border-b border-[#00ffff10] last:border-0">
        <Label className="text-[#00ff66] text-sm block mb-1">{field.label}</Label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-9 bg-transparent border border-[#00ffff30] text-[#00ffff] text-sm px-2 focus:border-[#00ffff] focus:outline-none"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#09090b] text-[#00ff66]">
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="py-2 border-b border-[#00ffff10] last:border-0">
      <Label className="text-[#00ff66] text-sm block mb-1">{field.label}</Label>
      <Input
        type={field.type || 'text'}
        placeholder={field.placeholder}
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        className="bg-transparent border-[#00ffff30] text-[#00ffff] placeholder:text-[#00ffff40] focus:border-[#00ffff] h-9"
      />
      {field.hint && <p className="text-[10px] text-[#00ffff60] mt-1">{field.hint}</p>}
    </div>
  )
}

interface CollapsibleSubSectionProps {
  subsection: SubSection
  values: EnvValues
  onValueChange: (key: keyof EnvValues, value: string) => void
  defaultOpen?: boolean
}

function CollapsibleSubSection({ subsection, values, onValueChange, defaultOpen = false }: CollapsibleSubSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-[#00ffff20] mb-2">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
          open ? 'bg-[#00ffff15] text-[#00ffff]' : 'text-[#00ff6680] hover:text-[#00ffff] hover:bg-[#00ffff08]'
        )}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {subsection.icon}
        <span className="font-bold tracking-wider">{subsection.title.toUpperCase()}</span>
        <span className="text-[10px] text-[#00ffff40] ml-auto">{subsection.fields.length} pól</span>
      </button>
      {open && (
        <div className="px-3 py-2 bg-[#00ffff05]">
          {subsection.fields.map((field) => (
            <CyberField
              key={field.key}
              field={field}
              value={values[field.key] || ''}
              onChange={(val) => onValueChange(field.key, val)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// =============== GLOWNY KOMPONENT ===============

export function SettingsCyber() {
  const [values, setValues] = useState<EnvValues | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [pm2Loading, setPm2Loading] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('core')

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const loadEnv = async () => {
    setLoading(true)
    try {
      const result = await getEnv()
      if (result.ok) {
        setValues(result.values)
      } else {
        showMessage('BLAD: ' + (result.error || 'Nie udalo sie wczytac'), 'error')
      }
    } catch {
      showMessage('BLAD: Brak polaczenia', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEnv()
  }, [])

  const handleSave = async (restart = false) => {
    if (!values) return

    setSaving(true)
    try {
      const envRecord: Record<string, string> = {}
      for (const key of Object.keys(values) as (keyof typeof values)[]) {
        envRecord[key] = values[key]
      }
      const result = await setEnv(envRecord, restart)
      if (result.ok) {
        showMessage(restart ? 'OK: Zapisano i zrestartowano' : 'OK: Zapisano ustawienia', 'success')
      } else {
        showMessage('BLAD: ' + (result.error || 'Nie udalo sie zapisac'), 'error')
      }
    } catch {
      showMessage('BLAD: Brak polaczenia', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handlePm2Action = async (action: 'start' | 'stop' | 'restart') => {
    setPm2Loading(action)
    try {
      const fn = action === 'start' ? pm2Start : action === 'stop' ? pm2Stop : pm2Restart
      const result = await fn()
      if (result.ok) {
        const labels = { start: 'Uruchomiono', stop: 'Zatrzymano', restart: 'Zrestartowano' }
        showMessage('OK: ' + labels[action], 'success')
      } else {
        showMessage('BLAD: ' + (result.error || `Nie udalo sie ${action}`), 'error')
      }
    } catch {
      showMessage('BLAD: Brak polaczenia', 'error')
    } finally {
      setPm2Loading(null)
    }
  }

  const handleValueChange = (key: keyof EnvValues, value: string) => {
    if (!values) return
    setValues({ ...values, [key]: value })
  }

  const currentTab = TABS.find((t) => t.id === activeTab)

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Komunikat */}
      {message && (
        <div
          className={cn(
            'px-4 py-2 text-sm border animate-fade-in-up',
            message.type === 'success'
              ? 'bg-[#00ff0010] text-[#00ff00] border-[#00ff0040]'
              : 'bg-[#ff33cc10] text-[#ff33cc] border-[#ff33cc40]'
          )}
        >
          {'>'} {message.text}
        </div>
      )}

      {/* PM2 + Zapisz - sticky */}
      <div className="sticky top-0 z-20 bg-[#050505] border-b border-[#00ffff20] pb-3">
        {/* PM2 Controls */}
        <div className="flex items-center gap-2 mb-3 text-sm">
          <span className="text-[#00ffff60]">PM2:</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlePm2Action('start')}
            disabled={!!pm2Loading}
            className="text-[#00ff00] hover:bg-[#00ff0015] border border-[#00ff0030] h-7 px-2"
          >
            <Play className="h-3 w-3 mr-1" />
            {pm2Loading === 'start' ? '...' : 'START'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlePm2Action('stop')}
            disabled={!!pm2Loading}
            className="text-[#ff33cc] hover:bg-[#ff33cc15] border border-[#ff33cc30] h-7 px-2"
          >
            <Square className="h-3 w-3 mr-1" />
            {pm2Loading === 'stop' ? '...' : 'STOP'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlePm2Action('restart')}
            disabled={!!pm2Loading}
            className="text-[#ffff00] hover:bg-[#ffff0015] border border-[#ffff0030] h-7 px-2"
          >
            <RotateCw className="h-3 w-3 mr-1" />
            {pm2Loading === 'restart' ? '...' : 'RESTART'}
          </Button>

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={loadEnv}
            disabled={loading}
            className="text-[#00ffff] hover:bg-[#00ffff15] border border-[#00ffff30] h-7 px-2"
          >
            <RefreshCw className={cn('h-3 w-3 mr-1', loading && 'animate-spin')} />
            WCZYTAJ
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSave(false)}
            disabled={saving}
            className="text-[#00ff00] hover:bg-[#00ff0015] border border-[#00ff0030] h-7 px-2"
          >
            <Save className="h-3 w-3 mr-1" />
            {saving ? '...' : 'ZAPISZ'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSave(true)}
            disabled={saving}
            className="text-[#00ffff] hover:bg-[#00ffff15] border border-[#00ffff30] h-7 px-2"
          >
            <RotateCw className="h-3 w-3 mr-1" />
            ZAPISZ+RESTART
          </Button>
        </div>

        {/* Zakladki glowne */}
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-bold tracking-wider transition-all border-b-2',
                activeTab === tab.id
                  ? 'text-[#00ffff] border-[#00ffff] bg-[#00ffff10]'
                  : 'text-[#00ff6680] border-transparent hover:text-[#00ffff] hover:border-[#00ffff40]'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tresc zakladki */}
      {values && currentTab && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {currentTab.subsections.map((sub, idx) => (
            <div key={sub.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 0.05}s` }}>
              <CollapsibleSubSection
                subsection={sub}
                values={values}
                onValueChange={handleValueChange}
                defaultOpen={idx === 0}
              />
            </div>
          ))}
        </div>
      )}

      {!values && !loading && (
        <div className="text-center py-8 text-[#00ffff60]">
          {'>'} Nie udalo sie wczytac ustawien. Kliknij WCZYTAJ.
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-[#00ffff]">
          {'>'} Wczytywanie...
        </div>
      )}
    </div>
  )
}
