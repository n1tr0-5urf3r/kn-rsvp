import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { useSettings, useUpdateSettingsMutation } from '../../api/queries'
import { Button } from '../../components/Button'
import { Card, Skeleton } from '../../components/Card'
import { FieldLabel, TextInput } from '../../components/Select'
import { useToast } from '../../lib/toast'

const knownSettings: Record<string, string> = {
  site_notice: 'Notice shown on the overview page (empty = hidden)',
  caldav_sync_enabled: 'CalDAV sync on/off ("1" or "0")',
  caldav_event_summary_template:
    'Event title template, placeholders {resource} and {user} ({tofino} remains supported)',
}

export function AdminSettingsPage() {
  const { data, isLoading } = useSettings()
  const updateSettings = useUpdateSettingsMutation()
  const { toast } = useToast()
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (data) {
      setValues(data.settings)
    }
  }, [data])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await updateSettings.mutateAsync(values)
      toast('Settings saved.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Saving failed.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-black">App settings</h2>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-4">
            {Object.entries(values)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <FieldLabel key={key} label={key}>
                  {knownSettings[key] ? (
                    <span className="mb-1 block text-xs font-bold text-berry-700/70 dark:text-rose-100/70">
                      {knownSettings[key]}
                    </span>
                  ) : null}
                  <TextInput
                    value={value}
                    onChange={(e) =>
                      setValues({ ...values, [key]: e.target.value })
                    }
                  />
                </FieldLabel>
              ))}
            <div className="flex justify-end">
              <Button type="submit" disabled={updateSettings.isPending}>
                <Save className="size-4" aria-hidden="true" />
                Save settings
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  )
}
