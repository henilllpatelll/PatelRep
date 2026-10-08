'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsField, SettingsTextInput, controlA11y } from '@/components/settings/workspace/SettingsFormControls'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  EMPTY_CONNECT_FORM, OPERA_NAME, classifyActionFailure, connectFormDirty, validateConnectForm,
  type ConnectFormErrors, type ConnectFormValues,
} from '@/lib/settings/integrations'
import type { OperaIntegration } from './useOperaIntegration'

/**
 * Connect (or re-enter) the OHIP connection.
 *
 * The backend contract is exactly: endpoint, property code, and an optional integration username +
 * password. The OHIP client ID / secret / application key are server-side configuration and are never
 * entered here. Secrets live only in this component's state: password is a masked input, is never
 * pre-filled, never written to storage or the URL, and is dropped (with the mutation's cached variables)
 * when the drawer closes.
 */
export function ConnectOperaDrawer({
  integration, replacing, initial, onClose, onConnected,
}: {
  integration: OperaIntegration
  /** True when updating an existing connection: the stored secrets are never shown, so they must be re-entered. */
  replacing: boolean
  /** Non-secret values to pre-fill when replacing. */
  initial?: Pick<ConnectFormValues, 'ohip_base_url' | 'hotel_id_opera'>
  onClose: () => void
  onConnected: () => void
}) {
  const [start] = useState<ConnectFormValues>(() => ({ ...EMPTY_CONNECT_FORM, ...initial }))
  const [values, setValues] = useState<ConnectFormValues>(start)
  const [submitted, setSubmitted] = useState(false)
  const [failure, setFailure] = useState<{ message: string; kind: ReturnType<typeof classifyActionFailure> } | null>(null)

  const { connect } = integration
  const errors: ConnectFormErrors = validateConnectForm(values)
  const shown: ConnectFormErrors = submitted ? errors : {}
  const dirty = connectFormDirty(values, start)
  const set = (key: keyof ConnectFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    setFailure(null)
  }

  // Drop the cached request (it holds the password) when the drawer goes away.
  const resetConnect = connect.reset
  useEffect(() => () => resetConnect(), [resetConnect])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0 || connect.isPending) return
    try {
      const ran = await integration.connectNow(values)
      resetConnect()
      if (ran) onConnected()
    } catch (err) {
      setFailure({ message: errorMessage(err, 'We couldn’t connect to OPERA Cloud.'), kind: classifyActionFailure(err) })
    }
  }

  const pending = connect.isPending

  return (
    <SettingsDrawer
      title={replacing ? `Update ${OPERA_NAME} connection` : `Connect ${OPERA_NAME}`}
      description="Configure your hotel’s supported OPERA Cloud integration."
      onClose={onClose}
      dirty={dirty && !pending}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-end gap-3 px-4 py-3 sm:px-5">
          <Button variant="ghost" onClick={requestClose} disabled={pending}>Cancel</Button>
          <Button type="submit" form="opera-connect-form" loading={pending}>{replacing ? 'Save connection' : 'Connect'}</Button>
        </div>
      )}
    >
      <form id="opera-connect-form" onSubmit={submit} noValidate autoComplete="off" className="space-y-7">
        {replacing && (
          <p className="rounded-[var(--r-md)] border border-[var(--caution-line)] bg-[var(--caution-soft)] px-3 py-2.5 text-[13px] text-ink-2">
            Saving replaces the stored credentials. Passwords are never shown or returned, so re-enter the integration
            username and password if your connection uses them. Leaving them blank switches to application-only sign-in.
          </p>
        )}

        <fieldset className="space-y-4" disabled={pending}>
          <legend className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Connection details</legend>
          <SettingsField id="opera-property-code" label="Property code" required error={shown.hotel_id_opera} hint="The hotel code configured in OPERA, for example SAND01.">
            <SettingsTextInput
              {...controlA11y('opera-property-code', { error: shown.hotel_id_opera, hint: true, required: true })}
              value={values.hotel_id_opera}
              onChange={set('hotel_id_opera')}
              placeholder="SAND01"
              maxLength={64}
              autoCapitalize="characters"
              spellCheck={false}
            />
          </SettingsField>
          <SettingsField id="opera-endpoint" label="OHIP endpoint" required error={shown.ohip_base_url} hint="The https address of your Oracle Hospitality Integration Platform gateway.">
            <SettingsTextInput
              {...controlA11y('opera-endpoint', { error: shown.ohip_base_url, hint: true, required: true })}
              type="url"
              inputMode="url"
              value={values.ohip_base_url}
              onChange={set('ohip_base_url')}
              placeholder="https://hospitality.oracle.com"
              spellCheck={false}
            />
          </SettingsField>
        </fieldset>

        <fieldset className="space-y-4" disabled={pending}>
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Authentication</legend>
          <p className="text-[13px] text-ink-3">
            Optional integration user. Leave both blank if your OPERA setup authenticates the PatelRep application itself.
            The application’s client ID, secret and key are configured on the server — you never enter them here.
          </p>
          <SettingsField id="opera-username" label="Integration username" error={shown.integration_username}>
            <SettingsTextInput
              {...controlA11y('opera-username', { error: shown.integration_username })}
              value={values.integration_username}
              onChange={set('integration_username')}
              autoComplete="off"
              spellCheck={false}
            />
          </SettingsField>
          <SettingsField id="opera-password" label="Integration password" error={shown.integration_password} hint="Stored encrypted on the server. Never displayed again.">
            <SettingsTextInput
              {...controlA11y('opera-password', { error: shown.integration_password, hint: true })}
              type="password"
              value={values.integration_password}
              onChange={set('integration_password')}
              autoComplete="new-password"
            />
          </SettingsField>
        </fieldset>

        {failure && (
          <div role="alert" className="rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2.5 text-[13px] text-[var(--alert)]">
            <p className="font-semibold">{failure.kind === 'unreachable' ? 'Couldn’t reach OPERA Cloud' : 'Connection not saved'}</p>
            <p className="mt-0.5">{failure.message}</p>
            {failure.kind === 'auth_or_config' && <p className="mt-0.5">Check the endpoint, property code and credentials, then try again.</p>}
          </div>
        )}
      </form>
    </SettingsDrawer>
  )
}
