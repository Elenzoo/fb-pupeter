import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Globe, Clock } from 'lucide-react'

export function Sources() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted rounded-lg">
              <Globe className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>Zrodla monitorowania</CardTitle>
              <CardDescription>Zarzadzaj zrodlami postow do monitorowania</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Wkrotce dostepne</h3>
            <p className="text-muted-foreground max-w-md">
              Ta funkcja pozwoli na automatyczne wykrywanie postow z roznych zrodel:
              glownego feedu, grup, czy Meta Ads Library.
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
            <li>• Monitorowanie glownego feedu FB</li>
            <li>• Monitorowanie wybranych grup</li>
            <li>• Integracja z Meta Ads Library</li>
            <li>• Filtrowanie po slowach kluczowych</li>
            <li>• Automatyczne dodawanie wykrytych postow</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
