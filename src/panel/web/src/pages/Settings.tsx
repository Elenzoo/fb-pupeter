import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Play, Square, RotateCw, Save, RefreshCw,
  User, Bot, Zap, Terminal, Eye, Send, Bell, Link
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
