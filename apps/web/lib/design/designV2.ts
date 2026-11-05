/** Design System V2 preview switch (web).
 *
 *  - Disabled by default. Enabled only by an explicit `NEXT_PUBLIC_DESIGN_V2_PREVIEW=true` at
 *    build/start time (e.g. `NEXT_PUBLIC_DESIGN_V2_PREVIEW=true npm run dev:web`).
 *  - Never enabled when `NEXT_PUBLIC_APP_ENV=production`, whatever the flag says.
 *  - Purely visual: grants no permission, unlocks no feature, stores nothing. It only decides
 *    whether the /design-v2-preview reference route exists (otherwise it is a 404). Next inlines
 *    NEXT_PUBLIC_* only for literal references, so the two reads below must stay literal. */
export function resolveDesignV2Preview(flag: string | undefined, appEnv: string | undefined): boolean {
  if ((appEnv ?? '').trim().toLowerCase() === 'production') return false
  return (flag ?? '').trim().toLowerCase() === 'true'
}

export function isDesignV2PreviewEnabled(): boolean {
  return resolveDesignV2Preview(
    process.env.NEXT_PUBLIC_DESIGN_V2_PREVIEW,
    process.env.NEXT_PUBLIC_APP_ENV,
  )
}
