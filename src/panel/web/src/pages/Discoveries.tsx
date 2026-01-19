import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Bell, Clock } from 'lucide-react'

export function Discoveries() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted rounded-lg">
              <Bell className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>Wykrycia</CardTitle>
              <CardDescription>Przegladaj i zatwierdzaj wykryte posty</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Wkrotce dostepne</h3>
            <p className="text-muted-foreground max-w-md">
              Ta funkcja pozwoli na przegladanie automatycznie wykrytych postow
              i zatwierdzanie ich do monitorowania.
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
            <li>• Lista wykrytych postow oczekujacych na zatwierdzenie</li>
            <li>• Podglad tresci posta przed zatwierdzeniem</li>
            <li>• Masowe zatwierdzanie / odrzucanie</li>
            <li>• Historia wykryc</li>
            <li>• Statystyki skutecznosci filtrow</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
