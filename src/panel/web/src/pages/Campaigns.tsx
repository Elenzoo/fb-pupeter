import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Megaphone, Clock } from 'lucide-react'

export function Campaigns() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted rounded-lg">
              <Megaphone className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>Kampanie</CardTitle>
              <CardDescription>Automatyzacja odpowiedzi na komentarze</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Wkrotce dostepne</h3>
            <p className="text-muted-foreground max-w-md">
              Ta funkcja pozwoli na automatyczne odpowiadanie na wykryte komentarze
              wedlug zdefiniowanych regul i szablonow.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Planowane funkcje</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Tworzenie kampanii z szablonami odpowiedzi</li>
            <li>• Reguly triggerowan (slowa kluczowe, czas)</li>
            <li>• Harmonogram wysylki</li>
            <li>• A/B testy odpowiedzi</li>
            <li>• Statystyki skutecznosci</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
