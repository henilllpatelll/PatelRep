import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const nextConfig = require('eslint-config-next/core-web-vitals')
const i18next = require('eslint-plugin-i18next')

const config = [
  {
    ignores: ['.next/**', '.next-*/**', 'playwright-report-phase0/**', 'test-results/**'],
  },
  ...nextConfig,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      // Intentional patterns: hydration guards, form resets on open, time-based init
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // ── Full floor-facing bilingual hard-fail gate (04-08..04-16 / D-03/D-04) ──
  // A raw user-facing string literal in JSX text, aria-label, placeholder, or
  // title on a floor-facing surface now fails `npm run lint`. This originally
  // shipped in 04-08 scoped to a narrow 6-file list, because several sibling
  // engineering/housekeeping/tasks files predated this phase's i18n work and
  // still contained untranslated floor copy at that time. Plans 04-09 through
  // 04-16 translated every remaining file in the full D-04 floor directory
  // set (components/housekeeping/**, components/engineering/**,
  // components/programs/**, and app/(dashboard)/{housekeeping,engineering,
  // tasks,programs}/**), so the gate now covers that full set directly.
  {
    files: [
      'components/housekeeping/**',
      'components/engineering/**',
      'components/programs/**',
      'app/(dashboard)/housekeeping/**',
      'app/(dashboard)/engineering/**',
      'app/(dashboard)/tasks/**',
      'app/(dashboard)/programs/**',
    ],
    ignores: [
      // GM/admin/config/inspector-export/analytics dirs stay English (D-03) --
      // exempt even if a future glob widening would otherwise sweep them in.
      'app/(dashboard)/reports/**',
      'app/(dashboard)/billing/**',
      'app/(dashboard)/settings/**',
      '**/*inspector-export*',
      '**/*.test.*',
      '**/*.spec.*',
    ],
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
