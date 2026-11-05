/** Design System V2 preview switch (mobile).
 *
 *  - Disabled by default. Enabled only by an explicit `EXPO_PUBLIC_DESIGN_V2_PREVIEW=true`
 *    at bundle time (e.g. `EXPO_PUBLIC_DESIGN_V2_PREVIEW=true npx expo start`).
 *  - Never enabled when `EXPO_PUBLIC_APP_ENV=production`, whatever the flag says.
 *  - Purely visual: it grants no permissions, unlocks no features and adds no settings. It gates
 *    the preview route and the `<DesignV2Scope>` theme override and nothing else.
 *
 *  Expo inlines `process.env.EXPO_PUBLIC_*` only for literal references, so the two reads below
 *  must stay literal. */
export function resolveDesignV2Preview(
  flag: string | undefined,
  appEnv: string | undefined,
): boolean {
  if ((appEnv ?? "").trim().toLowerCase() === "production") return false;
  return (flag ?? "").trim().toLowerCase() === "true";
}

const DESIGN_V2_PREVIEW_ENABLED = resolveDesignV2Preview(
  process.env.EXPO_PUBLIC_DESIGN_V2_PREVIEW,
  process.env.EXPO_PUBLIC_APP_ENV,
);

export function isDesignV2Enabled(): boolean {
  return DESIGN_V2_PREVIEW_ENABLED;
}
