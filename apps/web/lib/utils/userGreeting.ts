interface GreetingNameSources {
  preferredName?: string | null
  fullName?: string | null
  userMetadataFullName?: unknown
  appMetadataFullName?: unknown
}

function firstName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.split(/\s+/)[0] : undefined
}

export function getGreetingName({
  preferredName,
  fullName,
  userMetadataFullName,
  appMetadataFullName,
}: GreetingNameSources): string | undefined {
  return (
    firstName(preferredName) ??
    firstName(fullName) ??
    firstName(userMetadataFullName) ??
    firstName(appMetadataFullName)
  )
}

export function formatDashboardGreeting(greeting: string, name?: string): string {
  return name ? `${greeting}, ${name}.` : `${greeting}.`
}
