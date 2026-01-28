import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Play, Square, RotateCw, Save, RefreshCw,
  User, Bot, Zap, Terminal, Eye, Send, Bell, Link,
  Moon, Search, Shield, Clock, Heart
} from 'lucide-react'
import { getEnv, setEnv, pm2Start, pm2Stop, pm2Restart } from '@/lib/api'
import type { EnvValues } from '@/lib/types'

interface FieldConfig {
  key: keyof EnvValues
  label: string
  type?: 'text' | 'password' | 'number' | 'switch' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  description?: string
}

interface SectionConfig {
  title: string
  icon: React.ReactNode
  description?: string
  fields: FieldConfig[]
}

const SECTIONS: SectionConfig[] = [
  {
    title: 'Watcher',
    icon: <Zap className="h-5 w-5" />,
    description: 'Ustawienia monitorowania komentarzy',
    fields: [
      { key: 'CHECK_INTERVAL_MS', label: 'Interwal sprawdzania (ms)', type: 'number', placeholder: '60000', description: 'Co ile ms sprawdzać posty' },
      { key: 'FAST_MODE', label: 'Fast Mode', type: 'switch', description: 'Sortowanie "Najnowsze" dla szybszego wykrywania' },
      { key: 'INCLUDE_REPLIES', label: 'Uwzględniaj odpowiedzi', type: 'switch', description: 'Czy monitorować odpowiedzi na komentarze' },
    ],
  },
  {
    title: 'Logowanie',
    icon: <Terminal className="h-5 w-5" />,
    description: 'Poziom szczegółowości logów',
    fields: [
      {
        key: 'LOG_LEVEL',
        label: 'Poziom logów',
        type: 'select',
        options: [
          { value: 'silent', label: 'Silent - brak logów' },
          { value: 'production', label: 'Production - tylko ważne' },
          { value: 'dev', label: 'Dev - szczegółowe' },
          { value: 'debug', label: 'Debug - wszystko' },
        ],
      },
    ],
  },
  {
    title: 'Puppeteer / Browser',
    icon: <Eye className="h-5 w-5" />,
    description: 'Ustawienia przeglądarki',
    fields: [
      { key: 'HEADLESS_BROWSER', label: 'Tryb headless', type: 'switch', description: 'Uruchamiaj bez widocznego okna' },
      { key: 'USE_UI_HANDLERS', label: 'UI Handlers', type: 'switch', description: 'Używaj handlerów UI do interakcji' },
      { key: 'COOKIES_READ_ONLY', label: 'Cookies tylko do odczytu', type: 'switch', description: 'Nie zapisuj zmian w cookies' },
    ],
  },
  {
    title: 'Facebook',
    icon: <User className="h-5 w-5" />,
    description: 'Dane logowania do FB',
    fields: [
      { key: 'FB_EMAIL', label: 'Email', placeholder: 'email@example.com' },
      { key: 'FB_PASSWORD', label: 'Hasło', type: 'password', placeholder: '********' },
    ],
  },
  {
    title: 'Źródła postów',
    icon: <Link className="h-5 w-5" />,
    description: 'Skąd pobierać listę postów',
    fields: [
      { key: 'POSTS_API_URL', label: 'API URL', placeholder: 'http://server:3180/api/posts', description: 'Remote API panelu' },
      { key: 'POSTS_API_TOKEN', label: 'API Token', type: 'password', placeholder: 'fbw_xxx...' },
      { key: 'POSTS_SHEET_URL', label: 'Google Sheet URL', placeholder: 'https://docs.google.com/...', description: 'Fallback gdy API niedostępne' },
    ],
  },
  {
    title: 'Telegram - Właściciel',
    icon: <Send className="h-5 w-5" />,
    description: 'Powiadomienia do Ciebie',
    fields: [
      { key: 'TELEGRAM_SEND_TO_OWNER', label: 'Wysyłaj do właściciela', type: 'switch' },
      { key: 'TELEGRAM_BOT_TOKEN_OWNER', label: 'Bot Token', type: 'password', placeholder: '123456:ABC...' },
      { key: 'TELEGRAM_CHAT_ID_OWNER', label: 'Chat ID', placeholder: '123456789' },
    ],
  },
  {
    title: 'Telegram - Klient',
    icon: <Bot className="h-5 w-5" />,
    description: 'Powiadomienia do klienta',
    fields: [
      { key: 'TELEGRAM_SEND_TO_CLIENT', label: 'Wysyłaj do klienta', type: 'switch' },
      { key: 'TELEGRAM_BOT_TOKEN_CLIENT', label: 'Bot Token', type: 'password', placeholder: '123456:ABC...' },
      { key: 'TELEGRAM_CHAT_ID_CLIENT', label: 'Chat ID', placeholder: '123456789' },
    ],
  },
  {
    title: 'Telegram - Format',
    icon: <Send className="h-5 w-5" />,
    description: 'Formatowanie wiadomości',
    fields: [
      { key: 'TELEGRAM_USE_PHOTO', label: 'Wysyłaj ze zdjęciem', type: 'switch', description: 'Dołącz miniaturę posta' },
      { key: 'TELEGRAM_DISABLE_WEB_PAGE_PREVIEW', label: 'Wyłącz podgląd linków', type: 'switch' },
    ],
  },
  {
    title: 'Telegram - Alerty',
    icon: <Bell className="h-5 w-5" />,
    description: 'Alerty o błędach z logów',
    fields: [
      { key: 'TG_ALERTS_ENABLED', label: 'Włącz alerty', type: 'switch' },
      { key: 'TG_ALERTS_COOLDOWN_SEC', label: 'Cooldown (sek)', type: 'number', placeholder: '120', description: 'Minimalny odstęp między alertami' },
      { key: 'TG_ALERTS_MAXLEN', label: 'Max długość', type: 'number', placeholder: '3500', description: 'Maksymalna długość wiadomości' },
    ],
  },
  {
    title: 'LITE: Human Behavior',
    icon: <Heart className="h-5 w-5" />,
    description: 'Symulacja zachowań człowieka',
    fields: [
      { key: 'HUMAN_MODE', label: 'Human Mode', type: 'switch', description: 'Włącz symulację zachowań człowieka' },
      { key: 'HUMAN_RANDOM_LIKE_CHANCE', label: 'Szansa na losowy like', type: 'number', placeholder: '0.20', description: 'Szansa (0-1) na polubienie podczas sesji' },
      { key: 'WEBHOOK_MAX_AGE_MIN', label: 'Max wiek komentarzy (min)', type: 'number', placeholder: '60', description: 'Pomijaj komentarze starsze niż X minut' },
    ],
  },
  {
    title: 'LITE: Session Management',
    icon: <Clock className="h-5 w-5" />,
    description: 'Zarządzanie długością sesji',
    fields: [
      { key: 'SESSION_LENGTH_MIN_MS', label: 'Min długość sesji (ms)', type: 'number', placeholder: '1800000', description: '30 min = 1800000' },
      { key: 'SESSION_LENGTH_MAX_MS', label: 'Max długość sesji (ms)', type: 'number', placeholder: '5400000', description: '90 min = 5400000' },
      { key: 'WARMUP_ENABLED', label: 'Sesja rozgrzewkowa', type: 'switch', description: 'Rozgrzewka przed monitorowaniem' },
      { key: 'WARMUP_DURATION_MIN_MS', label: 'Min warmup (ms)', type: 'number', placeholder: '300000', description: '5 min = 300000' },
      { key: 'WARMUP_DURATION_MAX_MS', label: 'Max warmup (ms)', type: 'number', placeholder: '600000', description: '10 min = 600000' },
    ],
  },
  {
    title: 'LITE: Anti-Detection',
    icon: <Shield className="h-5 w-5" />,
    description: 'Techniki ukrywania bota',
    fields: [
      { key: 'VIEWPORT_RANDOMIZATION', label: 'Losowy viewport', type: 'switch', description: 'Losowa rozdzielczość przy każdej sesji' },
      { key: 'TYPING_MISTAKES_ENABLED', label: 'Literówki', type: 'switch', description: 'Symulacja błędów przy pisaniu' },
      { key: 'TYPING_MISTAKES_CHANCE', label: 'Szansa literówki', type: 'number', placeholder: '0.03', description: 'Szansa (0-1) na literówkę' },
      { key: 'NAVIGATION_MISTAKES_ENABLED', label: 'Błędy nawigacji', type: 'switch', description: 'Symulacja cofania/powrotu' },
      { key: 'PROFILE_VISITS_ENABLED', label: 'Odwiedzanie profili', type: 'switch', description: 'Losowe odwiedzanie profili' },
      { key: 'PROFILE_VISITS_CHANCE', label: 'Szansa wizyty', type: 'number', placeholder: '0.08', description: 'Szansa (0-1) na wizytę profilu' },
      { key: 'TAB_SIMULATION_ENABLED', label: 'Symulacja kart', type: 'switch', description: 'Symulacja przełączania kart' },
      { key: 'TAB_SIMULATION_CHANCE', label: 'Szansa tab switch', type: 'number', placeholder: '0.10', description: 'Szansa (0-1) na przełączenie karty' },
      { key: 'IMAGE_INTERACTION_ENABLED', label: 'Interakcja ze zdjęciami', type: 'switch', description: 'Hover i klik na zdjęciach' },
      { key: 'IMAGE_INTERACTION_CHANCE', label: 'Szansa na zdjęcie', type: 'number', placeholder: '0.15', description: 'Szansa (0-1) na interakcję ze zdjęciem' },
    ],
  },
  {
    title: 'LITE: Night Mode',
    icon: <Moon className="h-5 w-5" />,
    description: 'Tryb nocny - bot śpi',
    fields: [
      { key: 'NIGHT_MODE_ENABLED', label: 'Włącz tryb nocny', type: 'switch', description: 'Bot śpi w nocy' },
      { key: 'NIGHT_START_HOUR', label: 'Początek nocy', type: 'number', placeholder: '22', description: 'Godzina rozpoczęcia snu (0-23)' },
      { key: 'NIGHT_END_HOUR', label: 'Koniec nocy', type: 'number', placeholder: '7', description: 'Godzina przebudzenia (0-23)' },
      { key: 'NIGHT_CATCHUP_HOURS', label: 'Catch-up (godz)', type: 'number', placeholder: '8', description: 'Po ilu godzinach robić catch-up' },
    ],
  },
  {
    title: 'LITE: Feed Scanner',
    icon: <Search className="h-5 w-5" />,
    description: 'Skanowanie tablicy po słowach kluczowych',
    fields: [
      { key: 'FEED_SCAN_ENABLED', label: 'Włącz skanowanie', type: 'switch', description: 'Skanuj tablicę FB' },
      { key: 'FEED_SCAN_KEYWORDS', label: 'Słowa kluczowe', placeholder: 'garaż,blaszany,hala', description: 'Rozdzielone przecinkami' },
      { key: 'FEED_SCROLL_DURATION_MIN', label: 'Min czas scroll (min)', type: 'number', placeholder: '1', description: 'Minimalny czas scrollowania' },
      { key: 'FEED_SCROLL_DURATION_MAX', label: 'Max czas scroll (min)', type: 'number', placeholder: '3', description: 'Maksymalny czas scrollowania' },
      { key: 'DISCOVERY_TELEGRAM_ENABLED', label: 'Alert Telegram', type: 'switch', description: 'Wyślij alert przy nowym wykryciu' },
    ],
  },
]

