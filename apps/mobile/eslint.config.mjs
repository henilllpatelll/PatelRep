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
      'app/(app)/profile/**/*.{ts,tsx,js,jsx}',
      'app/(app)/home/**/*.{ts,tsx,js,jsx}',
      'app/(app)/assignments/**/*.{ts,tsx,js,jsx}',
      'app/(app)/scheduling/**/*.{ts,tsx,js,jsx}',
      'app/(app)/staff/**/*.{ts,tsx,js,jsx}',
      'app/(app)/assets/**/*.{ts,tsx,js,jsx}',
      'app/(app)/pm-schedules/**/*.{ts,tsx,js,jsx}',
      'app/(app)/guest-requests/**/*.{ts,tsx,js,jsx}',
      'app/(app)/lost-found/**/*.{ts,tsx,js,jsx}',
      'app/(app)/logbook/**/*.{ts,tsx,js,jsx}',
      'app/(app)/sop/**/*.{ts,tsx,js,jsx}',
      'app/(app)/copilot/**/*.{ts,tsx,js,jsx}',
      'app/(app)/alerts/**/*.{ts,tsx,js,jsx}',
      'app/(app)/notifications/**/*.{ts,tsx,js,jsx}',
      'components/supervisor/**/*.{ts,tsx,js,jsx}',
      'components/home/**/*.{ts,tsx,js,jsx}',
    ],
    ignores: [
      '**/*.test.*',
      '**/*.spec.*',
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
