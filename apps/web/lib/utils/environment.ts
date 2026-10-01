export function visibleEnvironmentLabel(appEnv = process.env.NEXT_PUBLIC_APP_ENV): 'STAGING' | null {
  return appEnv?.toLowerCase() === 'staging' ? 'STAGING' : null
}
