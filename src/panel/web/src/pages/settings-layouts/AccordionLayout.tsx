import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Separator } from '@/components/ui/separator'
import {
  TAB_GROUPS,
  getSectionsForGroup,
  renderField,
  boolToEnv,
} from './shared'
import type { EnvValues } from '@/lib/types'

interface AccordionLayoutProps {
  values: EnvValues
  onValuesChange: (values: EnvValues) => void
}

export function SettingsAccordion({ values, onValuesChange }: AccordionLayoutProps) {
  const handleValueChange = (key: keyof EnvValues, value: string) => {
    onValuesChange({ ...values, [key]: value })
  }

  const handleSwitchChange = (key: keyof EnvValues, checked: boolean) => {
    onValuesChange({ ...values, [key]: boolToEnv(checked) })
  }

  return (
    <Accordion type="multiple" defaultValue={[TAB_GROUPS[0].id]} className="space-y-2">
      {TAB_GROUPS.map((group) => {
        const sections = getSectionsForGroup(group.id)
        const sectionCount = sections.length
        const fieldCount = sections.reduce((acc, s) => acc + s.fields.length, 0)

        return (
          <AccordionItem key={group.id} value={group.id} className="border rounded-lg px-4">
            <AccordionTrigger value={group.id} className="hover:no-underline">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted">
                  {group.icon}
                </div>
                <div className="text-left">
                  <div className="font-semibold">{group.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {sectionCount} {sectionCount === 1 ? 'sekcja' : sectionCount < 5 ? 'sekcje' : 'sekcji'} - {fieldCount} {fieldCount === 1 ? 'pole' : fieldCount < 5 ? 'pola' : 'pol'}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent value={group.id}>
              <div className="space-y-4 pt-2">
                {sections.map((section) => (
                  <Card key={section.id} className="border-muted">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        {section.icon}
                        {section.title}
                      </CardTitle>
                      {section.description && (
                        <CardDescription className="text-xs">{section.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {section.fields.map((field, idx) => (
                        <div key={field.key}>
                          {renderField({
                            field,
                            values,
                            onValueChange: handleValueChange,
                            onSwitchChange: handleSwitchChange,
                          })}
                          {idx < section.fields.length - 1 && field.type !== 'switch' && (
                            <Separator className="mt-3" />
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}