function isTruthy(val: string): boolean {
  return val === 'true' || val === '1' || val === 'yes'
}

function boolToEnv(val: boolean): string {
  return val ? 'true' : 'false'
}

export function Settings() {
  const [values, setValues] = useState<EnvValues | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [pm2Loading, setPm2Loading] = useState<string | null>(null)

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
        showMessage(result.error || 'Nie udalo sie wczytac ustawien', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEnv()
  }, [])

  const handleChange = (key: keyof EnvValues, value: string) => {
    if (values) {
      setValues({ ...values, [key]: value })
    }
  }

  const handleSwitchChange = (key: keyof EnvValues, checked: boolean) => {
    if (values) {
      setValues({ ...values, [key]: boolToEnv(checked) })
    }
  }

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
        showMessage(restart ? 'Zapisano i zrestartowano' : 'Zapisano ustawienia', 'success')
      } else {
        showMessage(result.error || 'Nie udalo sie zapisac', 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
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
        showMessage(labels[action], 'success')
      } else {
        showMessage(result.error || `Nie udalo sie ${action}`, 'error')
      }
    } catch {
      showMessage('Blad polaczenia', 'error')
    } finally {
      setPm2Loading(null)
    }
  }

  const renderField = (field: FieldConfig) => {
    if (!values) return null
    const value = values[field.key] || ''

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
            checked={isTruthy(value)}
            onCheckedChange={(checked) => handleSwitchChange(field.key, checked)}
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
            value={value}
            onChange={(e) => handleChange(field.key, e.target.value)}
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
          value={value}
          onChange={(e) => handleChange(field.key, e.target.value)}
        />
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <div
          className={`p-3 rounded-md text-sm ${
            message.type === 'success'
              ? 'bg-green-900/20 text-green-400 border border-green-900/50'
              : 'bg-red-900/20 text-red-400 border border-red-900/50'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* PM2 Controls */}
      <Card>
        <CardHeader>
          <CardTitle>PM2 Controls</CardTitle>
          <CardDescription>Zarzadzanie procesem watchera</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => handlePm2Action('start')}
              disabled={!!pm2Loading}
            >
              <Play className="h-4 w-4 mr-2" />
              {pm2Loading === 'start' ? 'Uruchamianie...' : 'Start'}
            </Button>
            <Button
              variant="outline"
              onClick={() => handlePm2Action('stop')}
              disabled={!!pm2Loading}
            >
              <Square className="h-4 w-4 mr-2" />
              {pm2Loading === 'stop' ? 'Zatrzymywanie...' : 'Stop'}
            </Button>
            <Button
              variant="outline"
              onClick={() => handlePm2Action('restart')}
              disabled={!!pm2Loading}
            >
              <RotateCw className="h-4 w-4 mr-2" />
              {pm2Loading === 'restart' ? 'Restartowanie...' : 'Restart'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Save buttons - sticky */}
      <Card className="sticky top-4 z-10 border-primary/50">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={loadEnv} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Wczytaj ponownie
            </Button>
            <div className="flex gap-2">
              <Button onClick={() => handleSave(false)} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </Button>
              <Button variant="secondary" onClick={() => handleSave(true)} disabled={saving}>
                <RotateCw className="h-4 w-4 mr-2" />
                Zapisz i restartuj
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings sections */}
      {values && SECTIONS.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {section.icon}
              {section.title}
            </CardTitle>
            {section.description && (
              <CardDescription>{section.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {section.fields.map((field, idx) => (
              <div key={field.key}>
                {renderField(field)}
                {idx < section.fields.length - 1 && field.type !== 'switch' && (
                  <Separator className="mt-4" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
