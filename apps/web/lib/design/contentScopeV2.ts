import type { ModeV2 } from './designV2Tokens'

/** Phase 7: turns on the V2 content remap (components/design-v2/content/contentRemapV2.css).
 *
 *  Sets `data-dv2-content` / `data-dv2-mode` and the `--dv2-*` variables on <body>, so page bodies and
 *  portaled drawers/dialogs (which live outside ShellV2's subtree) resolve the legacy token names to
 *  the V2 palette. Returns a cleanup that removes everything it set. Called ONLY by ShellV2, which
 *  DashboardShell mounts only when the V2 preview flag is on, so legacy mode never has these. */
export function applyContentScopeV2(
  body: HTMLElement,
  mode: ModeV2,
  vars: Record<string, string | number | undefined>,
): () => void {
  const names = Object.keys(vars).filter((name) => name.startsWith('--dv2-'))
  for (const name of names) body.style.setProperty(name, String(vars[name]))
  body.setAttribute('data-dv2-content', '')
  body.setAttribute('data-dv2-mode', mode)
  return () => {
    for (const name of names) body.style.removeProperty(name)
    body.removeAttribute('data-dv2-content')
    body.removeAttribute('data-dv2-mode')
  }
}
