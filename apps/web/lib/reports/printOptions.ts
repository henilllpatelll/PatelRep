// What the "Print-friendly" export option controls. Pure helpers, unit-tested without a DOM.
//
// Printing renders the report that is on screen, so each option is honoured by the components
// themselves (they read `printOptions` from the Reports context) rather than by CSS hiding:
//   charts      -> trend charts and breakdown bars are not rendered
//   comparison  -> KPI comparison lines and chart comparison series are not rendered
//   exceptions  -> the "Needs attention" list is not rendered
//   definitions -> a "Metric definitions" section for the KPIs on screen is appended

export interface PrintOptions {
  charts: boolean
  comparison: boolean
  exceptions: boolean
  definitions: boolean
}

export type PrintPart = keyof PrintOptions

export const DEFAULT_PRINT_OPTIONS: PrintOptions = { charts: true, comparison: true, exceptions: true, definitions: true }

/** `printOptions` is null whenever the page is not being printed. */
export function printHides(options: PrintOptions | null | undefined, part: PrintPart): boolean {
  return !!options && !options[part]
}

/** Every KPI key present anywhere in a view payload (de-duplicated, in first-seen order). */
export function collectKpiKeys(data: unknown): string[] {
  const seen = new Set<string>()
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 6) return
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, depth + 1))
      return
    }
    const record = node as Record<string, unknown>
    // A KPI card payload always carries these three together.
    if (typeof record.key === 'string' && 'availability' in record && 'value' in record) seen.add(record.key)
    Object.values(record).forEach((child) => walk(child, depth + 1))
  }
  walk(data, 0)
  return [...seen]
}

export interface Definition {
  label: string
  definition: string
}

/** Definitions for the KPIs on screen, skipping keys the server does not document. */
export function definitionsForPrint(data: unknown, definitions: Record<string, Definition> | undefined): Array<Definition & { key: string }> {
  if (!definitions) return []
  return collectKpiKeys(data)
    .filter((key) => key in definitions)
    .map((key) => ({ key, ...definitions[key] }))
}
