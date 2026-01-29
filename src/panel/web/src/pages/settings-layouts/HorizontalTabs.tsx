import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  TAB_GROUPS,
  getSectionsForGroup,
  renderField,
  boolToEnv,
} from './shared'
import type { EnvValues } from '@/lib/types'

interface HorizontalTabsProps {
  values: EnvValues
  onValuesChange: (values: EnvValues) => void
}

export function SettingsHorizontalTabs({ values, onValuesChange }: HorizontalTabsProps) {
  const handleValueChange = (key: keyof EnvValues, value: string) => {
    onValuesChange({ ...values, [key]: value })
  }

  const handleSwitchChange = (key: keyof EnvValues, checked: boolean) => {
    onValuesChange({ ...values, [key]: boolToEnv(checked) })
  }

  return (
    <Tabs defaultValue={TAB_GROUPS[0].id} className="w-full">
      <TabsList className="w-full justify-start mb-4 flex-wrap h-auto gap-1 p-1">
        {TAB_GROUPS.map((group) => (
          <TabsTrigger
            key={group.id}
            value={group.id}
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            {group.icon}
            {group.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {TAB_GROUPS.map((group) => {
        const sections = getSectionsForGroup(group.id)
        return (
          <TabsContent key={group.id} value={group.id} className="space-y-4">
            {sections.map((section) => (
              <Card key={section.id}>
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
                      {renderField({
                        field,
                        values,
                        onValueChange: handleValueChange,
                        onSwitchChange: handleSwitchChange,
                      })}
                      {idx < section.fields.length - 1 && field.type !== 'switch' && (
                        <Separator className="mt-4" />
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
