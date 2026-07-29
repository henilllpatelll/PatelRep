import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const i18next = require('eslint-plugin-i18next')
const tsParser = require('@typescript-eslint/parser')

const config = [
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'android/**',
      'ios/**',
      'dist/**',
      'babel.config.js',
      'metro.config.js',
    ],
  },
  // ── Floor-facing i18next hard-fail gate (D-15 / D-16) ──
  // A raw user-facing string literal in JSX text, aria-label, placeholder, or
  // title on a floor-facing surface fails `npm run lint`. Scope mirrors web's
  // gate: the four new primitives (components/ui/**) plus the existing
  // floor-facing screens/components. Non-floor screens are added gate-by-gate
  // in Phase 9. Severity is 'error' (hard CI failure), never 'warn'.
  {
    files: [
      'components/ui/**/*.{ts,tsx,js,jsx}',
      'app/(app)/my-rooms/**/*.{ts,tsx,js,jsx}',
      'app/(app)/room-board/**/*.{ts,tsx,js,jsx}',
      'app/(app)/room-status/**/*.{ts,tsx,js,jsx}',
      'app/(app)/work-orders/**/*.{ts,tsx,js,jsx}',
      'app/(app)/tasks/**/*.{ts,tsx,js,jsx}',
      'app/(app)/inspect/**/*.{ts,tsx,js,jsx}',
      'components/housekeeping/**/*.{ts,tsx,js,jsx}',
      'components/engineering/**/*.{ts,tsx,js,jsx}',
      'components/tasks/**/*.{ts,tsx,js,jsx}',
    ],
    ignores: [
      '**/*.test.*',
      '**/*.spec.*',
      // Deferred to Phase 9 (per team-lead decision 2026-07-29): these four
      // floor files predate i18n work and are not yet wired to useTranslation.
      // Translating them now would breach Phase 7's "zero visible change to any
      // existing screen" boundary and ship unreviewed Spanish for safety copy
      // ("Emergency"/"Safety"). Mirrors web's 04-08 narrow-then-widen precedent;
      // Phase 9 migrates them onto i18n and removes these exemptions.
      'components/engineering/CreateWorkOrderModal.tsx',
      'components/housekeeping/ReportIssueModal.tsx',
      'components/housekeeping/SupplyRequestModal.tsx',
      'app/(app)/tasks/index.tsx',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          markupOnly: true,
          'jsx-attributes': { include: ['aria-label', 'placeholder', 'title'] },
        },
      ],
    },
  },
]

export default config
