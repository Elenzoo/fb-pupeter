import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import {
  TAB_GROUPS,
  getSectionsForGroup,
  renderField,
  boolToEnv,
} from './shared'
import type { EnvValues } from '@/lib/types'

interface VerticalTabsProps {
  values: EnvValues
  onValuesChange: (values: EnvValues) => void
}

export function SettingsVerticalTabs({ values, onValuesChange }: VerticalTabsProps) {
  const [activeTab, setActiveTab] = useState(TAB_GROUPS[0].id)

  const handleValueChange = (key: keyof EnvValues, value: string) => {
    onValuesChange({ ...values, [key]: value })
  }

  const handleSwitchChange = (key: keyof EnvValues, checked: boolean) => {
    onValuesChange({ ...values, [key]: boolToEnv(checked) })
  }

  const activeSections = getSectionsForGroup(activeTab)

  return (
    <div className="flex gap-4 min-h-[600px]">
      {/* Sidebar */}
      <div className="w-[200px] shrink-0">
        <Card className="sticky top-20">
          <CardContent className="p-2">
            <nav className="flex flex-col gap-1">
              {TAB_GROUPS.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setActiveTab(group.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left',
                    activeTab === group.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  )}
                >
                  {group.icon}
                  {group.label}
                </button>
              ))}
            </nav>
          </CardContent>
        </Card>
      </div>

      {/* Content - Accordion sections */}
      <div className="flex-1">
        <Card>
          <CardContent className="p-4">
            <Accordion type="multiple" defaultValue={[activeSections[0]?.id]}>
              {activeSections.map((section) => (
                <AccordionItem key={section.id} value={section.id}>
                  <AccordionTrigger value={section.id} className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      {section.icon}
                      <div className="text-left">
                        <div className="font-medium">{section.title}</div>
                        {section.description && (
                          <div className="text-xs text-muted-foreground font-normal">
                            {section.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent value={section.id}>
                    <div className="space-y-4 pt-2 pl-7">
                      {section.fields.map((field) => (
                        <div key={field.key}>
                          {renderField({
                            field,
                            values,
                            onValueChange: handleValueChange,
                            onSwitchChange: handleSwitchChange,
                          })}
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
